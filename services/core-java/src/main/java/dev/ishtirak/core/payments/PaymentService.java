package dev.ishtirak.core.payments;

import dev.ishtirak.core.billing.BillingCalculator;
import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.domain.CurrencyCode;
import dev.ishtirak.core.domain.Invoice;
import dev.ishtirak.core.domain.InvoiceStatus;
import dev.ishtirak.core.domain.Payment;
import dev.ishtirak.core.domain.PaymentMethod;
import dev.ishtirak.core.events.OutboxService;
import dev.ishtirak.core.persistence.InvoiceEntity;
import dev.ishtirak.core.persistence.PaymentEntity;
import dev.ishtirak.core.persistence.Repositories;
import java.math.BigDecimal;
import java.math.MathContext;
import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PaymentService {
    private final Repositories.Invoices invoices;
    private final Repositories.Payments payments;
    private final OutboxService outbox;
    private final BillingCalculator calculator;
    private final Clock clock;

    @Autowired
    public PaymentService(
            Repositories.Invoices invoices,
            Repositories.Payments payments,
            OutboxService outbox,
            BillingCalculator calculator,
            Clock clock) {
        this.invoices = invoices;
        this.payments = payments;
        this.outbox = outbox;
        this.calculator = calculator;
        this.clock = clock;
    }

    @Transactional
    public Payment record(
            UUID operatorId,
            UUID invoiceId,
            CurrencyCode currency,
            BigDecimal tenderedAmount,
            PaymentMethod method) {
        if (tenderedAmount.signum() <= 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "tenderedAmount must be > 0");
        }
        InvoiceEntity invoiceEntity = invoices.lockByOperatorIdAndId(operatorId, invoiceId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Invoice not found"));
        Invoice invoice = invoiceEntity.toDomain();
        AppliedPayment outstanding = outstanding(invoice);
        if (outstanding.usd().signum() == 0 && outstanding.lbp() == 0) {
            throw new ApiException(HttpStatus.CONFLICT, "CONFLICT", "Payment exceeds invoice outstanding balance");
        }
        AppliedPayment applied = apply(invoice, outstanding, currency, tenderedAmount);
        InvoiceStatus nextStatus = statusAfter(invoice, applied);
        Payment payment = new Payment(
                UUID.randomUUID(),
                operatorId,
                invoice.id(),
                invoice.subscriberId(),
                currency,
                tenderedAmount,
                applied.usd(),
                applied.lbp(),
                method,
                clock.instant());
        Payment saved = payments.save(new PaymentEntity(payment)).toDomain();
        invoiceEntity.applyStatus(nextStatus);
        outbox.enqueue("payment.received", operatorId, Map.of(
                "paymentId", saved.id(),
                "invoiceId", saved.invoiceId(),
                "subscriberId", saved.subscriberId(),
                "currency", saved.currency(),
                "tenderedAmount", saved.tenderedAmount(),
                "appliedUsd", saved.appliedUsd(),
                "appliedLbp", saved.appliedLbp(),
                "method", saved.method()));
        return saved;
    }

    public List<Payment> listForInvoice(UUID operatorId, UUID invoiceId) {
        if (invoices.findByOperatorIdAndId(operatorId, invoiceId).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Invoice not found");
        }
        return payments.findByOperatorIdAndInvoiceId(operatorId, invoiceId).stream()
                .map(PaymentEntity::toDomain)
                .toList();
    }

    public List<Payment> listForMyInvoice(UUID operatorId, UUID subscriberId, UUID invoiceId) {
        Invoice invoice = invoices.findByOperatorIdAndId(operatorId, invoiceId)
                .map(InvoiceEntity::toDomain)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Invoice not found"));
        if (!invoice.subscriberId().equals(subscriberId)) {
            throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Invoice not found");
        }
        return listForInvoice(operatorId, invoiceId);
    }

    private AppliedPayment apply(
            Invoice invoice,
            AppliedPayment outstanding,
            CurrencyCode currency,
            BigDecimal tenderedAmount) {
        if (currency == CurrencyCode.USD) {
            if (invoice.amountUsd().signum() == 0 && invoice.amountLbp() > 0) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Invoice does not accept USD payments");
            }
            BigDecimal usd = min(calculator.roundUsd(tenderedAmount), outstanding.usd());
            long lbp = invoice.amountLbp() == 0 ? 0 : Math.min(
                    calculator.roundLbp(tenderedAmount.multiply(ratio(invoice))), outstanding.lbp());
            return new AppliedPayment(usd, lbp);
        }
        if (invoice.amountLbp() == 0 && invoice.amountUsd().signum() > 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Invoice does not accept LBP payments");
        }
        BigDecimal usd = invoice.amountUsd().signum() == 0
                ? BigDecimal.ZERO.setScale(2)
                : min(calculator.roundUsd(tenderedAmount.divide(ratio(invoice), MathContext.DECIMAL64)), outstanding.usd());
        long lbp = Math.min(calculator.roundLbp(tenderedAmount), outstanding.lbp());
        return new AppliedPayment(usd, lbp);
    }

    private BigDecimal ratio(Invoice invoice) {
        if (invoice.amountUsd().signum() == 0 || invoice.amountLbp() == 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Invoice has no cross-currency ratio");
        }
        return BigDecimal.valueOf(invoice.amountLbp()).divide(invoice.amountUsd(), MathContext.DECIMAL64);
    }

    private AppliedPayment outstanding(Invoice invoice) {
        AppliedPayment alreadyPaid = paid(invoice);
        BigDecimal remainingUsd = invoice.amountUsd().subtract(alreadyPaid.usd());
        long remainingLbp = invoice.amountLbp() - alreadyPaid.lbp();
        return new AppliedPayment(maxZero(calculator.roundUsd(remainingUsd)), Math.max(0L, remainingLbp));
    }

    private InvoiceStatus statusAfter(Invoice invoice, AppliedPayment newPayment) {
        AppliedPayment paid = paid(invoice).plus(newPayment, calculator);
        if (paid.usd().compareTo(invoice.amountUsd()) >= 0 && paid.lbp() >= invoice.amountLbp()) {
            return InvoiceStatus.PAID;
        }
        return paid.usd().signum() > 0 || paid.lbp() > 0 ? InvoiceStatus.PARTIAL : invoice.status();
    }

    private AppliedPayment paid(Invoice invoice) {
        BigDecimal usd = BigDecimal.ZERO.setScale(2);
        long lbp = 0L;
        for (Payment payment : payments.findByOperatorIdAndInvoiceId(invoice.operatorId(), invoice.id()).stream()
                .map(PaymentEntity::toDomain)
                .toList()) {
            usd = usd.add(payment.appliedUsd());
            lbp += payment.appliedLbp();
        }
        return new AppliedPayment(calculator.roundUsd(usd), lbp);
    }

    private record AppliedPayment(BigDecimal usd, long lbp) {
        AppliedPayment plus(AppliedPayment other, BillingCalculator calculator) {
            return new AppliedPayment(calculator.roundUsd(usd.add(other.usd())), lbp + other.lbp());
        }
    }

    private static BigDecimal min(BigDecimal left, BigDecimal right) {
        return left.compareTo(right) <= 0 ? left : right;
    }

    private static BigDecimal maxZero(BigDecimal value) {
        return value.signum() < 0 ? BigDecimal.ZERO.setScale(2) : value;
    }
}

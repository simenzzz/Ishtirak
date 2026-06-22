package dev.ishtirak.core.billing;

import dev.ishtirak.core.common.PageResponse;
import dev.ishtirak.core.domain.CurrencyCode;
import dev.ishtirak.core.domain.Invoice;
import dev.ishtirak.core.domain.InvoiceStatus;
import dev.ishtirak.core.domain.Payment;
import dev.ishtirak.core.domain.PaymentMethod;
import dev.ishtirak.core.payments.PaymentService;
import dev.ishtirak.core.security.RequestIdentity;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class BillingController {
    private final BillingService billingService;
    private final PaymentService paymentService;

    public BillingController(BillingService billingService, PaymentService paymentService) {
        this.billingService = billingService;
        this.paymentService = paymentService;
    }

    @PostMapping("/billing-runs")
    @ResponseStatus(HttpStatus.ACCEPTED)
    BillingRunResponse runBilling(
            RequestIdentity identity,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody BillingRunRequest request) {
        identity.requireAdmin();
        List<Invoice> invoices = billingService.runBilling(
                identity.operatorId(), request.periodStart(), request.periodEnd(), idempotencyKey);
        int issued = (int) invoices.stream().filter(invoice -> invoice.status() == InvoiceStatus.ISSUED).count();
        int needsReview = (int) invoices.stream().filter(invoice -> invoice.status() == InvoiceStatus.NEEDS_REVIEW).count();
        return new BillingRunResponse(issued, needsReview, request.periodStart(), request.periodEnd());
    }

    @PostMapping("/invoices/{id}/reissue")
    InvoiceResponse reissueInvoice(RequestIdentity identity, @PathVariable UUID id) {
        identity.requireAdmin();
        return InvoiceResponse.from(billingService.reissue(identity.operatorId(), id));
    }

    @PostMapping("/invoices/{id}/void")
    InvoiceResponse voidInvoice(RequestIdentity identity, @PathVariable UUID id) {
        identity.requireAdmin();
        return InvoiceResponse.from(billingService.voidInvoice(identity.operatorId(), id));
    }

    @GetMapping("/invoices")
    PageResponse<InvoiceResponse> listInvoices(
            RequestIdentity identity,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        identity.requireStaffOrAdmin();
        return PageResponse.of(billingService.listInvoices(identity.operatorId()), page, limit)
                .map(InvoiceResponse::from);
    }

    @GetMapping("/invoices/{id}")
    InvoiceResponse getInvoice(RequestIdentity identity, @PathVariable UUID id) {
        identity.requireStaffOrAdmin();
        return InvoiceResponse.from(billingService.getInvoice(identity.operatorId(), id));
    }

    @GetMapping("/me/invoices")
    PageResponse<InvoiceResponse> listMyInvoices(
            RequestIdentity identity,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return PageResponse.of(
                billingService.listMyInvoices(identity.operatorId(), identity.requireSubscriberId()),
                page,
                limit)
                .map(InvoiceResponse::from);
    }

    @GetMapping("/me/invoices/{id}")
    InvoiceResponse getMyInvoice(RequestIdentity identity, @PathVariable UUID id) {
        return InvoiceResponse.from(billingService.getMyInvoice(identity.operatorId(), identity.requireSubscriberId(), id));
    }

    @PostMapping("/payments")
    @ResponseStatus(HttpStatus.CREATED)
    PaymentResponse recordPayment(RequestIdentity identity, @Valid @RequestBody RecordPaymentRequest request) {
        identity.requireStaffOrAdmin();
        return PaymentResponse.from(paymentService.record(
                identity.operatorId(),
                request.invoiceId(),
                request.currency(),
                request.tenderedAmount(),
                request.method()));
    }

    @GetMapping("/invoices/{id}/payments")
    List<PaymentResponse> listPayments(RequestIdentity identity, @PathVariable UUID id) {
        identity.requireStaffOrAdmin();
        return paymentService.listForInvoice(identity.operatorId(), id).stream()
                .map(PaymentResponse::from)
                .toList();
    }

    @GetMapping("/me/invoices/{id}/payments")
    List<PaymentResponse> listMyPayments(RequestIdentity identity, @PathVariable UUID id) {
        return paymentService.listForMyInvoice(identity.operatorId(), identity.requireSubscriberId(), id).stream()
                .map(PaymentResponse::from)
                .toList();
    }

    public record BillingRunRequest(@NotNull LocalDate periodStart, @NotNull LocalDate periodEnd) {
    }

    public record BillingRunResponse(
            int issuedCount,
            int needsReviewCount,
            LocalDate periodStart,
            LocalDate periodEnd) {
    }

    public record RecordPaymentRequest(
            @NotNull UUID invoiceId,
            @NotNull CurrencyCode currency,
            @NotNull @Positive BigDecimal tenderedAmount,
            @NotNull PaymentMethod method) {
    }

    record InvoiceResponse(
            UUID id,
            UUID subscriberId,
            LocalDate periodStart,
            LocalDate periodEnd,
            BigDecimal amountUsd,
            long amountLbp,
            BigDecimal kwhConsumed,
            InvoiceStatus status,
            Instant issuedAt) {
        static InvoiceResponse from(Invoice invoice) {
            return new InvoiceResponse(
                    invoice.id(),
                    invoice.subscriberId(),
                    invoice.periodStart(),
                    invoice.periodEnd(),
                    invoice.amountUsd(),
                    invoice.amountLbp(),
                    invoice.kwhConsumed(),
                    invoice.status(),
                    invoice.issuedAt());
        }
    }

    record PaymentResponse(
            UUID id,
            UUID invoiceId,
            UUID subscriberId,
            CurrencyCode currency,
            BigDecimal tenderedAmount,
            BigDecimal appliedUsd,
            long appliedLbp,
            PaymentMethod method,
            Instant receivedAt) {
        static PaymentResponse from(Payment payment) {
            return new PaymentResponse(
                    payment.id(),
                    payment.invoiceId(),
                    payment.subscriberId(),
                    payment.currency(),
                    payment.tenderedAmount(),
                    payment.appliedUsd(),
                    payment.appliedLbp(),
                    payment.method(),
                    payment.receivedAt());
        }
    }
}

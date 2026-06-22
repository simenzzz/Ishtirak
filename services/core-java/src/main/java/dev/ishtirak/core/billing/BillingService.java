package dev.ishtirak.core.billing;

import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.domain.Invoice;
import dev.ishtirak.core.domain.InvoiceStatus;
import dev.ishtirak.core.domain.OperatorBillingSettings;
import dev.ishtirak.core.domain.Reading;
import dev.ishtirak.core.domain.ResourceStatus;
import dev.ishtirak.core.domain.Subscriber;
import dev.ishtirak.core.domain.Tier;
import dev.ishtirak.core.events.OutboxService;
import dev.ishtirak.core.persistence.BillingRunEntity;
import dev.ishtirak.core.persistence.InvoiceEntity;
import dev.ishtirak.core.persistence.OperatorEntity;
import dev.ishtirak.core.persistence.ReadingEntity;
import dev.ishtirak.core.persistence.Repositories;
import dev.ishtirak.core.persistence.SubscriberEntity;
import dev.ishtirak.core.persistence.TierEntity;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BillingService {
    private final Repositories.Operators operators;
    private final Repositories.Subscribers subscribers;
    private final Repositories.Tiers tiers;
    private final Repositories.Readings readings;
    private final Repositories.Invoices invoices;
    private final Repositories.Payments payments;
    private final Repositories.BillingRuns billingRuns;
    private final OutboxService outbox;
    private final BillingCalculator calculator;
    private final Clock clock;

    @Autowired
    public BillingService(
            Repositories.Operators operators,
            Repositories.Subscribers subscribers,
            Repositories.Tiers tiers,
            Repositories.Readings readings,
            Repositories.Invoices invoices,
            Repositories.Payments payments,
            Repositories.BillingRuns billingRuns,
            OutboxService outbox,
            BillingCalculator calculator,
            Clock clock) {
        this.operators = operators;
        this.subscribers = subscribers;
        this.tiers = tiers;
        this.readings = readings;
        this.invoices = invoices;
        this.payments = payments;
        this.billingRuns = billingRuns;
        this.outbox = outbox;
        this.calculator = calculator;
        this.clock = clock;
    }

    @Transactional
    public List<Invoice> runBilling(
            UUID operatorId,
            LocalDate periodStart,
            LocalDate periodEnd,
            String idempotencyKey) {
        if (!periodEnd.isAfter(periodStart)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "periodEnd must be after periodStart");
        }
        OperatorEntity operator = operators.lockById(operatorId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Operator not found"));
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            var existingRun = billingRuns.findByOperatorIdAndIdempotencyKey(operatorId, idempotencyKey);
            if (existingRun.isPresent()) {
                BillingRunEntity run = existingRun.get();
                if (!run.periodStart().equals(periodStart) || !run.periodEnd().equals(periodEnd)) {
                    throw new ApiException(HttpStatus.CONFLICT, "CONFLICT", "Idempotency key reused for different period");
                }
                return invoices.findByIdIn(run.invoiceIds().stream().toList()).stream()
                        .map(InvoiceEntity::toDomain)
                        .toList();
            }
        }
        OperatorBillingSettings settings = operator.toDomain();
        List<Invoice> issued = subscribers.findByOperatorIdAndStatus(operatorId, ResourceStatus.ACTIVE).stream()
                .map(SubscriberEntity::toDomain)
                .map(subscriber -> issueInvoice(operatorId, subscriber, settings, periodStart, periodEnd))
                .toList();
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            billingRuns.save(new BillingRunEntity(
                    UUID.randomUUID(),
                    operatorId,
                    idempotencyKey,
                    periodStart,
                    periodEnd,
                    issued.stream().map(Invoice::id).collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new)),
                    clock.instant()));
        }
        return issued;
    }

    public List<Invoice> listInvoices(UUID operatorId) {
        return invoices.findByOperatorId(operatorId).stream().map(InvoiceEntity::toDomain).toList();
    }

    public Invoice getInvoice(UUID operatorId, UUID invoiceId) {
        return invoices.findByOperatorIdAndId(operatorId, invoiceId)
                .map(InvoiceEntity::toDomain)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Invoice not found"));
    }

    public List<Invoice> listMyInvoices(UUID operatorId, UUID subscriberId) {
        return invoices.findByOperatorIdAndSubscriberIdOrderByPeriodEndDescIssuedAtDesc(operatorId, subscriberId).stream()
                .map(InvoiceEntity::toDomain)
                .toList();
    }

    public Invoice getMyInvoice(UUID operatorId, UUID subscriberId, UUID invoiceId) {
        Invoice invoice = getInvoice(operatorId, invoiceId);
        if (!invoice.subscriberId().equals(subscriberId)) {
            throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Invoice not found");
        }
        return invoice;
    }

    /**
     * Re-issue an invoice that was held for review (e.g. after the operator recorded a
     * corrective meter reading). Recomputes consumption from the current readings; on
     * success the invoice becomes ISSUED and the subscriber gets the bill push.
     */
    @Transactional
    public Invoice reissue(UUID operatorId, UUID invoiceId) {
        InvoiceEntity entity = invoices.lockByOperatorIdAndId(operatorId, invoiceId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Invoice not found"));
        Invoice invoice = entity.toDomain();
        if (invoice.status() != InvoiceStatus.NEEDS_REVIEW) {
            throw new ApiException(HttpStatus.CONFLICT, "CONFLICT", "Only invoices under review can be re-issued");
        }
        OperatorBillingSettings settings = operators.lockById(operatorId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Operator not found"))
                .toDomain();
        Subscriber subscriber = subscribers.findByOperatorIdAndId(operatorId, invoice.subscriberId())
                .map(SubscriberEntity::toDomain)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Subscriber not found"));
        Tier tier = tiers.findByOperatorIdAndId(operatorId, subscriber.tierId())
                .map(TierEntity::toDomain)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Tier not found"));
        BigDecimal kwhConsumed = computeConsumption(operatorId, subscriber.id(), invoice.periodStart(), invoice.periodEnd())
                .orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "CONFLICT",
                        "Consumption still cannot be computed; record a corrective reading first"));
        BillingCalculator.InvoiceAmounts amounts =
                calculator.calculate(tier, tier.effectivePolicy(settings.defaultTariffPolicy()), kwhConsumed);
        entity.reissue(amounts.amountUsd(), amounts.amountLbp(), kwhConsumed);
        Invoice saved = entity.toDomain();
        enqueueInvoiceIssued(saved);
        return saved;
    }

    /** Void an under-review or unpaid issued invoice (operator write-off / meter fault). */
    @Transactional
    public Invoice voidInvoice(UUID operatorId, UUID invoiceId) {
        InvoiceEntity entity = invoices.lockByOperatorIdAndId(operatorId, invoiceId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Invoice not found"));
        Invoice invoice = entity.toDomain();
        if (invoice.status() != InvoiceStatus.NEEDS_REVIEW && invoice.status() != InvoiceStatus.ISSUED) {
            throw new ApiException(HttpStatus.CONFLICT, "CONFLICT", "Only an under-review or issued invoice can be voided");
        }
        if (!payments.findByOperatorIdAndInvoiceId(operatorId, invoiceId).isEmpty()) {
            throw new ApiException(HttpStatus.CONFLICT, "CONFLICT", "Cannot void an invoice that has recorded payments");
        }
        entity.applyStatus(InvoiceStatus.VOID);
        Invoice saved = entity.toDomain();
        enqueueInvoiceStatusChanged(saved);
        return saved;
    }

    private Invoice issueInvoice(
            UUID operatorId,
            Subscriber subscriber,
            OperatorBillingSettings settings,
            LocalDate periodStart,
            LocalDate periodEnd) {
        Tier tier = tiers.findByOperatorIdAndId(operatorId, subscriber.tierId())
                .map(TierEntity::toDomain)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Tier not found"));
        var existing = invoices.findByOperatorIdAndSubscriberIdAndPeriodStartAndPeriodEnd(
                operatorId, subscriber.id(), periodStart, periodEnd);
        if (existing.isPresent()) {
            return existing.get().toDomain();
        }
        Optional<BigDecimal> consumption = computeConsumption(operatorId, subscriber.id(), periodStart, periodEnd);
        if (consumption.isEmpty()) {
            // Consumption can't be computed (missing reading or meter rollback). Hold the
            // invoice for operator review rather than aborting the whole run; emit no push.
            Invoice review = new Invoice(
                    UUID.randomUUID(),
                    operatorId,
                    subscriber.id(),
                    periodStart,
                    periodEnd,
                    BigDecimal.ZERO.setScale(2),
                    0L,
                    BigDecimal.ZERO,
                    InvoiceStatus.NEEDS_REVIEW,
                    clock.instant());
            Invoice saved = invoices.save(new InvoiceEntity(review)).toDomain();
            enqueueInvoiceStatusChanged(saved);
            return saved;
        }
        BigDecimal kwhConsumed = consumption.get();
        BillingCalculator.InvoiceAmounts amounts =
                calculator.calculate(tier, tier.effectivePolicy(settings.defaultTariffPolicy()), kwhConsumed);
        Invoice invoice = new Invoice(
                UUID.randomUUID(),
                operatorId,
                subscriber.id(),
                periodStart,
                periodEnd,
                amounts.amountUsd(),
                amounts.amountLbp(),
                kwhConsumed,
                InvoiceStatus.ISSUED,
                clock.instant());
        Invoice saved = invoices.save(new InvoiceEntity(invoice)).toDomain();
        enqueueInvoiceIssued(saved);
        return saved;
    }

    private void enqueueInvoiceIssued(Invoice invoice) {
        outbox.enqueue("invoice.issued", invoice.operatorId(), Map.of(
                "invoiceId", invoice.id(),
                "subscriberId", invoice.subscriberId(),
                "periodStart", invoice.periodStart(),
                "periodEnd", invoice.periodEnd(),
                "amountUsd", invoice.amountUsd(),
                "amountLbp", invoice.amountLbp(),
                "kwhConsumed", invoice.kwhConsumed()));
    }

    private void enqueueInvoiceStatusChanged(Invoice invoice) {
        outbox.enqueue("invoice.status.changed", invoice.operatorId(), Map.of(
                "invoiceId", invoice.id(),
                "subscriberId", invoice.subscriberId(),
                "periodStart", invoice.periodStart(),
                "periodEnd", invoice.periodEnd(),
                "status", invoice.status()));
    }

    /**
     * Consumption for a period = (reading at period end) - (reading at period start).
     * Empty when either anchor reading is missing or the meter rolled back (negative
     * delta) — the caller holds such an invoice for review instead of failing the run.
     */
    private Optional<BigDecimal> computeConsumption(
            UUID operatorId, UUID subscriberId, LocalDate periodStart, LocalDate periodEnd) {
        Optional<BigDecimal> start = readingBefore(operatorId, subscriberId, periodStart.plusDays(1));
        Optional<BigDecimal> end = readingBefore(operatorId, subscriberId, periodEnd.plusDays(1));
        if (start.isEmpty() || end.isEmpty()) {
            return Optional.empty();
        }
        BigDecimal delta = end.get().subtract(start.get());
        return delta.signum() < 0 ? Optional.empty() : Optional.of(delta);
    }

    private Optional<BigDecimal> readingBefore(UUID operatorId, UUID subscriberId, LocalDate exclusiveDate) {
        return readings.findFirstByOperatorIdAndSubscriberIdAndReadingAtLessThanOrderByReadingAtDesc(
                        operatorId, subscriberId, exclusiveDate.atStartOfDay().toInstant(ZoneOffset.UTC))
                .map(ReadingEntity::toDomain)
                .map(Reading::kwh);
    }
}

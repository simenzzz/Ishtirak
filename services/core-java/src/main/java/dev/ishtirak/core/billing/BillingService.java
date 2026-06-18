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
            Repositories.BillingRuns billingRuns,
            OutboxService outbox,
            BillingCalculator calculator,
            Clock clock) {
        this.operators = operators;
        this.subscribers = subscribers;
        this.tiers = tiers;
        this.readings = readings;
        this.invoices = invoices;
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
        return invoices.findByOperatorIdAndSubscriberId(operatorId, subscriberId).stream()
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
        BigDecimal kwhConsumed = consumption(operatorId, subscriber.id(), periodStart, periodEnd);
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
        outbox.enqueue("invoice.issued", operatorId, Map.of(
                "invoiceId", saved.id(),
                "subscriberId", saved.subscriberId(),
                "periodStart", saved.periodStart(),
                "periodEnd", saved.periodEnd(),
                "amountUsd", saved.amountUsd(),
                "amountLbp", saved.amountLbp(),
                "kwhConsumed", saved.kwhConsumed()));
        return saved;
    }

    private BigDecimal consumption(UUID operatorId, UUID subscriberId, LocalDate periodStart, LocalDate periodEnd) {
        BigDecimal start = readingBefore(operatorId, subscriberId, periodStart.plusDays(1)).kwh();
        BigDecimal end = readingBefore(operatorId, subscriberId, periodEnd.plusDays(1)).kwh();
        BigDecimal delta = end.subtract(start);
        if (delta.signum() < 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "kWh delta must be >= 0");
        }
        return delta;
    }

    private Reading readingBefore(UUID operatorId, UUID subscriberId, LocalDate exclusiveDate) {
        return readings.findFirstByOperatorIdAndSubscriberIdAndReadingAtLessThanOrderByReadingAtDesc(
                        operatorId, subscriberId, exclusiveDate.atStartOfDay().toInstant(ZoneOffset.UTC))
                .map(ReadingEntity::toDomain)
                .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Missing period reading"));
    }
}

package dev.ishtirak.core.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.domain.Invoice;
import dev.ishtirak.core.domain.InvoiceStatus;
import dev.ishtirak.core.domain.Reading;
import dev.ishtirak.core.domain.Subscriber;
import dev.ishtirak.core.persistence.ReadingEntity;
import dev.ishtirak.core.persistence.Repositories;
import dev.ishtirak.core.support.CoreTestData;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class BillingReviewFlowTest {
    @Autowired
    private BillingService billingService;
    @Autowired
    private CoreTestData testData;
    @Autowired
    private Repositories.Readings readings;
    @Autowired
    private Repositories.Invoices invoices;
    @Autowired
    private Repositories.OutboxEvents outboxEvents;

    @BeforeEach
    void reset() {
        testData.reset();
    }

    @Test
    void billingRunHoldsNegativeDeltaSubscriberAndIssuesCleanSubscriber() {
        UUID tierId = testData.seedTier().id();
        Subscriber rollback = testData.seedSubscriber(tierId);
        Subscriber clean = testData.seedSubscriber(tierId);
        saveReading(rollback.id(), "100", "2026-01-01T12:00:00Z");
        saveReading(rollback.id(), "90", "2026-01-31T12:00:00Z");
        saveReading(clean.id(), "10", "2026-01-01T12:00:00Z");
        saveReading(clean.id(), "40", "2026-01-31T12:00:00Z");

        var result = billingService.runBilling(
                CoreTestData.OPERATOR_ID,
                LocalDate.parse("2026-01-01"),
                LocalDate.parse("2026-01-31"),
                null);

        assertThat(result).extracting(Invoice::status)
                .containsExactlyInAnyOrder(InvoiceStatus.NEEDS_REVIEW, InvoiceStatus.ISSUED);
        Invoice held = invoiceFor(rollback.id());
        assertThat(held.status()).isEqualTo(InvoiceStatus.NEEDS_REVIEW);
        assertThat(held.amountUsd()).isEqualByComparingTo("0.00");
        assertThat(held.amountLbp()).isZero();
        assertThat(outboxEvents.findAll()).extracting("eventType")
                .containsExactlyInAnyOrder("invoice.status.changed", "invoice.issued");
    }

    @Test
    void billingRunHoldsSubscriberWithMissingPeriodReading() {
        UUID tierId = testData.seedTier().id();
        Subscriber subscriber = testData.seedSubscriber(tierId);
        saveReading(subscriber.id(), "25", "2026-01-31T12:00:00Z");

        var result = billingService.runBilling(
                CoreTestData.OPERATOR_ID,
                LocalDate.parse("2026-01-01"),
                LocalDate.parse("2026-01-31"),
                null);

        assertThat(result).singleElement().extracting(Invoice::status).isEqualTo(InvoiceStatus.NEEDS_REVIEW);
        assertThat(outboxEvents.findAll()).extracting("eventType").containsExactly("invoice.status.changed");
    }

    @Test
    void reissueRequiresComputableConsumptionThenEmitsReadyBill() {
        UUID tierId = testData.seedTier().id();
        Subscriber subscriber = testData.seedSubscriber(tierId);
        saveReading(subscriber.id(), "100", "2026-01-01T12:00:00Z");
        saveReading(subscriber.id(), "90", "2026-01-31T12:00:00Z");
        Invoice held = billingService.runBilling(
                CoreTestData.OPERATOR_ID,
                LocalDate.parse("2026-01-01"),
                LocalDate.parse("2026-01-31"),
                null).getFirst();

        assertThatThrownBy(() -> billingService.reissue(CoreTestData.OPERATOR_ID, held.id()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("corrective reading");

        saveReading(subscriber.id(), "130", "2026-01-31T18:00:00Z");
        Invoice reissued = billingService.reissue(CoreTestData.OPERATOR_ID, held.id());

        assertThat(reissued.status()).isEqualTo(InvoiceStatus.ISSUED);
        assertThat(reissued.kwhConsumed()).isEqualByComparingTo("30");
        assertThat(reissued.amountUsd()).isEqualByComparingTo("20.00");
        assertThat(reissued.amountLbp()).isEqualTo(1800000L);
        assertThat(outboxEvents.findAll()).extracting("eventType")
                .containsExactly("invoice.status.changed", "invoice.issued");
    }

    @Test
    void voidsNeedsReviewInvoice() {
        UUID tierId = testData.seedTier().id();
        Subscriber subscriber = testData.seedSubscriber(tierId);
        saveReading(subscriber.id(), "100", "2026-01-01T12:00:00Z");
        Invoice held = billingService.runBilling(
                CoreTestData.OPERATOR_ID,
                LocalDate.parse("2026-01-01"),
                LocalDate.parse("2026-01-31"),
                null).getFirst();

        Invoice voided = billingService.voidInvoice(CoreTestData.OPERATOR_ID, held.id());

        assertThat(voided.status()).isEqualTo(InvoiceStatus.VOID);
        assertThat(invoices.findByOperatorIdAndId(CoreTestData.OPERATOR_ID, held.id()).orElseThrow().toDomain().status())
                .isEqualTo(InvoiceStatus.VOID);
    }

    private Invoice invoiceFor(UUID subscriberId) {
        return invoices.findByOperatorIdAndSubscriberIdOrderByPeriodEndDescIssuedAtDesc(
                CoreTestData.OPERATOR_ID, subscriberId).getFirst().toDomain();
    }

    private void saveReading(UUID subscriberId, String kwh, String readingAt) {
        readings.save(new ReadingEntity(new Reading(
                UUID.randomUUID(),
                CoreTestData.OPERATOR_ID,
                subscriberId,
                new BigDecimal(kwh),
                Instant.parse(readingAt))));
    }
}

package dev.ishtirak.core.payments;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.domain.CurrencyCode;
import dev.ishtirak.core.domain.Invoice;
import dev.ishtirak.core.domain.InvoiceStatus;
import dev.ishtirak.core.domain.Payment;
import dev.ishtirak.core.domain.PaymentMethod;
import dev.ishtirak.core.persistence.InvoiceEntity;
import dev.ishtirak.core.persistence.Repositories;
import dev.ishtirak.core.support.CoreTestData;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class PaymentServiceTest {
    @Autowired
    private PaymentService service;
    @Autowired
    private CoreTestData testData;
    @Autowired
    private Repositories.Invoices invoices;
    @Autowired
    private Repositories.Payments payments;

    @BeforeEach
    void reset() {
        testData.reset();
    }

    @Test
    void appliesUsdPaymentToLbpUsingInvoiceRatio() {
        Invoice invoice = saveInvoice(new BigDecimal("10.00"), 900000L);

        Payment payment = service.record(
                invoice.operatorId(),
                invoice.id(),
                CurrencyCode.USD,
                new BigDecimal("2.255"),
                PaymentMethod.CASH);

        assertThat(payment.appliedUsd()).isEqualByComparingTo("2.26");
        assertThat(payment.appliedLbp()).isEqualTo(202950L);
    }

    @Test
    void appliesLbpPaymentToUsdUsingInvoiceRatio() {
        Invoice invoice = saveInvoice(new BigDecimal("10.00"), 900000L);

        Payment payment = service.record(
                invoice.operatorId(),
                invoice.id(),
                CurrencyCode.LBP,
                new BigDecimal("225500"),
                PaymentMethod.WHISH);

        assertThat(payment.appliedUsd()).isEqualByComparingTo("2.51");
        assertThat(payment.appliedLbp()).isEqualTo(225500L);
    }

    @Test
    void rejectsOverpaymentAndMarksPaidInvoice() {
        Invoice invoice = saveInvoice(new BigDecimal("10.00"), 900000L);

        service.record(invoice.operatorId(), invoice.id(), CurrencyCode.USD, new BigDecimal("10.00"), PaymentMethod.CASH);

        assertThat(invoices.findByOperatorIdAndId(invoice.operatorId(), invoice.id()).orElseThrow().toDomain().status())
                .isEqualTo(InvoiceStatus.PAID);
        assertThatThrownBy(() -> service.record(
                        invoice.operatorId(),
                        invoice.id(),
                        CurrencyCode.USD,
                        new BigDecimal("0.01"),
                        PaymentMethod.CASH))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("exceeds");
    }

    @Test
    void capsFinalCrossCurrencyPaymentToOutstandingBalance() {
        Invoice invoice = saveInvoice(new BigDecimal("10.00"), 900001L);

        service.record(invoice.operatorId(), invoice.id(), CurrencyCode.USD, new BigDecimal("9.99"), PaymentMethod.CASH);
        Payment finalPayment = service.record(
                invoice.operatorId(),
                invoice.id(),
                CurrencyCode.USD,
                new BigDecimal("0.02"),
                PaymentMethod.CASH);

        assertThat(finalPayment.appliedUsd()).isEqualByComparingTo("0.01");
        assertThat(finalPayment.appliedLbp()).isEqualTo(900L);
        assertThat(invoices.findByOperatorIdAndId(invoice.operatorId(), invoice.id()).orElseThrow().toDomain().status())
                .isEqualTo(InvoiceStatus.PAID);
    }

    @Test
    void rejectsUnsupportedTenderForSingleCurrencyInvoice() {
        Invoice invoice = saveInvoice(new BigDecimal("10.00"), 0L);

        assertThatThrownBy(() -> service.record(
                        invoice.operatorId(),
                        invoice.id(),
                        CurrencyCode.LBP,
                        new BigDecimal("1000"),
                        PaymentMethod.CASH))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("does not accept LBP");
    }

    @Test
    void concurrentPaymentsCannotOverpayInvoice() throws Exception {
        Invoice invoice = saveInvoice(new BigDecimal("10.00"), 900000L);
        CountDownLatch start = new CountDownLatch(1);
        var executor = Executors.newFixedThreadPool(2);
        List<Future<Boolean>> results = List.of(
                executor.submit(() -> recordAfterStart(start, invoice)),
                executor.submit(() -> recordAfterStart(start, invoice)));

        start.countDown();

        assertThat(results.stream().filter(this::succeeded).count()).isEqualTo(1);
        assertThat(payments.findByOperatorIdAndInvoiceId(invoice.operatorId(), invoice.id())).hasSize(1);
        executor.shutdownNow();
    }

    private Invoice saveInvoice(BigDecimal usd, long lbp) {
        UUID tierId = testData.seedTier().id();
        UUID subscriberId = testData.seedSubscriber(tierId).id();
        Invoice invoice = new Invoice(
                UUID.randomUUID(),
                CoreTestData.OPERATOR_ID,
                subscriberId,
                LocalDate.parse("2026-01-01"),
                LocalDate.parse("2026-01-31"),
                usd,
                lbp,
                new BigDecimal("20"),
                InvoiceStatus.ISSUED,
                Instant.parse("2026-02-01T00:00:00Z"));
        return invoices.save(new InvoiceEntity(invoice)).toDomain();
    }

    private Boolean recordAfterStart(CountDownLatch start, Invoice invoice) throws Exception {
        start.await();
        service.record(invoice.operatorId(), invoice.id(), CurrencyCode.USD, new BigDecimal("10.00"), PaymentMethod.CASH);
        return true;
    }

    private boolean succeeded(Future<Boolean> result) {
        try {
            return Boolean.TRUE.equals(result.get());
        } catch (Exception ex) {
            return false;
        }
    }
}

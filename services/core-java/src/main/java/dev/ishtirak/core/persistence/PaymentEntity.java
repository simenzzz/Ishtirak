package dev.ishtirak.core.persistence;

import dev.ishtirak.core.domain.CurrencyCode;
import dev.ishtirak.core.domain.Payment;
import dev.ishtirak.core.domain.PaymentMethod;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "payments")
public class PaymentEntity {
    @Id
    private UUID id;
    private UUID operatorId;
    private UUID invoiceId;
    private UUID subscriberId;
    @Enumerated(EnumType.STRING)
    private CurrencyCode currency;
    private BigDecimal tenderedAmount;
    private BigDecimal appliedUsd;
    private long appliedLbp;
    @Enumerated(EnumType.STRING)
    private PaymentMethod method;
    private Instant receivedAt;

    protected PaymentEntity() {
    }

    public PaymentEntity(Payment payment) {
        this.id = payment.id();
        this.operatorId = payment.operatorId();
        this.invoiceId = payment.invoiceId();
        this.subscriberId = payment.subscriberId();
        this.currency = payment.currency();
        this.tenderedAmount = payment.tenderedAmount();
        this.appliedUsd = payment.appliedUsd();
        this.appliedLbp = payment.appliedLbp();
        this.method = payment.method();
        this.receivedAt = payment.receivedAt();
    }

    public Payment toDomain() {
        return new Payment(id, operatorId, invoiceId, subscriberId, currency,
                tenderedAmount, appliedUsd, appliedLbp, method, receivedAt);
    }
}

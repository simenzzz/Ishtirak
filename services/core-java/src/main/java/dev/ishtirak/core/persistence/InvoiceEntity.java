package dev.ishtirak.core.persistence;

import dev.ishtirak.core.domain.Invoice;
import dev.ishtirak.core.domain.InvoiceStatus;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "invoices", uniqueConstraints = @UniqueConstraint(
        columnNames = {"operator_id", "subscriber_id", "period_start", "period_end"}))
public class InvoiceEntity {
    @Id
    private UUID id;
    private UUID operatorId;
    private UUID subscriberId;
    private LocalDate periodStart;
    private LocalDate periodEnd;
    private BigDecimal amountUsd;
    private long amountLbp;
    private BigDecimal kwhConsumed;
    @Enumerated(EnumType.STRING)
    private InvoiceStatus status;
    private Instant issuedAt;
    @Version
    private long version;

    protected InvoiceEntity() {
    }

    public InvoiceEntity(Invoice invoice) {
        this.id = invoice.id();
        this.operatorId = invoice.operatorId();
        this.subscriberId = invoice.subscriberId();
        this.periodStart = invoice.periodStart();
        this.periodEnd = invoice.periodEnd();
        this.amountUsd = invoice.amountUsd();
        this.amountLbp = invoice.amountLbp();
        this.kwhConsumed = invoice.kwhConsumed();
        this.status = invoice.status();
        this.issuedAt = invoice.issuedAt();
    }

    public UUID id() {
        return id;
    }

    public void applyStatus(InvoiceStatus nextStatus) {
        status = nextStatus;
    }

    /** Replace the computed amounts/consumption and mark the invoice ISSUED (re-issue path). */
    public void reissue(BigDecimal nextAmountUsd, long nextAmountLbp, BigDecimal nextKwhConsumed) {
        amountUsd = nextAmountUsd;
        amountLbp = nextAmountLbp;
        kwhConsumed = nextKwhConsumed;
        status = InvoiceStatus.ISSUED;
    }

    public Invoice toDomain() {
        return new Invoice(id, operatorId, subscriberId, periodStart, periodEnd,
                amountUsd, amountLbp, kwhConsumed, status, issuedAt);
    }
}

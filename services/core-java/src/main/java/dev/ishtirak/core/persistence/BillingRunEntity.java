package dev.ishtirak.core.persistence;

import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "billing_runs", uniqueConstraints = @UniqueConstraint(columnNames = {"operator_id", "idempotency_key"}))
public class BillingRunEntity {
    @Id
    private UUID id;
    private UUID operatorId;
    private String idempotencyKey;
    private LocalDate periodStart;
    private LocalDate periodEnd;
    private int invoiceCount;
    private Instant createdAt;
    @ElementCollection
    @CollectionTable(name = "billing_run_invoices", joinColumns = @JoinColumn(name = "billing_run_id"))
    @Column(name = "invoice_id")
    private Set<UUID> invoiceIds = new LinkedHashSet<>();

    protected BillingRunEntity() {
    }

    public BillingRunEntity(
            UUID id,
            UUID operatorId,
            String idempotencyKey,
            LocalDate periodStart,
            LocalDate periodEnd,
            Set<UUID> invoiceIds,
            Instant createdAt) {
        this.id = id;
        this.operatorId = operatorId;
        this.idempotencyKey = idempotencyKey;
        this.periodStart = periodStart;
        this.periodEnd = periodEnd;
        this.invoiceIds = Set.copyOf(invoiceIds);
        this.invoiceCount = invoiceIds.size();
        this.createdAt = createdAt;
    }

    public LocalDate periodStart() {
        return periodStart;
    }

    public LocalDate periodEnd() {
        return periodEnd;
    }

    public Set<UUID> invoiceIds() {
        return Set.copyOf(invoiceIds);
    }
}

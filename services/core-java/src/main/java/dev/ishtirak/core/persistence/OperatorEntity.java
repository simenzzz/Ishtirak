package dev.ishtirak.core.persistence;

import dev.ishtirak.core.domain.OperatorBillingSettings;
import dev.ishtirak.core.domain.TariffPolicy;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "operators")
public class OperatorEntity {
    @Id
    private UUID id;
    private String name;
    @Enumerated(EnumType.STRING)
    private TariffPolicy defaultTariffPolicy;
    private Instant createdAt;

    protected OperatorEntity() {
    }

    public OperatorEntity(UUID id, String name, TariffPolicy defaultTariffPolicy, Instant createdAt) {
        this.id = id;
        this.name = name;
        this.defaultTariffPolicy = defaultTariffPolicy;
        this.createdAt = createdAt;
    }

    public UUID id() {
        return id;
    }

    public String name() {
        return name;
    }

    public OperatorBillingSettings toDomain() {
        return new OperatorBillingSettings(id, defaultTariffPolicy);
    }
}

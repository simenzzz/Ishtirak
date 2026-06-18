package dev.ishtirak.core.persistence;

import dev.ishtirak.core.domain.ResourceStatus;
import dev.ishtirak.core.domain.TariffPolicy;
import dev.ishtirak.core.domain.Tier;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "tiers")
public class TierEntity {
    @Id
    private UUID id;
    private UUID operatorId;
    private String name;
    private int amperage;
    @Enumerated(EnumType.STRING)
    private TariffPolicy tariffPolicyOverride;
    private BigDecimal standingFeeUsd;
    private long standingFeeLbp;
    private BigDecimal perKwhRateUsd;
    private long perKwhRateLbp;
    @Enumerated(EnumType.STRING)
    private ResourceStatus status;

    protected TierEntity() {
    }

    public TierEntity(Tier tier) {
        this.id = tier.id();
        this.operatorId = tier.operatorId();
        this.name = tier.name();
        this.amperage = tier.amperage();
        this.tariffPolicyOverride = tier.tariffPolicyOverride();
        this.standingFeeUsd = tier.standingFeeUsd();
        this.standingFeeLbp = tier.standingFeeLbp();
        this.perKwhRateUsd = tier.perKwhRateUsd();
        this.perKwhRateLbp = tier.perKwhRateLbp();
        this.status = tier.status();
    }

    public UUID id() {
        return id;
    }

    public Tier toDomain() {
        return new Tier(id, operatorId, name, amperage, tariffPolicyOverride,
                standingFeeUsd, standingFeeLbp, perKwhRateUsd, perKwhRateLbp, status);
    }
}

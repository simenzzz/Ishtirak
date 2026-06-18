package dev.ishtirak.core.domain;

import java.math.BigDecimal;
import java.util.UUID;

public record Tier(
        UUID id,
        UUID operatorId,
        String name,
        int amperage,
        TariffPolicy tariffPolicyOverride,
        BigDecimal standingFeeUsd,
        long standingFeeLbp,
        BigDecimal perKwhRateUsd,
        long perKwhRateLbp,
        ResourceStatus status) {

    public TariffPolicy effectivePolicy(TariffPolicy operatorDefault) {
        return tariffPolicyOverride == null ? operatorDefault : tariffPolicyOverride;
    }
}

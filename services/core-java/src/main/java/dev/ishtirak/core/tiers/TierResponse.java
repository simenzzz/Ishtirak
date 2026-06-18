package dev.ishtirak.core.tiers;

import dev.ishtirak.core.domain.ResourceStatus;
import dev.ishtirak.core.domain.TariffPolicy;
import dev.ishtirak.core.domain.Tier;
import java.math.BigDecimal;
import java.util.UUID;

public record TierResponse(
        UUID id,
        String name,
        int amperage,
        TariffPolicy tariffPolicyOverride,
        TariffPolicy effectiveTariffPolicy,
        BigDecimal standingFeeUsd,
        long standingFeeLbp,
        BigDecimal perKwhRateUsd,
        long perKwhRateLbp,
        ResourceStatus status) {

    static TierResponse from(Tier tier, TariffPolicy defaultPolicy) {
        return new TierResponse(
                tier.id(),
                tier.name(),
                tier.amperage(),
                tier.tariffPolicyOverride(),
                tier.effectivePolicy(defaultPolicy),
                tier.standingFeeUsd(),
                tier.standingFeeLbp(),
                tier.perKwhRateUsd(),
                tier.perKwhRateLbp(),
                tier.status());
    }
}

package dev.ishtirak.core.billing;

import dev.ishtirak.core.domain.TariffPolicy;
import dev.ishtirak.core.domain.Tier;
import java.math.BigDecimal;
import java.math.RoundingMode;
import org.springframework.stereotype.Component;

@Component
public class BillingCalculator {
    private static final int USD_SCALE = 2;

    public InvoiceAmounts calculate(Tier tier, TariffPolicy policy, BigDecimal kwhConsumed) {
        BigDecimal amountUsd = switch (policy) {
            case FLAT -> tier.standingFeeUsd();
            case METERED -> tier.perKwhRateUsd().multiply(kwhConsumed);
            case HYBRID -> tier.standingFeeUsd().add(tier.perKwhRateUsd().multiply(kwhConsumed));
        };
        BigDecimal amountLbp = switch (policy) {
            case FLAT -> BigDecimal.valueOf(tier.standingFeeLbp());
            case METERED -> BigDecimal.valueOf(tier.perKwhRateLbp()).multiply(kwhConsumed);
            case HYBRID -> BigDecimal.valueOf(tier.standingFeeLbp())
                    .add(BigDecimal.valueOf(tier.perKwhRateLbp()).multiply(kwhConsumed));
        };
        return new InvoiceAmounts(roundUsd(amountUsd), roundLbp(amountLbp));
    }

    public BigDecimal roundUsd(BigDecimal amount) {
        return amount.setScale(USD_SCALE, RoundingMode.HALF_UP);
    }

    public long roundLbp(BigDecimal amount) {
        return amount.setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    public record InvoiceAmounts(BigDecimal amountUsd, long amountLbp) {
    }
}

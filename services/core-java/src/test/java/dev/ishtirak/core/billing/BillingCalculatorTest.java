package dev.ishtirak.core.billing;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ishtirak.core.domain.ResourceStatus;
import dev.ishtirak.core.domain.TariffPolicy;
import dev.ishtirak.core.domain.Tier;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class BillingCalculatorTest {
    private final BillingCalculator calculator = new BillingCalculator();
    private final Tier tier = new Tier(
            UUID.randomUUID(),
            UUID.randomUUID(),
            "10A",
            10,
            null,
            new BigDecimal("12.345"),
            111111L,
            new BigDecimal("0.333"),
            22222L,
            ResourceStatus.ACTIVE);

    @Test
    void calculatesFlatTariffInBothCurrencies() {
        BillingCalculator.InvoiceAmounts amounts = calculator.calculate(tier, TariffPolicy.FLAT, new BigDecimal("20"));

        assertThat(amounts.amountUsd()).isEqualByComparingTo("12.35");
        assertThat(amounts.amountLbp()).isEqualTo(111111L);
    }

    @Test
    void calculatesMeteredTariffInBothCurrencies() {
        BillingCalculator.InvoiceAmounts amounts = calculator.calculate(tier, TariffPolicy.METERED, new BigDecimal("20"));

        assertThat(amounts.amountUsd()).isEqualByComparingTo("6.66");
        assertThat(amounts.amountLbp()).isEqualTo(444440L);
    }

    @Test
    void calculatesHybridTariffInBothCurrencies() {
        BillingCalculator.InvoiceAmounts amounts = calculator.calculate(tier, TariffPolicy.HYBRID, new BigDecimal("20"));

        assertThat(amounts.amountUsd()).isEqualByComparingTo("19.01");
        assertThat(amounts.amountLbp()).isEqualTo(555551L);
    }
}

package dev.ishtirak.core.domain;

import java.util.UUID;

public record OperatorBillingSettings(UUID operatorId, TariffPolicy defaultTariffPolicy) {
}

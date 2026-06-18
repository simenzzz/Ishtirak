package dev.ishtirak.core.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record Payment(
        UUID id,
        UUID operatorId,
        UUID invoiceId,
        UUID subscriberId,
        CurrencyCode currency,
        BigDecimal tenderedAmount,
        BigDecimal appliedUsd,
        long appliedLbp,
        PaymentMethod method,
        Instant receivedAt) {
}

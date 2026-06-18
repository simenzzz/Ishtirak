package dev.ishtirak.core.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record Invoice(
        UUID id,
        UUID operatorId,
        UUID subscriberId,
        LocalDate periodStart,
        LocalDate periodEnd,
        BigDecimal amountUsd,
        long amountLbp,
        BigDecimal kwhConsumed,
        InvoiceStatus status,
        Instant issuedAt) {
}

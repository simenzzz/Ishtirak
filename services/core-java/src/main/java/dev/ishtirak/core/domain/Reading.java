package dev.ishtirak.core.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record Reading(UUID id, UUID operatorId, UUID subscriberId, BigDecimal kwh, Instant readingAt) {
}

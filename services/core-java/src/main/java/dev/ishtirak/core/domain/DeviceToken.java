package dev.ishtirak.core.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * A long-lived, operator-scoped credential held by a generator-site edge agent.
 * The secret itself is never part of the domain object — only its metadata.
 */
public record DeviceToken(
        UUID id,
        UUID operatorId,
        String label,
        DeviceTokenStatus status,
        Instant createdAt,
        Instant lastSeenAt) {
}

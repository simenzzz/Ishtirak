package dev.ishtirak.core.domain;

import java.time.Instant;
import java.util.UUID;

public record Subscriber(
        UUID id,
        UUID operatorId,
        String name,
        UUID tierId,
        String meterId,
        ResourceStatus status,
        Instant createdAt) {
}

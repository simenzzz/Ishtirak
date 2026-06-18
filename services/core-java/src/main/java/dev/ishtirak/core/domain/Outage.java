package dev.ishtirak.core.domain;

import java.time.Instant;
import java.util.UUID;

public record Outage(
        UUID id,
        UUID operatorId,
        Instant startsAt,
        Instant endsAt,
        OutageReason reason,
        Instant createdAt) {
}

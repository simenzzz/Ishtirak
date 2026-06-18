package dev.ishtirak.core.events;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record EventEnvelope(
        UUID eventId,
        String eventType,
        UUID operatorId,
        Instant occurredAt,
        Map<String, Object> payload) {
}

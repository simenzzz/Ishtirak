package dev.ishtirak.core.readings;

import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.domain.Reading;
import dev.ishtirak.core.events.OutboxService;
import dev.ishtirak.core.persistence.ReadingEntity;
import dev.ishtirak.core.persistence.Repositories;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ReadingService {
    private final Repositories.Readings readings;
    private final Repositories.Subscribers subscribers;
    private final OutboxService outbox;

    public ReadingService(Repositories.Readings readings, Repositories.Subscribers subscribers, OutboxService outbox) {
        this.readings = readings;
        this.subscribers = subscribers;
        this.outbox = outbox;
    }

    @Transactional
    public Reading record(UUID operatorId, boolean admin, RecordReadingRequest request) {
        subscribers.lockByOperatorIdAndId(operatorId, request.subscriberId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Subscriber not found"));
        var previous = readings.findFirstByOperatorIdAndSubscriberIdAndReadingAtLessThanEqualOrderByReadingAtDesc(
                        operatorId, request.subscriberId(), request.readingAt())
                .map(ReadingEntity::toDomain)
                .orElse(null);
        if (previous != null && request.readingAt().equals(previous.readingAt())) {
            throw new ApiException(HttpStatus.CONFLICT, "CONFLICT", "Reading already exists at this time");
        }
        var latest = readings.findByOperatorIdAndSubscriberIdOrderByReadingAtDesc(operatorId, request.subscriberId()).stream()
                .findFirst()
                .map(ReadingEntity::toDomain);
        boolean backdated = latest.isPresent() && request.readingAt().isBefore(latest.get().readingAt());
        boolean rollback = previous != null && request.kwh().compareTo(previous.kwh()) < 0;
        if (!admin && (backdated || rollback)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Admin role required for corrective readings");
        }
        return persist(operatorId, request.subscriberId(), request.kwh(), request.readingAt());
    }

    /**
     * Trusted ingest path for device-sourced readings. Unlike the staff path it
     * permits backdated points and meter rollbacks (an edge agent flushing its
     * offline buffer, or a swapped/reset meter — both real data that analytics
     * scores downstream), but stays idempotent: an exact replay of the same
     * cumulative value at the same instant is a no-op, while a differing value at
     * an already-recorded instant is a conflict rather than silent overwrite.
     */
    @Transactional
    public IngestOutcome ingest(UUID operatorId, UUID subscriberId, BigDecimal kwh, Instant readingAt) {
        subscribers.lockByOperatorIdAndId(operatorId, subscriberId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Subscriber not found"));
        Reading existing = readings.findFirstByOperatorIdAndSubscriberIdAndReadingAtLessThanEqualOrderByReadingAtDesc(
                        operatorId, subscriberId, readingAt)
                .map(ReadingEntity::toDomain)
                .filter(reading -> reading.readingAt().equals(readingAt))
                .orElse(null);
        if (existing != null) {
            if (existing.kwh().compareTo(kwh) == 0) {
                return IngestOutcome.DUPLICATE;
            }
            throw new ApiException(HttpStatus.CONFLICT, "CONFLICT", "Conflicting reading already recorded at this time");
        }
        persist(operatorId, subscriberId, kwh, readingAt);
        return IngestOutcome.RECORDED;
    }

    private Reading persist(UUID operatorId, UUID subscriberId, BigDecimal kwh, Instant readingAt) {
        Reading reading = new Reading(UUID.randomUUID(), operatorId, subscriberId, kwh, readingAt);
        Reading saved = readings.save(new ReadingEntity(reading)).toDomain();
        outbox.enqueue("reading.recorded", operatorId, Map.of(
                "readingId", saved.id(),
                "subscriberId", saved.subscriberId(),
                "kwh", saved.kwh(),
                "readingAt", saved.readingAt()));
        return saved;
    }

    public enum IngestOutcome {
        RECORDED,
        DUPLICATE
    }

    public List<Reading> list(UUID operatorId, UUID subscriberId) {
        if (subscribers.findByOperatorIdAndId(operatorId, subscriberId).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Subscriber not found");
        }
        return readings.findByOperatorIdAndSubscriberIdOrderByReadingAtDesc(operatorId, subscriberId).stream()
                .map(ReadingEntity::toDomain)
                .toList();
    }

    public record RecordReadingRequest(
            @NotNull UUID subscriberId,
            @NotNull @PositiveOrZero BigDecimal kwh,
            @NotNull Instant readingAt) {
    }
}

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
    public Reading record(UUID operatorId, RecordReadingRequest request) {
        subscribers.lockByOperatorIdAndId(operatorId, request.subscriberId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Subscriber not found"));
        readings.findFirstByOperatorIdAndSubscriberIdAndReadingAtLessThanEqualOrderByReadingAtDesc(
                        operatorId, request.subscriberId(), request.readingAt())
                .map(ReadingEntity::toDomain)
                .ifPresent(previous -> {
                    if (request.readingAt().equals(previous.readingAt())) {
                        throw new ApiException(HttpStatus.CONFLICT, "CONFLICT", "Reading already exists at this time");
                    }
                    if (request.kwh().compareTo(previous.kwh()) < 0) {
                        throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "kWh must be monotonic");
                    }
                });
        readings.findFirstByOperatorIdAndSubscriberIdAndReadingAtGreaterThanOrderByReadingAtAsc(
                        operatorId, request.subscriberId(), request.readingAt())
                .map(ReadingEntity::toDomain)
                .ifPresent(next -> {
                    if (request.kwh().compareTo(next.kwh()) > 0) {
                        throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "kWh must be monotonic");
                    }
                });
        Reading reading = new Reading(UUID.randomUUID(), operatorId, request.subscriberId(), request.kwh(), request.readingAt());
        Reading saved = readings.save(new ReadingEntity(reading)).toDomain();
        outbox.enqueue("reading.recorded", operatorId, Map.of(
                "readingId", saved.id(),
                "subscriberId", saved.subscriberId(),
                "kwh", saved.kwh(),
                "readingAt", saved.readingAt()));
        return saved;
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

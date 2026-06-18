package dev.ishtirak.core.outages;

import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.domain.Outage;
import dev.ishtirak.core.domain.OutageReason;
import dev.ishtirak.core.events.OutboxService;
import dev.ishtirak.core.persistence.OutageEntity;
import dev.ishtirak.core.persistence.Repositories;
import jakarta.validation.constraints.NotNull;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OutageService {
    private final Repositories.Outages outages;
    private final OutboxService outbox;
    private final Clock clock;

    public OutageService(Repositories.Outages outages, OutboxService outbox, Clock clock) {
        this.outages = outages;
        this.outbox = outbox;
        this.clock = clock;
    }

    public List<Outage> list(UUID operatorId) {
        return outages.findByOperatorIdOrderByStartsAtAsc(operatorId).stream()
                .map(OutageEntity::toDomain)
                .toList();
    }

    @Transactional
    public Outage schedule(UUID operatorId, ScheduleOutageRequest request) {
        if (!request.endsAt().isAfter(request.startsAt())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "endsAt must be after startsAt");
        }
        Outage outage = new Outage(
                UUID.randomUUID(),
                operatorId,
                request.startsAt(),
                request.endsAt(),
                request.reason(),
                clock.instant());
        Outage saved = outages.save(new OutageEntity(outage)).toDomain();
        outbox.enqueue("outage.scheduled", operatorId, Map.of(
                "outageId", saved.id(),
                "startsAt", saved.startsAt(),
                "endsAt", saved.endsAt(),
                "reason", saved.reason()));
        return saved;
    }

    public record ScheduleOutageRequest(
            @NotNull Instant startsAt,
            @NotNull Instant endsAt,
            @NotNull OutageReason reason) {
    }
}

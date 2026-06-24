package dev.ishtirak.core.subscribers;

import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.domain.ResourceStatus;
import dev.ishtirak.core.domain.Subscriber;
import dev.ishtirak.core.persistence.Repositories;
import dev.ishtirak.core.persistence.SubscriberEntity;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SubscriberService {
    private final Repositories.Subscribers subscribers;
    private final Repositories.Tiers tiers;
    private final Clock clock;

    @Autowired
    public SubscriberService(Repositories.Subscribers subscribers, Repositories.Tiers tiers, Clock clock) {
        this.subscribers = subscribers;
        this.tiers = tiers;
        this.clock = clock;
    }

    public List<Subscriber> list(UUID operatorId) {
        return subscribers.findByOperatorId(operatorId).stream().map(SubscriberEntity::toDomain).toList();
    }

    public Subscriber get(UUID operatorId, UUID subscriberId) {
        return subscribers.findByOperatorIdAndId(operatorId, subscriberId)
                .map(SubscriberEntity::toDomain)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Subscriber not found"));
    }

    public Subscriber create(UUID operatorId, CreateSubscriberRequest request) {
        if (tiers.findByOperatorIdAndId(operatorId, request.tierId()).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Tier not found");
        }
        String meterId = normalizeMeterId(request.meterId());
        requireMeterIdUnique(operatorId, meterId);
        Subscriber subscriber = new Subscriber(
                UUID.randomUUID(),
                operatorId,
                request.name(),
                request.tierId(),
                meterId,
                ResourceStatus.ACTIVE,
                clock.instant());
        return subscribers.save(new SubscriberEntity(subscriber)).toDomain();
    }

    /** Treat a blank meter id as "unassigned" so the partial-unique index stays NULL-only. */
    private static String normalizeMeterId(String meterId) {
        return meterId == null || meterId.isBlank() ? null : meterId.trim();
    }

    private void requireMeterIdUnique(UUID operatorId, String meterId) {
        if (meterId != null && subscribers.findByOperatorIdAndMeterId(operatorId, meterId).isPresent()) {
            throw new ApiException(HttpStatus.CONFLICT, "CONFLICT", "Meter id already assigned to a subscriber");
        }
    }

    @Transactional
    public Subscriber update(UUID operatorId, UUID subscriberId, UpdateSubscriberRequest request) {
        Subscriber current = subscribers.lockByOperatorIdAndId(operatorId, subscriberId)
                .map(SubscriberEntity::toDomain)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Subscriber not found"));
        UUID tierId = request.tierId() == null ? current.tierId() : request.tierId();
        if (tiers.findByOperatorIdAndId(operatorId, tierId).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Tier not found");
        }
        Subscriber updated = new Subscriber(
                current.id(),
                current.operatorId(),
                request.name() == null ? current.name() : request.name(),
                tierId,
                current.meterId(),
                request.status() == null ? current.status() : request.status(),
                current.createdAt());
        return subscribers.save(new SubscriberEntity(updated)).toDomain();
    }

    public record CreateSubscriberRequest(@NotBlank String name, @NotNull UUID tierId, String meterId) {
    }

    public record UpdateSubscriberRequest(@NotBlank String name, UUID tierId, ResourceStatus status) {
        @AssertTrue(message = "at least one field is required")
        public boolean isAnyFieldPresent() {
            return name != null || tierId != null || status != null;
        }
    }
}

package dev.ishtirak.core.subscribers;

import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.domain.ResourceStatus;
import dev.ishtirak.core.domain.Subscriber;
import dev.ishtirak.core.persistence.Repositories;
import dev.ishtirak.core.persistence.SubscriberEntity;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

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
        Subscriber subscriber = new Subscriber(
                UUID.randomUUID(),
                operatorId,
                request.name(),
                request.tierId(),
                request.meterId(),
                ResourceStatus.ACTIVE,
                clock.instant());
        return subscribers.save(new SubscriberEntity(subscriber)).toDomain();
    }

    public record CreateSubscriberRequest(@NotBlank String name, @NotNull UUID tierId, String meterId) {
    }
}

package dev.ishtirak.core.persistence;

import dev.ishtirak.core.domain.ResourceStatus;
import dev.ishtirak.core.domain.Subscriber;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "subscribers")
public class SubscriberEntity {
    @Id
    private UUID id;
    private UUID operatorId;
    private String name;
    private UUID tierId;
    private String meterId;
    @Enumerated(EnumType.STRING)
    private ResourceStatus status;
    private Instant createdAt;

    protected SubscriberEntity() {
    }

    public SubscriberEntity(Subscriber subscriber) {
        this.id = subscriber.id();
        this.operatorId = subscriber.operatorId();
        this.name = subscriber.name();
        this.tierId = subscriber.tierId();
        this.meterId = subscriber.meterId();
        this.status = subscriber.status();
        this.createdAt = subscriber.createdAt();
    }

    public UUID id() {
        return id;
    }

    public Subscriber toDomain() {
        return new Subscriber(id, operatorId, name, tierId, meterId, status, createdAt);
    }
}

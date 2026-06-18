package dev.ishtirak.core.persistence;

import dev.ishtirak.core.domain.ActorRole;
import dev.ishtirak.core.domain.ResourceStatus;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "operator_memberships")
public class OperatorMembershipEntity {
    @Id
    private UUID id;
    private UUID userId;
    private UUID operatorId;
    @Enumerated(EnumType.STRING)
    private ActorRole role;
    private UUID subscriberId;
    @Enumerated(EnumType.STRING)
    private ResourceStatus status;
    private Instant createdAt;

    protected OperatorMembershipEntity() {
    }

    public OperatorMembershipEntity(
            UUID id,
            UUID userId,
            UUID operatorId,
            ActorRole role,
            UUID subscriberId,
            Instant createdAt) {
        this.id = id;
        this.userId = userId;
        this.operatorId = operatorId;
        this.role = role;
        this.subscriberId = subscriberId;
        this.status = ResourceStatus.ACTIVE;
        this.createdAt = createdAt;
    }

    public UUID id() {
        return id;
    }

    public UUID userId() {
        return userId;
    }

    public UUID operatorId() {
        return operatorId;
    }

    public ActorRole role() {
        return role;
    }

    public UUID subscriberId() {
        return subscriberId;
    }

    public boolean active() {
        return status == ResourceStatus.ACTIVE;
    }
}

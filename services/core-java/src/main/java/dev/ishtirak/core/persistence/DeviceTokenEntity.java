package dev.ishtirak.core.persistence;

import dev.ishtirak.core.domain.DeviceToken;
import dev.ishtirak.core.domain.DeviceTokenStatus;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "device_tokens")
public class DeviceTokenEntity {
    @Id
    private UUID id;
    private UUID operatorId;
    private String label;
    private String tokenHash;
    @Enumerated(EnumType.STRING)
    private DeviceTokenStatus status;
    private Instant createdAt;
    private Instant lastSeenAt;

    protected DeviceTokenEntity() {
    }

    public DeviceTokenEntity(
            UUID id, UUID operatorId, String label, String tokenHash, Instant createdAt) {
        this.id = id;
        this.operatorId = operatorId;
        this.label = label;
        this.tokenHash = tokenHash;
        this.status = DeviceTokenStatus.ACTIVE;
        this.createdAt = createdAt;
    }

    public UUID id() {
        return id;
    }

    public UUID operatorId() {
        return operatorId;
    }

    public boolean active() {
        return status == DeviceTokenStatus.ACTIVE;
    }

    public void markSeen(Instant now) {
        this.lastSeenAt = now;
    }

    public void revoke() {
        this.status = DeviceTokenStatus.REVOKED;
    }

    public DeviceToken toDomain() {
        return new DeviceToken(id, operatorId, label, status, createdAt, lastSeenAt);
    }
}

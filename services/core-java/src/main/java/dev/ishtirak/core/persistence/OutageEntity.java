package dev.ishtirak.core.persistence;

import dev.ishtirak.core.domain.Outage;
import dev.ishtirak.core.domain.OutageReason;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "outages")
public class OutageEntity {
    @Id
    private UUID id;
    private UUID operatorId;
    private Instant startsAt;
    private Instant endsAt;
    @Enumerated(EnumType.STRING)
    private OutageReason reason;
    private Instant createdAt;

    protected OutageEntity() {
    }

    public OutageEntity(Outage outage) {
        this.id = outage.id();
        this.operatorId = outage.operatorId();
        this.startsAt = outage.startsAt();
        this.endsAt = outage.endsAt();
        this.reason = outage.reason();
        this.createdAt = outage.createdAt();
    }

    public Outage toDomain() {
        return new Outage(id, operatorId, startsAt, endsAt, reason, createdAt);
    }
}

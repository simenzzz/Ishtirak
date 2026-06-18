package dev.ishtirak.core.persistence;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "outbox_events")
public class OutboxEventEntity {
    @Id
    private UUID id;
    private String eventType;
    private UUID operatorId;
    private Instant occurredAt;
    @JdbcTypeCode(SqlTypes.JSON)
    private String payload;
    private int attempts;
    private Instant nextAttemptAt;
    private Instant publishedAt;
    private String lastError;
    private Instant createdAt;

    protected OutboxEventEntity() {
    }

    public OutboxEventEntity(UUID id, String eventType, UUID operatorId, Instant occurredAt, String payload) {
        this.id = id;
        this.eventType = eventType;
        this.operatorId = operatorId;
        this.occurredAt = occurredAt;
        this.payload = payload;
        this.nextAttemptAt = occurredAt;
        this.createdAt = occurredAt;
    }

    public UUID id() {
        return id;
    }

    public String eventType() {
        return eventType;
    }

    public UUID operatorId() {
        return operatorId;
    }

    public Instant occurredAt() {
        return occurredAt;
    }

    public String payload() {
        return payload;
    }

    public void markPublished(Instant now) {
        publishedAt = now;
        lastError = null;
    }

    public void markFailed(String message, Instant nextAttemptAt) {
        attempts += 1;
        this.nextAttemptAt = nextAttemptAt;
        lastError = message == null ? "publish failed" : message;
    }
}

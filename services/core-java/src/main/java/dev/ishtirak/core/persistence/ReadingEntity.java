package dev.ishtirak.core.persistence;

import dev.ishtirak.core.domain.Reading;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "readings", uniqueConstraints = @UniqueConstraint(columnNames = {
        "operator_id", "subscriber_id", "reading_at"}))
public class ReadingEntity {
    @Id
    private UUID id;
    private UUID operatorId;
    private UUID subscriberId;
    private BigDecimal kwh;
    private Instant readingAt;

    protected ReadingEntity() {
    }

    public ReadingEntity(Reading reading) {
        this.id = reading.id();
        this.operatorId = reading.operatorId();
        this.subscriberId = reading.subscriberId();
        this.kwh = reading.kwh();
        this.readingAt = reading.readingAt();
    }

    public Reading toDomain() {
        return new Reading(id, operatorId, subscriberId, kwh, readingAt);
    }
}

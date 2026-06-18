package dev.ishtirak.core.events;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.ishtirak.core.persistence.OutboxEventEntity;
import dev.ishtirak.core.persistence.Repositories;
import java.time.Clock;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class OutboxService {
    private final Repositories.OutboxEvents outboxEvents;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    @Autowired
    public OutboxService(Repositories.OutboxEvents outboxEvents, ObjectMapper objectMapper) {
        this(outboxEvents, objectMapper, Clock.systemUTC());
    }

    OutboxService(Repositories.OutboxEvents outboxEvents, ObjectMapper objectMapper, Clock clock) {
        this.outboxEvents = outboxEvents;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    public void enqueue(String eventType, UUID operatorId, Map<String, Object> payload) {
        try {
            outboxEvents.save(new OutboxEventEntity(
                    UUID.randomUUID(),
                    eventType,
                    operatorId,
                    clock.instant(),
                    objectMapper.writeValueAsString(payload)));
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Event payload is not serializable", ex);
        }
    }
}

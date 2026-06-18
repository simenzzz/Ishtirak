package dev.ishtirak.core.events;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.ishtirak.core.persistence.OutboxEventEntity;
import dev.ishtirak.core.persistence.Repositories;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class OutboxPublisher {
    private static final TypeReference<Map<String, Object>> PAYLOAD_TYPE = new TypeReference<>() {
    };
    private final Repositories.OutboxEvents outboxEvents;
    private final RabbitTemplate rabbitTemplate;
    private final ObjectMapper objectMapper;
    private final EventContractValidator validator;
    private final Clock clock;

    @Autowired
    public OutboxPublisher(
            Repositories.OutboxEvents outboxEvents,
            RabbitTemplate rabbitTemplate,
            ObjectMapper objectMapper,
            EventContractValidator validator) {
        this(outboxEvents, rabbitTemplate, objectMapper, validator, Clock.systemUTC());
    }

    OutboxPublisher(
            Repositories.OutboxEvents outboxEvents,
            RabbitTemplate rabbitTemplate,
            ObjectMapper objectMapper,
            EventContractValidator validator,
            Clock clock) {
        this.outboxEvents = outboxEvents;
        this.rabbitTemplate = rabbitTemplate;
        this.objectMapper = objectMapper;
        this.validator = validator;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${ishtirak.outbox.publish-delay-ms:1000}")
    @Transactional
    public void publishPending() {
        for (OutboxEventEntity event : outboxEvents.lockPending(clock.instant(), 50)) {
            publish(event);
        }
    }

    private void publish(OutboxEventEntity event) {
        try {
            Map<String, Object> payload = objectMapper.readValue(event.payload(), PAYLOAD_TYPE);
            EventEnvelope envelope = new EventEnvelope(
                    event.id(), event.eventType(), event.operatorId(), event.occurredAt(), payload);
            validator.validate(envelope);
            rabbitTemplate.convertAndSend("ishtirak.events", event.eventType(), envelope);
            event.markPublished(clock.instant());
        } catch (Exception ex) {
            event.markFailed(ex.getMessage(), clock.instant().plus(Duration.ofSeconds(30)));
        }
    }
}

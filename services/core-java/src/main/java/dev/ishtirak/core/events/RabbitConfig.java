package dev.ishtirak.core.events;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitConfig {
    @Bean
    TopicExchange ishtirakEventsExchange() {
        return new TopicExchange("ishtirak.events", true, false);
    }

    /**
     * Serialize outbox payloads as JSON. The default SimpleMessageConverter only
     * handles String/byte[]/Serializable, so an {@link EventEnvelope} POJO would
     * fail to publish. Reuse the application ObjectMapper so Instant fields are
     * written as ISO-8601 strings — the exact shape the outbox already validates
     * against the event contracts and that the gateway/analytics consumers expect.
     */
    @Bean
    MessageConverter eventMessageConverter(ObjectMapper objectMapper) {
        return new Jackson2JsonMessageConverter(objectMapper);
    }
}

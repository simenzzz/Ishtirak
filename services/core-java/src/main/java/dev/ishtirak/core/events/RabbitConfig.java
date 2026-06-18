package dev.ishtirak.core.events;

import org.springframework.amqp.core.TopicExchange;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitConfig {
    @Bean
    TopicExchange ishtirakEventsExchange() {
        return new TopicExchange("ishtirak.events", true, false);
    }
}

package dev.ishtirak.core.common;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class CoreBeans {
    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }
}

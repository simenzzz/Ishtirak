package dev.ishtirak.core.health;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Liveness/readiness endpoints kept on the same {@code /health} and
 * {@code /ready} convention as the other Ishtirak services. Spring Boot
 * Actuator remains available under {@code /actuator} for richer probes.
 */
@RestController
public class HealthController {

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }

    @GetMapping("/ready")
    public Map<String, Boolean> ready() {
        return Map.of("ready", true);
    }
}

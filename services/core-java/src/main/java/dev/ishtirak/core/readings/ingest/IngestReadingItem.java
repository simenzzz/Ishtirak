package dev.ishtirak.core.readings.ingest;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;

/** A single cumulative meter reading in a device ingest batch. */
public record IngestReadingItem(
        // Constrained charset: the same meter id is interpolated into an MQTT command
        // topic on the relay path, so disallow `/`, `+`, `#` and other topic specials.
        @NotBlank @Size(max = 128) @Pattern(regexp = "^[A-Za-z0-9._:-]+$") String meterId,
        @NotNull @PositiveOrZero BigDecimal kwh,
        @NotNull Instant readingAt) {
}

package dev.ishtirak.core.readings.ingest;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;

/** A single cumulative meter reading in a device ingest batch. */
public record IngestReadingItem(
        @NotBlank @Size(max = 128) String meterId,
        @NotNull @PositiveOrZero BigDecimal kwh,
        @NotNull Instant readingAt) {
}

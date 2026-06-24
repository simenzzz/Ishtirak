package dev.ishtirak.core.readings.ingest;

import java.time.Instant;
import java.util.List;

/** Per-batch ingest verdict returned to the edge agent. */
public record IngestResult(int recorded, int duplicates, List<IngestError> errors) {

    /** A single rejected reading, identified by its meter + timestamp so the agent can act on it. */
    public record IngestError(String meterId, Instant readingAt, String code, String message) {
    }
}

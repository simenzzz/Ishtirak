package dev.ishtirak.core.events;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class EventContractValidator {
    private static final Map<String, String> SCHEMAS = Map.of(
            "reading.recorded", "contracts/events/reading-recorded.schema.json",
            "invoice.issued", "contracts/events/invoice-issued.schema.json",
            "payment.received", "contracts/events/payment-received.schema.json",
            "outage.scheduled", "contracts/events/outage-scheduled.schema.json");

    private final ObjectMapper objectMapper;
    private final JsonSchemaFactory schemaFactory =
            JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012);

    public EventContractValidator(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void validate(EventEnvelope envelope) {
        try {
            JsonNode document = objectMapper.valueToTree(envelope);
            String path = SCHEMAS.get(envelope.eventType());
            if (path == null) {
                throw new IllegalArgumentException("Unknown event type: " + envelope.eventType());
            }
            try (InputStream stream = getClass().getClassLoader().getResourceAsStream(path)) {
                if (stream == null) {
                    throw new IllegalStateException("Missing event schema: " + path);
                }
                var assertions = schemaFactory.getSchema(stream).validate(document);
                if (!assertions.isEmpty()) {
                    throw new IllegalStateException("Event contract validation failed: " + assertions);
                }
            }
        } catch (IOException ex) {
            throw new IllegalStateException("Could not load event schema", ex);
        }
    }
}

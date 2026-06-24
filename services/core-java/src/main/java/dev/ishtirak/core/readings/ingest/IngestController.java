package dev.ishtirak.core.readings.ingest;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * Device-authenticated meter-reading ingest. This path is public to the internal
 * identity interceptor (like {@code /auth/*}); the device credential in the
 * {@code Authorization} header is the only authentication, resolved here.
 */
@RestController
public class IngestController {
    private static final String BEARER_PREFIX = "Bearer ";

    private final IngestService ingestService;

    public IngestController(IngestService ingestService) {
        this.ingestService = ingestService;
    }

    @PostMapping("/ingest/readings")
    IngestResult ingest(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @Valid @RequestBody IngestRequest request) {
        return ingestService.ingest(bearerToken(authorization), request.readings());
    }

    private static String bearerToken(String authorization) {
        if (authorization == null || !authorization.startsWith(BEARER_PREFIX)) {
            return null;
        }
        return authorization.substring(BEARER_PREFIX.length()).trim();
    }

    record IngestRequest(@NotEmpty @Size(max = 500) @Valid List<IngestReadingItem> readings) {
    }
}

package dev.ishtirak.core.readings;

import dev.ishtirak.core.common.PageResponse;
import dev.ishtirak.core.domain.Reading;
import dev.ishtirak.core.security.RequestIdentity;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ReadingController {
    private final ReadingService readingService;

    public ReadingController(ReadingService readingService) {
        this.readingService = readingService;
    }

    @PostMapping("/readings")
    @ResponseStatus(HttpStatus.CREATED)
    ReadingResponse record(RequestIdentity identity, @Valid @RequestBody ReadingService.RecordReadingRequest request) {
        identity.requireStaffOrAdmin();
        return ReadingResponse.from(readingService.record(identity.operatorId(), request));
    }

    @GetMapping("/subscribers/{id}/readings")
    PageResponse<ReadingResponse> list(
            RequestIdentity identity,
            @PathVariable UUID id,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        identity.requireStaffOrAdmin();
        return PageResponse.of(readingService.list(identity.operatorId(), id), page, limit)
                .map(ReadingResponse::from);
    }

    @GetMapping("/me/readings")
    PageResponse<ReadingResponse> listMine(
            RequestIdentity identity,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return PageResponse.of(readingService.list(identity.operatorId(), identity.requireSubscriberId()), page, limit)
                .map(ReadingResponse::from);
    }

    record ReadingResponse(UUID id, UUID subscriberId, BigDecimal kwh, Instant readingAt) {
        static ReadingResponse from(Reading reading) {
            return new ReadingResponse(reading.id(), reading.subscriberId(), reading.kwh(), reading.readingAt());
        }
    }
}

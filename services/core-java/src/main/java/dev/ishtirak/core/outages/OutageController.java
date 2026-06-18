package dev.ishtirak.core.outages;

import dev.ishtirak.core.domain.Outage;
import dev.ishtirak.core.domain.OutageReason;
import dev.ishtirak.core.security.RequestIdentity;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OutageController {
    private final OutageService outageService;

    public OutageController(OutageService outageService) {
        this.outageService = outageService;
    }

    @GetMapping("/outages")
    List<OutageResponse> list(RequestIdentity identity) {
        return outageService.list(identity.operatorId()).stream().map(OutageResponse::from).toList();
    }

    @PostMapping("/outages")
    @ResponseStatus(HttpStatus.CREATED)
    OutageScheduledResponse schedule(
            RequestIdentity identity,
            @Valid @RequestBody OutageService.ScheduleOutageRequest request) {
        identity.requireAdmin();
        return OutageScheduledResponse.from(outageService.schedule(identity.operatorId(), request));
    }

    record OutageResponse(
            UUID id,
            Instant startsAt,
            Instant endsAt,
            OutageReason reason,
            Instant createdAt) {
        static OutageResponse from(Outage outage) {
            return new OutageResponse(
                    outage.id(), outage.startsAt(), outage.endsAt(), outage.reason(), outage.createdAt());
        }
    }

    record OutageScheduledResponse(UUID outageId, Instant startsAt, Instant endsAt, OutageReason reason) {
        static OutageScheduledResponse from(Outage outage) {
            return new OutageScheduledResponse(
                    outage.id(), outage.startsAt(), outage.endsAt(), outage.reason());
        }
    }
}

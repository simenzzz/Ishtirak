package dev.ishtirak.core.subscribers;

import dev.ishtirak.core.common.PageResponse;
import dev.ishtirak.core.domain.ResourceStatus;
import dev.ishtirak.core.domain.Subscriber;
import dev.ishtirak.core.security.RequestIdentity;
import jakarta.validation.Valid;
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
public class SubscriberController {
    private final SubscriberService subscriberService;

    public SubscriberController(SubscriberService subscriberService) {
        this.subscriberService = subscriberService;
    }

    @GetMapping("/subscribers")
    PageResponse<SubscriberResponse> list(
            RequestIdentity identity,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        identity.requireStaffOrAdmin();
        return PageResponse.of(subscriberService.list(identity.operatorId()), page, limit)
                .map(SubscriberResponse::from);
    }

    @PostMapping("/subscribers")
    @ResponseStatus(HttpStatus.CREATED)
    SubscriberResponse create(
            RequestIdentity identity,
            @Valid @RequestBody SubscriberService.CreateSubscriberRequest request) {
        identity.requireAdmin();
        return SubscriberResponse.from(subscriberService.create(identity.operatorId(), request));
    }

    @GetMapping("/subscribers/{id}")
    SubscriberResponse get(RequestIdentity identity, @PathVariable UUID id) {
        identity.requireStaffOrAdmin();
        return SubscriberResponse.from(subscriberService.get(identity.operatorId(), id));
    }

    record SubscriberResponse(
            UUID id,
            String name,
            UUID tierId,
            String meterId,
            ResourceStatus status,
            Instant createdAt) {
        static SubscriberResponse from(Subscriber subscriber) {
            return new SubscriberResponse(
                    subscriber.id(),
                    subscriber.name(),
                    subscriber.tierId(),
                    subscriber.meterId(),
                    subscriber.status(),
                    subscriber.createdAt());
        }
    }
}

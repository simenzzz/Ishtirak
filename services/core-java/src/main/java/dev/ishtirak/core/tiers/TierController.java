package dev.ishtirak.core.tiers;

import com.fasterxml.jackson.databind.JsonNode;
import dev.ishtirak.core.common.PageResponse;
import dev.ishtirak.core.domain.TariffPolicy;
import dev.ishtirak.core.domain.Tier;
import dev.ishtirak.core.security.RequestIdentity;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class TierController {
    private final TierService tierService;

    public TierController(TierService tierService) {
        this.tierService = tierService;
    }

    @GetMapping("/tiers")
    PageResponse<TierResponse> list(
            RequestIdentity identity,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        identity.requireStaffOrAdmin();
        TariffPolicy defaultPolicy = tierService.defaultPolicy(identity.operatorId());
        return PageResponse.of(tierService.list(identity.operatorId()), page, limit)
                .map(tier -> TierResponse.from(tier, defaultPolicy));
    }

    @GetMapping("/tiers/{id}")
    TierResponse get(RequestIdentity identity, @PathVariable UUID id) {
        identity.requireStaffOrAdmin();
        return TierResponse.from(tierService.get(identity.operatorId(), id), tierService.defaultPolicy(identity.operatorId()));
    }

    @PostMapping("/tiers")
    @ResponseStatus(HttpStatus.CREATED)
    TierResponse create(RequestIdentity identity, @Valid @RequestBody TierService.TierInput request) {
        identity.requireAdmin();
        return TierResponse.from(tierService.create(identity.operatorId(), request), tierService.defaultPolicy(identity.operatorId()));
    }

    @PatchMapping("/tiers/{id}")
    TierResponse update(
            RequestIdentity identity,
            @PathVariable UUID id,
            @RequestBody JsonNode request) {
        identity.requireAdmin();
        return TierResponse.from(
                tierService.update(identity.operatorId(), id, request),
                tierService.defaultPolicy(identity.operatorId()));
    }
}

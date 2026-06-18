package dev.ishtirak.core.tiers;

import com.fasterxml.jackson.databind.JsonNode;
import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.domain.ResourceStatus;
import dev.ishtirak.core.domain.TariffPolicy;
import dev.ishtirak.core.domain.Tier;
import dev.ishtirak.core.persistence.Repositories;
import dev.ishtirak.core.persistence.TierEntity;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class TierService {
    private static final Set<String> PATCH_FIELDS = Set.of(
            "name",
            "amperage",
            "tariffPolicyOverride",
            "standingFeeUsd",
            "standingFeeLbp",
            "perKwhRateUsd",
            "perKwhRateLbp",
            "status");

    private final Repositories.Tiers tiers;
    private final Repositories.Operators operators;

    public TierService(Repositories.Tiers tiers, Repositories.Operators operators) {
        this.tiers = tiers;
        this.operators = operators;
    }

    public List<Tier> list(UUID operatorId) {
        return tiers.findByOperatorId(operatorId).stream().map(TierEntity::toDomain).toList();
    }

    public Tier get(UUID operatorId, UUID tierId) {
        return tiers.findByOperatorIdAndId(operatorId, tierId)
                .map(TierEntity::toDomain)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Tier not found"));
    }

    public TariffPolicy defaultPolicy(UUID operatorId) {
        return operators.findById(operatorId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Operator not found"))
                .toDomain()
                .defaultTariffPolicy();
    }

    public Tier create(UUID operatorId, TierInput input) {
        Tier tier = new Tier(
                UUID.randomUUID(),
                operatorId,
                input.name(),
                input.amperage(),
                input.tariffPolicyOverride(),
                input.standingFeeUsd(),
                input.standingFeeLbp(),
                input.perKwhRateUsd(),
                input.perKwhRateLbp(),
                ResourceStatus.ACTIVE);
        return tiers.save(new TierEntity(tier)).toDomain();
    }

    public Tier update(UUID operatorId, UUID tierId, JsonNode patch) {
        validatePatch(patch);
        Tier current = get(operatorId, tierId);
        Tier updated = new Tier(
                current.id(),
                current.operatorId(),
                text(patch, "name", current.name()),
                integer(patch, "amperage", current.amperage()),
                tariffPolicy(patch, current.tariffPolicyOverride()),
                decimal(patch, "standingFeeUsd", current.standingFeeUsd()),
                longValue(patch, "standingFeeLbp", current.standingFeeLbp()),
                decimal(patch, "perKwhRateUsd", current.perKwhRateUsd()),
                longValue(patch, "perKwhRateLbp", current.perKwhRateLbp()),
                status(patch, current.status()));
        return tiers.save(new TierEntity(updated)).toDomain();
    }

    public record TierInput(
            @NotBlank String name,
            @Min(1) int amperage,
            TariffPolicy tariffPolicyOverride,
            @NotNull @PositiveOrZero BigDecimal standingFeeUsd,
            @PositiveOrZero long standingFeeLbp,
            @NotNull @PositiveOrZero BigDecimal perKwhRateUsd,
            @PositiveOrZero long perKwhRateLbp) {
    }

    private static String text(JsonNode patch, String field, String fallback) {
        String value = patch.has(field) ? patch.get(field).asText() : fallback;
        if (value == null || value.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", field + " must not be blank");
        }
        return value;
    }

    private static int integer(JsonNode patch, String field, int fallback) {
        int value = patch.has(field) ? patch.get(field).asInt() : fallback;
        if (value < 1) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", field + " must be >= 1");
        }
        return value;
    }

    private static BigDecimal decimal(JsonNode patch, String field, BigDecimal fallback) {
        BigDecimal value = patch.has(field) ? patch.get(field).decimalValue() : fallback;
        if (value.signum() < 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", field + " must be >= 0");
        }
        return value;
    }

    private static long longValue(JsonNode patch, String field, long fallback) {
        long value = patch.has(field) ? patch.get(field).asLong() : fallback;
        if (value < 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", field + " must be >= 0");
        }
        return value;
    }

    private static TariffPolicy tariffPolicy(JsonNode patch, TariffPolicy fallback) {
        if (!patch.has("tariffPolicyOverride")) {
            return fallback;
        }
        JsonNode node = patch.get("tariffPolicyOverride");
        return node.isNull() ? null : TariffPolicy.valueOf(node.asText());
    }

    private static ResourceStatus status(JsonNode patch, ResourceStatus fallback) {
        return patch.has("status") ? ResourceStatus.valueOf(patch.get("status").asText()) : fallback;
    }

    private static void validatePatch(JsonNode patch) {
        if (patch == null || !patch.isObject() || patch.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Patch must contain at least one field");
        }
        patch.fieldNames().forEachRemaining(field -> {
            if (!PATCH_FIELDS.contains(field)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Unknown field: " + field);
            }
        });
    }
}

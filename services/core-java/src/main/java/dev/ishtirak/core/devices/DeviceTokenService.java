package dev.ishtirak.core.devices;

import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.domain.DeviceToken;
import dev.ishtirak.core.persistence.DeviceTokenEntity;
import dev.ishtirak.core.persistence.Repositories;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Issues, authenticates and revokes the operator-scoped credentials presented by
 * generator-site edge agents on the ingest path. Only the SHA-256 hash of a token
 * is persisted; the plaintext is returned exactly once at mint time.
 */
@Service
public class DeviceTokenService {
    private static final String TOKEN_PREFIX = "ishtdev_";

    private final Repositories.DeviceTokens deviceTokens;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public DeviceTokenService(Repositories.DeviceTokens deviceTokens, Clock clock) {
        this.deviceTokens = deviceTokens;
        this.clock = clock;
    }

    @Transactional
    public MintedDeviceToken mint(UUID operatorId, MintDeviceTokenRequest request) {
        String secret = TOKEN_PREFIX + randomToken();
        DeviceTokenEntity entity = new DeviceTokenEntity(
                UUID.randomUUID(), operatorId, request.label().trim(), hash(secret), clock.instant());
        DeviceToken saved = deviceTokens.save(entity).toDomain();
        return new MintedDeviceToken(saved, secret);
    }

    public List<DeviceToken> list(UUID operatorId) {
        return deviceTokens.findByOperatorIdOrderByCreatedAtDesc(operatorId).stream()
                .map(DeviceTokenEntity::toDomain)
                .toList();
    }

    @Transactional
    public void revoke(UUID operatorId, UUID deviceTokenId) {
        DeviceTokenEntity entity = deviceTokens.findByOperatorIdAndId(operatorId, deviceTokenId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Device token not found"));
        entity.revoke();
    }

    /**
     * Resolve a presented token to its operator, rejecting unknown or revoked
     * credentials. Updates {@code lastSeenAt} so operators can spot dormant devices.
     */
    @Transactional
    public UUID authenticate(String presentedToken) {
        if (presentedToken == null || presentedToken.isBlank()) {
            throw unauthorized();
        }
        DeviceTokenEntity entity = deviceTokens.findByTokenHash(hash(presentedToken))
                .filter(DeviceTokenEntity::active)
                .orElseThrow(DeviceTokenService::unauthorized);
        entity.markSeen(clock.instant());
        return entity.operatorId();
    }

    private String randomToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception ex) {
            throw new IllegalStateException("Could not hash token", ex);
        }
    }

    private static ApiException unauthorized() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Invalid device token");
    }

    public record MintDeviceTokenRequest(@NotBlank @Size(max = 120) String label) {
    }

    public record MintedDeviceToken(DeviceToken token, String secret) {
    }
}

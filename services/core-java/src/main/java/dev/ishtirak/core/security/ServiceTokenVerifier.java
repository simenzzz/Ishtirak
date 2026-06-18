package dev.ishtirak.core.security;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.ishtirak.core.common.ApiException;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Verifies inbound service tokens minted by trusted internal peers.
 *
 * <p>Each trusted issuer (e.g. {@code gateway-node}, {@code analytics-python}) signs with its own
 * secret; the verifier selects the secret by the token's {@code iss} claim and rejects unknown
 * issuers. This keeps internal callers as first-class identities rather than sharing one secret.
 */
@Component
public class ServiceTokenVerifier {
    public static final String GATEWAY_ISSUER = "gateway-node";
    public static final String ANALYTICS_ISSUER = "analytics-python";

    /** Tolerance for clock skew between internal peers when checking {@code exp}. */
    private static final long CLOCK_SKEW_LEEWAY_SECONDS = 60;

    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    private final ObjectMapper objectMapper;
    private final Map<String, String> secretsByIssuer;
    private final Clock clock;

    @Autowired
    public ServiceTokenVerifier(
            ObjectMapper objectMapper,
            @Value("${ishtirak.gateway-service-token-secret}") String gatewaySecret,
            @Value("${ishtirak.analytics-service-token-secret:}") String analyticsSecret) {
        this(objectMapper, buildSecrets(gatewaySecret, analyticsSecret), Clock.systemUTC());
    }

    ServiceTokenVerifier(ObjectMapper objectMapper, Map<String, String> secretsByIssuer, Clock clock) {
        this.objectMapper = objectMapper;
        this.secretsByIssuer = Map.copyOf(secretsByIssuer);
        this.clock = clock;
    }

    public Map<String, Object> verify(String token) {
        try {
            String[] parts = token.split("\\.");
            if (parts.length != 3) {
                throw unauthorized();
            }
            Map<String, Object> claims = objectMapper.readValue(DECODER.decode(parts[1]), MAP_TYPE);
            String issuer = claims.get("iss") instanceof String value ? value : null;
            String secret = issuer == null ? null : secretsByIssuer.get(issuer);
            if (secret == null) {
                throw unauthorized();
            }
            String signed = parts[0] + "." + parts[1];
            if (!MessageDigest.isEqual(DECODER.decode(hmac(signed, secret)), DECODER.decode(parts[2]))) {
                throw unauthorized();
            }
            if (!"core-java".equals(claims.get("aud")) || !"service".equals(claims.get("typ"))) {
                throw unauthorized();
            }
            Number exp = claims.get("exp") instanceof Number number ? number : null;
            if (exp == null
                    || exp.longValue() + CLOCK_SKEW_LEEWAY_SECONDS <= clock.instant().getEpochSecond()) {
                throw unauthorized();
            }
            return claims;
        } catch (ApiException ex) {
            throw ex;
        } catch (Exception ex) {
            throw unauthorized();
        }
    }

    private static Map<String, String> buildSecrets(String gatewaySecret, String analyticsSecret) {
        Map<String, String> secrets = new LinkedHashMap<>();
        secrets.put(GATEWAY_ISSUER, requireSecret(GATEWAY_ISSUER, gatewaySecret));
        if (analyticsSecret != null && !analyticsSecret.isBlank()) {
            secrets.put(ANALYTICS_ISSUER, requireSecret(ANALYTICS_ISSUER, analyticsSecret));
        }
        return secrets;
    }

    private static String requireSecret(String issuer, String secret) {
        if (secret == null || secret.length() < 32) {
            throw new IllegalStateException(
                    "service token secret for " + issuer + " must be at least 32 characters");
        }
        return secret;
    }

    private String hmac(String signed, String secret) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return ENCODER.encodeToString(mac.doFinal(signed.getBytes(StandardCharsets.UTF_8)));
    }

    private static ApiException unauthorized() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Invalid service token");
    }
}

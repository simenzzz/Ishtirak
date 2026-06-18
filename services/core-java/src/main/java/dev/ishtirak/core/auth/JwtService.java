package dev.ishtirak.core.auth;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.ishtirak.core.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class JwtService {
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    private final ObjectMapper objectMapper;
    private final String secret;
    private final Clock clock;

    public JwtService(ObjectMapper objectMapper, @Value("${ishtirak.jwt-secret}") String secret, Clock clock) {
        if (secret == null || secret.length() < 32) {
            throw new IllegalStateException("ishtirak.jwt-secret must be at least 32 characters");
        }
        this.objectMapper = objectMapper;
        this.secret = secret;
        this.clock = clock;
    }

    public String sign(Map<String, Object> claims, Duration ttl) {
        try {
            Map<String, Object> header = Map.of("alg", "HS256", "typ", "JWT");
            Map<String, Object> payload = new LinkedHashMap<>(claims);
            payload.put("iss", "core-java");
            payload.put("exp", clock.instant().plus(ttl).getEpochSecond());
            String signed = encode(header) + "." + encode(payload);
            return signed + "." + hmac(signed);
        } catch (Exception ex) {
            throw new IllegalStateException("Could not sign token", ex);
        }
    }

    public Map<String, Object> verify(String token, String expectedType) {
        try {
            String[] parts = token.split("\\.");
            if (parts.length != 3) {
                throw unauthorized();
            }
            String signed = parts[0] + "." + parts[1];
            if (!MessageDigest.isEqual(DECODER.decode(hmac(signed)), DECODER.decode(parts[2]))) {
                throw unauthorized();
            }
            Map<String, Object> claims = objectMapper.readValue(DECODER.decode(parts[1]), MAP_TYPE);
            if (!"core-java".equals(claims.get("iss")) || !expectedType.equals(claims.get("typ"))) {
                throw unauthorized();
            }
            Number exp = claims.get("exp") instanceof Number number ? number : null;
            if (exp == null || exp.longValue() <= clock.instant().getEpochSecond()) {
                throw unauthorized();
            }
            return claims;
        } catch (ApiException ex) {
            throw ex;
        } catch (Exception ex) {
            throw unauthorized();
        }
    }

    private String encode(Object value) throws Exception {
        return ENCODER.encodeToString(objectMapper.writeValueAsBytes(value));
    }

    private String hmac(String signed) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return ENCODER.encodeToString(mac.doFinal(signed.getBytes(StandardCharsets.UTF_8)));
    }

    private static ApiException unauthorized() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Invalid token");
    }
}

package dev.ishtirak.core.security;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.ishtirak.core.common.ApiException;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Base64;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class ServiceTokenVerifier {
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    private final ObjectMapper objectMapper;
    private final String secret;
    private final Clock clock;

    @Autowired
    public ServiceTokenVerifier(
            ObjectMapper objectMapper,
            @Value("${ishtirak.gateway-service-token-secret}") String secret) {
        this(objectMapper, secret, Clock.systemUTC());
    }

    ServiceTokenVerifier(ObjectMapper objectMapper, String secret, Clock clock) {
        if (secret == null || secret.length() < 32) {
            throw new IllegalStateException("ishtirak.gateway-service-token-secret must be at least 32 characters");
        }
        this.objectMapper = objectMapper;
        this.secret = secret;
        this.clock = clock;
    }

    public Map<String, Object> verify(String token) {
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
            if (!"gateway-node".equals(claims.get("iss"))
                    || !"core-java".equals(claims.get("aud"))
                    || !"service".equals(claims.get("typ"))) {
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

    private String hmac(String signed) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return ENCODER.encodeToString(mac.doFinal(signed.getBytes(StandardCharsets.UTF_8)));
    }

    private static ApiException unauthorized() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Invalid service token");
    }
}

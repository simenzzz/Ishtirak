package dev.ishtirak.core.support;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class TestServiceTokens {
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();

    private TestServiceTokens() {
    }

    public static String signed(UUID operatorId, String role, String subscriberId, String secret) {
        try {
            String header = base64("{\"alg\":\"HS256\",\"typ\":\"JWT\"}");
            long exp = Instant.now().plusSeconds(300).getEpochSecond();
            String subscriberClaim = subscriberId == null ? "" : ",\"subscriberId\":\"" + subscriberId + "\"";
            String payload = base64("""
                    {"iss":"gateway-node","aud":"core-java","typ":"service","exp":%d,"operatorId":"%s","role":"%s"%s}
                    """.formatted(exp, operatorId, role, subscriberClaim));
            String signed = header + "." + payload;
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return signed + "." + ENCODER.encodeToString(mac.doFinal(signed.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static String base64(String json) {
        return ENCODER.encodeToString(json.getBytes(StandardCharsets.UTF_8));
    }
}

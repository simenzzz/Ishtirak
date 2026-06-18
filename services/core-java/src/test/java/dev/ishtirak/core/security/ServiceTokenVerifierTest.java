package dev.ishtirak.core.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.support.TestServiceTokens;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ServiceTokenVerifierTest {
    private static final String GATEWAY_SECRET = "dev-gateway-service-token-secret-32";
    private static final String ANALYTICS_SECRET = "dev-analytics-service-token-secret-32";
    private static final UUID OPERATOR_ID = UUID.randomUUID();

    private final ServiceTokenVerifier verifier = new ServiceTokenVerifier(
            new ObjectMapper(),
            Map.of(
                    ServiceTokenVerifier.GATEWAY_ISSUER, GATEWAY_SECRET,
                    ServiceTokenVerifier.ANALYTICS_ISSUER, ANALYTICS_SECRET),
            Clock.systemUTC());

    @Test
    void acceptsGatewayIssuedToken() {
        String token = TestServiceTokens.signed(OPERATOR_ID, "OPERATOR_STAFF", null, GATEWAY_SECRET);

        Map<String, Object> claims = verifier.verify(token);

        assertThat(claims.get("iss")).isEqualTo(ServiceTokenVerifier.GATEWAY_ISSUER);
        assertThat(claims.get("operatorId")).isEqualTo(OPERATOR_ID.toString());
    }

    @Test
    void acceptsAnalyticsIssuedToken() {
        String token = TestServiceTokens.signed(
                OPERATOR_ID, "OPERATOR_STAFF", null, ANALYTICS_SECRET, ServiceTokenVerifier.ANALYTICS_ISSUER);

        Map<String, Object> claims = verifier.verify(token);

        assertThat(claims.get("iss")).isEqualTo(ServiceTokenVerifier.ANALYTICS_ISSUER);
    }

    @Test
    void rejectsAnalyticsTokenSignedWithWrongSecret() {
        String token = TestServiceTokens.signed(
                OPERATOR_ID, "OPERATOR_STAFF", null, GATEWAY_SECRET, ServiceTokenVerifier.ANALYTICS_ISSUER);

        assertThatThrownBy(() -> verifier.verify(token)).isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsUnknownIssuer() {
        String token = TestServiceTokens.signed(
                OPERATOR_ID, "OPERATOR_STAFF", null, ANALYTICS_SECRET, "rogue-service");

        assertThatThrownBy(() -> verifier.verify(token)).isInstanceOf(ApiException.class);
    }

    @Test
    void acceptsTokenJustPastExpiryWithinClockSkewLeeway() {
        String token = TestServiceTokens.signed(OPERATOR_ID, "OPERATOR_STAFF", null, GATEWAY_SECRET);
        // token exp is ~now+300; advance the verifier clock just past it (within 60s leeway)
        Clock justPast = Clock.fixed(Instant.now().plusSeconds(330), ZoneOffset.UTC);
        ServiceTokenVerifier skewed = new ServiceTokenVerifier(
                new ObjectMapper(),
                Map.of(ServiceTokenVerifier.GATEWAY_ISSUER, GATEWAY_SECRET),
                justPast);

        assertThat(skewed.verify(token).get("iss")).isEqualTo(ServiceTokenVerifier.GATEWAY_ISSUER);
    }

    @Test
    void rejectsTokenExpiredBeyondLeeway() {
        String token = TestServiceTokens.signed(OPERATOR_ID, "OPERATOR_STAFF", null, GATEWAY_SECRET);
        Clock wellPast = Clock.fixed(Instant.now().plusSeconds(600), ZoneOffset.UTC);
        ServiceTokenVerifier expired = new ServiceTokenVerifier(
                new ObjectMapper(),
                Map.of(ServiceTokenVerifier.GATEWAY_ISSUER, GATEWAY_SECRET),
                wellPast);

        assertThatThrownBy(() -> expired.verify(token)).isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsAnalyticsTokenWhenAnalyticsIssuerNotConfigured() {
        ServiceTokenVerifier gatewayOnly = new ServiceTokenVerifier(
                new ObjectMapper(),
                Map.of(ServiceTokenVerifier.GATEWAY_ISSUER, GATEWAY_SECRET),
                Clock.systemUTC());
        String token = TestServiceTokens.signed(
                OPERATOR_ID, "OPERATOR_STAFF", null, ANALYTICS_SECRET, ServiceTokenVerifier.ANALYTICS_ISSUER);

        assertThatThrownBy(() -> gatewayOnly.verify(token)).isInstanceOf(ApiException.class);
    }
}

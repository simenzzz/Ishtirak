package dev.ishtirak.core.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.ishtirak.core.support.CoreTestData;
import dev.ishtirak.core.support.TestServiceTokens;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class CoreSecurityApiTest {
    private static final UUID OPERATOR_ID = CoreTestData.OPERATOR_ID;
    private static final String SERVICE_SECRET = "dev-gateway-service-token-secret-32";

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private CoreTestData testData;

    @BeforeEach
    void resetData() {
        testData.reset();
    }

    @Test
    void rejectsInternalRequestWithoutServiceTokenAndIdentityHeaders() throws Exception {
        mockMvc.perform(get("/tiers")).andExpect(status().isUnauthorized());
    }

    @Test
    void rejectsForgedBearerWithTrustedHeaders() throws Exception {
        org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
        headers.setBearerAuth("not-a-signed-service-token");
        headers.add("X-Operator-Id", OPERATOR_ID.toString());
        headers.add("X-Actor-Role", "OPERATOR_ADMIN");

        mockMvc.perform(get("/tiers").headers(headers)).andExpect(status().isUnauthorized());
    }

    @Test
    void rejectsServiceTokenWhenClaimsDoNotMatchTrustedHeaders() throws Exception {
        org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
        headers.setBearerAuth(TestServiceTokens.signed(OPERATOR_ID, "OPERATOR_STAFF", null, SERVICE_SECRET));
        headers.add("X-Operator-Id", OPERATOR_ID.toString());
        headers.add("X-Actor-Role", "OPERATOR_ADMIN");

        mockMvc.perform(get("/tiers").headers(headers)).andExpect(status().isUnauthorized());
    }
}

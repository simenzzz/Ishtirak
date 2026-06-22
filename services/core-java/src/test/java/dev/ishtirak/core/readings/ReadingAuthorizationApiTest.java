package dev.ishtirak.core.readings;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.ishtirak.core.support.CoreTestData;
import dev.ishtirak.core.support.TestServiceTokens;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
class ReadingAuthorizationApiTest {
    private static final UUID OPERATOR_ID = CoreTestData.OPERATOR_ID;
    private static final String SERVICE_SECRET = "dev-gateway-service-token-secret-32";

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private CoreTestData testData;

    @BeforeEach
    void resetData() {
        testData.reset();
    }

    @Test
    void adminsCanRecordNonMonotonicReadingSoTamperingCanBeDetected() throws Exception {
        String tierId = createTier();
        String subscriberId = createSubscriber(tierId);
        recordReading(subscriberId, "500", "2026-01-31T12:00:00Z");

        mockMvc.perform(post("/readings")
                        .headers(headers("OPERATOR_ADMIN"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"subscriberId":"%s","kwh":50,"readingAt":"2026-02-01T12:00:00Z"}
                                """.formatted(subscriberId)))
                .andExpect(status().isCreated());
    }

    @Test
    void staffCannotRecordCorrectiveRollbackReading() throws Exception {
        String tierId = createTier();
        String subscriberId = createSubscriber(tierId);
        recordReading(subscriberId, "500", "2026-01-31T12:00:00Z");

        mockMvc.perform(post("/readings")
                        .headers(headers("OPERATOR_STAFF"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"subscriberId":"%s","kwh":50,"readingAt":"2026-02-01T12:00:00Z"}
                                """.formatted(subscriberId)))
                .andExpect(status().isForbidden());
    }

    @Test
    void staffCannotRecordBackdatedCorrectiveReading() throws Exception {
        String tierId = createTier();
        String subscriberId = createSubscriber(tierId);
        recordReading(subscriberId, "100", "2026-01-31T12:00:00Z");

        mockMvc.perform(post("/readings")
                        .headers(headers("OPERATOR_STAFF"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"subscriberId":"%s","kwh":120,"readingAt":"2026-01-15T12:00:00Z"}
                                """.formatted(subscriberId)))
                .andExpect(status().isForbidden());
    }

    @Test
    void rejectsDuplicateReadingAtSameTimestamp() throws Exception {
        String tierId = createTier();
        String subscriberId = createSubscriber(tierId);
        recordReading(subscriberId, "100", "2026-01-31T12:00:00Z");

        mockMvc.perform(post("/readings")
                        .headers(headers("OPERATOR_STAFF"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"subscriberId":"%s","kwh":120,"readingAt":"2026-01-31T12:00:00Z"}
                                """.formatted(subscriberId)))
                .andExpect(status().isConflict());
    }

    private String createTier() throws Exception {
        MvcResult result = mockMvc.perform(post("/tiers")
                        .headers(headers("OPERATOR_ADMIN"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name":"10A",
                                  "amperage":10,
                                  "tariffPolicyOverride":"HYBRID",
                                  "standingFeeUsd":5,
                                  "standingFeeLbp":450000,
                                  "perKwhRateUsd":0.5,
                                  "perKwhRateLbp":45000
                                }
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        return idFrom(result);
    }

    private String createSubscriber(String tierId) throws Exception {
        MvcResult result = mockMvc.perform(post("/subscribers")
                        .headers(headers("OPERATOR_ADMIN"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Nour","tierId":"%s","meterId":"M-1"}
                                """.formatted(tierId)))
                .andExpect(status().isCreated())
                .andReturn();
        return idFrom(result);
    }

    private void recordReading(String subscriberId, String kwh, String readingAt) throws Exception {
        mockMvc.perform(post("/readings")
                        .headers(headers("OPERATOR_STAFF"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"subscriberId":"%s","kwh":%s,"readingAt":"%s"}
                                """.formatted(subscriberId, kwh, readingAt)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.operatorId").doesNotExist());
    }

    private org.springframework.http.HttpHeaders headers(String role) {
        org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
        headers.setBearerAuth(TestServiceTokens.signed(OPERATOR_ID, role, null, SERVICE_SECRET));
        headers.add("X-Operator-Id", OPERATOR_ID.toString());
        headers.add("X-Actor-Role", role);
        return headers;
    }

    private String idFrom(MvcResult result) throws Exception {
        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        assertThat(body.hasNonNull("id")).isTrue();
        return body.get("id").asText();
    }
}

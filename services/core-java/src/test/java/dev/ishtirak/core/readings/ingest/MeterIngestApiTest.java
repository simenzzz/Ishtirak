package dev.ishtirak.core.readings.ingest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest
@AutoConfigureMockMvc
class MeterIngestApiTest {
    private static final UUID OPERATOR_ID = CoreTestData.OPERATOR_ID;
    private static final String SERVICE_SECRET = "dev-gateway-service-token-secret-32";
    private static final String METER = "M-7";

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
    void ingestsResolvesMeterRecordsAndIsIdempotent() throws Exception {
        provisionSubscriber(METER);
        String token = mintDevice().token();

        JsonNode first = ingest(token, batch(METER, "120.5", "2026-02-01T12:00:00Z"));
        assertThat(first.get("recorded").asInt()).isEqualTo(1);
        assertThat(first.get("duplicates").asInt()).isZero();
        assertThat(first.get("errors")).isEmpty();

        // Identical replay (an edge agent retrying after a dropped response) is a no-op.
        JsonNode replay = ingest(token, batch(METER, "120.5", "2026-02-01T12:00:00Z"));
        assertThat(replay.get("recorded").asInt()).isZero();
        assertThat(replay.get("duplicates").asInt()).isEqualTo(1);
    }

    @Test
    void allowsBackdatedBackfillFromTrustedDevice() throws Exception {
        provisionSubscriber(METER);
        String token = mintDevice().token();
        ingest(token, batch(METER, "120", "2026-02-01T12:00:00Z"));

        // Staff would be forbidden from backdating; a buffered device may flush it.
        JsonNode backfilled = ingest(token, batch(METER, "90", "2026-01-15T12:00:00Z"));
        assertThat(backfilled.get("recorded").asInt()).isEqualTo(1);
        assertThat(backfilled.get("errors")).isEmpty();
    }

    @Test
    void reportsUnknownMeterPerItemWithoutFailingBatch() throws Exception {
        provisionSubscriber(METER);
        String token = mintDevice().token();

        JsonNode result = ingest(token, """
                {"readings":[
                  {"meterId":"%s","kwh":10,"readingAt":"2026-02-01T12:00:00Z"},
                  {"meterId":"GHOST","kwh":10,"readingAt":"2026-02-01T12:00:00Z"}
                ]}""".formatted(METER));
        assertThat(result.get("recorded").asInt()).isEqualTo(1);
        assertThat(result.get("errors")).hasSize(1);
        assertThat(result.get("errors").get(0).get("code").asText()).isEqualTo("UNKNOWN_METER");
        assertThat(result.get("errors").get(0).get("meterId").asText()).isEqualTo("GHOST");
    }

    @Test
    void rejectsMissingToken() throws Exception {
        provisionSubscriber(METER);
        mockMvc.perform(post("/ingest/readings")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(batch(METER, "10", "2026-02-01T12:00:00Z")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void rejectsInvalidToken() throws Exception {
        provisionSubscriber(METER);
        mockMvc.perform(devicePost("ishtdev_not-a-real-token", batch(METER, "10", "2026-02-01T12:00:00Z")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void rejectsRevokedToken() throws Exception {
        provisionSubscriber(METER);
        Minted device = mintDevice();
        mockMvc.perform(post("/devices/" + device.id() + "/revoke").headers(headers("OPERATOR_ADMIN")))
                .andExpect(status().isNoContent());

        mockMvc.perform(devicePost(device.token(), batch(METER, "10", "2026-02-01T12:00:00Z")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void duplicateMeterAssignmentIsRejected() throws Exception {
        provisionSubscriber(METER);
        mockMvc.perform(post("/subscribers")
                        .headers(headers("OPERATOR_ADMIN"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Other","tierId":"%s","meterId":"%s"}
                                """.formatted(createTier(), METER)))
                .andExpect(status().isConflict());
    }

    private void provisionSubscriber(String meterId) throws Exception {
        mockMvc.perform(post("/subscribers")
                        .headers(headers("OPERATOR_ADMIN"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Nour","tierId":"%s","meterId":"%s"}
                                """.formatted(createTier(), meterId)))
                .andExpect(status().isCreated());
    }

    private String createTier() throws Exception {
        MvcResult result = mockMvc.perform(post("/tiers")
                        .headers(headers("OPERATOR_ADMIN"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"10A","amperage":10,"tariffPolicyOverride":"HYBRID",
                                 "standingFeeUsd":5,"standingFeeLbp":450000,
                                 "perKwhRateUsd":0.5,"perKwhRateLbp":45000}
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }

    private Minted mintDevice() throws Exception {
        MvcResult result = mockMvc.perform(post("/devices")
                        .headers(headers("OPERATOR_ADMIN"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"label\":\"Site A edge\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        assertThat(body.get("token").asText()).startsWith("ishtdev_");
        return new Minted(body.get("id").asText(), body.get("token").asText());
    }

    private JsonNode ingest(String token, String body) throws Exception {
        MvcResult result = mockMvc.perform(devicePost(token, body))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    private MockHttpServletRequestBuilder devicePost(String token, String body) {
        return post("/ingest/readings")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    private static String batch(String meterId, String kwh, String readingAt) {
        return """
                {"readings":[{"meterId":"%s","kwh":%s,"readingAt":"%s"}]}
                """.formatted(meterId, kwh, readingAt);
    }

    private HttpHeaders headers(String role) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(TestServiceTokens.signed(OPERATOR_ID, role, null, SERVICE_SECRET));
        headers.add("X-Operator-Id", OPERATOR_ID.toString());
        headers.add("X-Actor-Role", role);
        return headers;
    }

    private record Minted(String id, String token) {
    }
}

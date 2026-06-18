package dev.ishtirak.core;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.ishtirak.core.support.CoreTestData;
import dev.ishtirak.core.support.TestServiceTokens;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
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
class CoreApiTest {
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
    @Test
    void runsDualCurrencyBillingAndSubscriberMeProjection() throws Exception {
        String tierId = createTier();
        String subscriberId = createSubscriber(tierId);
        recordReading(subscriberId, "100", "2026-01-01T12:00:00Z");
        recordReading(subscriberId, "125", "2026-01-31T12:00:00Z");

        mockMvc.perform(post("/billing-runs")
                        .headers(headers("OPERATOR_ADMIN", null))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"periodStart":"2026-01-01","periodEnd":"2026-01-31"}
                                """))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.issued").value(1));

        mockMvc.perform(get("/me/invoices")
                        .headers(headers("SUBSCRIBER", subscriberId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].operatorId").doesNotExist())
                .andExpect(jsonPath("$.data[0].amountUsd").value(17.5))
                .andExpect(jsonPath("$.data[0].amountLbp").value(1575000))
                .andExpect(jsonPath("$.data[0].kwhConsumed").value(25));

        String invoiceId = firstIdFrom(mockMvc.perform(get("/invoices").headers(headers("OPERATOR_STAFF", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].operatorId").doesNotExist())
                .andReturn());

        mockMvc.perform(post("/payments")
                        .headers(headers("OPERATOR_STAFF", null))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"invoiceId":"%s","currency":"USD","tenderedAmount":5,"method":"CASH"}
                                """.formatted(invoiceId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.operatorId").doesNotExist())
                .andExpect(jsonPath("$.appliedUsd").value(5.0))
                .andExpect(jsonPath("$.appliedLbp").value(450000));
    }

    @Test
    void billingRunIsIdempotentForSamePeriod() throws Exception {
        String tierId = createTier();
        String subscriberId = createSubscriber(tierId);
        recordReading(subscriberId, "10", "2026-01-01T12:00:00Z");
        recordReading(subscriberId, "20", "2026-01-31T12:00:00Z");

        for (int i = 0; i < 2; i++) {
            mockMvc.perform(post("/billing-runs")
                            .headers(headers("OPERATOR_ADMIN", null))
                            .header("Idempotency-Key", "jan-2026")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"periodStart":"2026-01-01","periodEnd":"2026-01-31"}
                                    """))
                    .andExpect(status().isAccepted())
                    .andExpect(jsonPath("$.issued").value(1));
        }

        mockMvc.perform(get("/invoices").headers(headers("OPERATOR_STAFF", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meta.total").value(1));
    }
    @Test
    void rejectsReadingThatWouldBreakFutureMonotonicSequence() throws Exception {
        String tierId = createTier();
        String subscriberId = createSubscriber(tierId);
        recordReading(subscriberId, "100", "2026-01-31T12:00:00Z");

        mockMvc.perform(post("/readings")
                        .headers(headers("OPERATOR_STAFF", null))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"subscriberId":"%s","kwh":110,"readingAt":"2026-01-15T12:00:00Z"}
                                """.formatted(subscriberId)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void concurrentBillingRunsDoNotDuplicateInvoices() throws Exception {
        String tierId = createTier();
        String subscriberId = createSubscriber(tierId);
        recordReading(subscriberId, "10", "2026-01-01T12:00:00Z");
        recordReading(subscriberId, "20", "2026-01-31T12:00:00Z");
        CountDownLatch start = new CountDownLatch(1);
        var executor = Executors.newFixedThreadPool(2);
        List<Future<Boolean>> results = List.of(
                executor.submit(() -> runBillingAfterStart(start)),
                executor.submit(() -> runBillingAfterStart(start)));

        start.countDown();

        assertThat(results.stream().filter(this::succeeded).count()).isEqualTo(2);
        mockMvc.perform(get("/invoices").headers(headers("OPERATOR_STAFF", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meta.total").value(1));
        executor.shutdownNow();
    }
    @Test
    void subscribersCannotUseByIdStaffEndpoints() throws Exception {
        mockMvc.perform(get("/subscribers/{id}", UUID.randomUUID())
                        .headers(headers("SUBSCRIBER", UUID.randomUUID().toString())))
                .andExpect(status().isForbidden());
    }
    @Test
    void adminCanPatchSubscriberButStaffCannot() throws Exception {
        String oldTierId = createTier();
        String newTierId = createTier();
        String subscriberId = createSubscriber(oldTierId);

        mockMvc.perform(patch("/subscribers/{id}", subscriberId)
                        .headers(headers("OPERATOR_STAFF", null))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Updated"}
                                """))
                .andExpect(status().isForbidden());

        mockMvc.perform(patch("/subscribers/{id}", subscriberId)
                        .headers(headers("OPERATOR_ADMIN", null))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Updated","tierId":"%s","status":"INACTIVE"}
                                """.formatted(newTierId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Updated"))
                .andExpect(jsonPath("$.tierId").value(newTierId))
                .andExpect(jsonPath("$.status").value("INACTIVE"))
                .andExpect(jsonPath("$.operatorId").doesNotExist());
    }
    @Test
    void getsTierByIdFromPublishedContract() throws Exception {
        String tierId = createTier();

        mockMvc.perform(get("/tiers/{id}", tierId).headers(headers("OPERATOR_STAFF", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(tierId))
                .andExpect(jsonPath("$.operatorId").doesNotExist())
                .andExpect(jsonPath("$.effectiveTariffPolicy").value("HYBRID"));
    }

    private String createTier() throws Exception {
        MvcResult result = mockMvc.perform(post("/tiers")
                        .headers(headers("OPERATOR_ADMIN", null))
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
                .andExpect(jsonPath("$.operatorId").doesNotExist())
                .andReturn();
        return idFrom(result);
    }
    private String createSubscriber(String tierId) throws Exception {
        MvcResult result = mockMvc.perform(post("/subscribers")
                        .headers(headers("OPERATOR_ADMIN", null))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Nour","tierId":"%s","meterId":"M-1"}
                """.formatted(tierId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.operatorId").doesNotExist())
                .andReturn();
        return idFrom(result);
    }

    private void recordReading(String subscriberId, String kwh, String readingAt) throws Exception {
        mockMvc.perform(post("/readings")
                        .headers(headers("OPERATOR_STAFF", null))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"subscriberId":"%s","kwh":%s,"readingAt":"%s"}
                                """.formatted(subscriberId, kwh, readingAt)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.operatorId").doesNotExist());
    }

    private Boolean runBillingAfterStart(CountDownLatch start) throws Exception {
        start.await();
        mockMvc.perform(post("/billing-runs")
                        .headers(headers("OPERATOR_ADMIN", null))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"periodStart":"2026-01-01","periodEnd":"2026-01-31"}
                                """))
                .andExpect(status().isAccepted());
        return true;
    }

    private org.springframework.http.HttpHeaders headers(String role, String subscriberId) {
        org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
        headers.setBearerAuth(TestServiceTokens.signed(OPERATOR_ID, role, subscriberId, SERVICE_SECRET));
        headers.add("X-Operator-Id", OPERATOR_ID.toString());
        headers.add("X-Actor-Role", role);
        if (subscriberId != null) {
            headers.add("X-Actor-Subscriber-Id", subscriberId);
        }
        return headers;
    }

    private String idFrom(MvcResult result) throws Exception {
        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        assertThat(body.hasNonNull("id")).isTrue();
        return body.get("id").asText();
    }

    private String firstIdFrom(MvcResult result) throws Exception {
        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        assertThat(body.path("data").path(0).hasNonNull("id")).isTrue();
        return body.path("data").path(0).get("id").asText();
    }

    private boolean succeeded(Future<Boolean> result) {
        try {
            return Boolean.TRUE.equals(result.get());
        } catch (Exception ex) {
            return false;
        }
    }
}

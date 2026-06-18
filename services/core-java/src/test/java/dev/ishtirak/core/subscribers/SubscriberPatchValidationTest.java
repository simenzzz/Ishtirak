package dev.ishtirak.core.subscribers;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.ishtirak.core.domain.Subscriber;
import dev.ishtirak.core.domain.Tier;
import dev.ishtirak.core.support.CoreTestData;
import dev.ishtirak.core.support.TestServiceTokens;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class SubscriberPatchValidationTest {
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
    void rejectsEmptyOrBlankSubscriberPatch() throws Exception {
        Tier tier = testData.seedTier();
        Subscriber subscriber = testData.seedSubscriber(tier.id());

        mockMvc.perform(patch("/subscribers/{id}", subscriber.id())
                        .headers(headers())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(patch("/subscribers/{id}", subscriber.id())
                        .headers(headers())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":""}
                                """))
                .andExpect(status().isBadRequest());
    }

    private HttpHeaders headers() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(TestServiceTokens.signed(CoreTestData.OPERATOR_ID, "OPERATOR_ADMIN", null, SERVICE_SECRET));
        headers.add("X-Operator-Id", CoreTestData.OPERATOR_ID.toString());
        headers.add("X-Actor-Role", "OPERATOR_ADMIN");
        return headers;
    }
}

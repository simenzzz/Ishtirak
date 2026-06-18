package dev.ishtirak.core;

import dev.ishtirak.core.support.IntegrationTestBase;
import dev.ishtirak.core.support.CoreTestData;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.beans.factory.annotation.Autowired;

@SpringBootTest
class Phase2ContainersTest extends IntegrationTestBase {
    @Autowired
    private CoreTestData testData;

    @Test
    void flywaySchemaSupportsCoreRepositoryWritesWithPostgresAndRabbitMq() {
        testData.reset();
        testData.seedTier();
    }
}

package dev.ishtirak.core.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.domain.ActorRole;
import dev.ishtirak.core.domain.TariffPolicy;
import dev.ishtirak.core.persistence.OperatorEntity;
import dev.ishtirak.core.persistence.OperatorMembershipEntity;
import dev.ishtirak.core.persistence.Repositories;
import dev.ishtirak.core.persistence.UserEntity;
import dev.ishtirak.core.support.CoreTestData;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.crypto.password.PasswordEncoder;

@SpringBootTest
class AuthServiceTest {
    @Autowired
    private AuthService authService;
    @Autowired
    private CoreTestData testData;
    @Autowired
    private Repositories.Users users;
    @Autowired
    private Repositories.Operators operators;
    @Autowired
    private Repositories.Memberships memberships;
    @Autowired
    private PasswordEncoder encoder;
    @Autowired
    private Clock clock;

    @BeforeEach
    void reset() {
        testData.reset();
    }

    @Test
    void loginWithMultipleMembershipsRequiresContextSelection() {
        UserEntity user = seedUser("resident@example.com");
        UUID secondOperatorId = UUID.fromString("10000000-0000-0000-0000-000000000002");
        operators.save(new OperatorEntity(secondOperatorId, "Second Operator", TariffPolicy.HYBRID, clock.instant()));
        seedMembership(user.id(), CoreTestData.OPERATOR_ID, ActorRole.SUBSCRIBER);
        UUID membershipId = seedMembership(user.id(), secondOperatorId, ActorRole.SUBSCRIBER);

        LoginResult login = authService.login("resident@example.com", "password123");
        TokenPair selected = authService.selectContext(login.selectionToken(), membershipId);

        assertThat(login.contextSelectionRequired()).isTrue();
        assertThat(login.memberships()).hasSize(2);
        assertThat(selected.accessToken()).isNotBlank();
        assertThat(selected.refreshToken()).isNotBlank();
    }

    @Test
    void refreshTokenIsSingleUseAndReuseRevokesFamily() {
        UserEntity user = seedUser("admin@example.com");
        seedMembership(user.id(), CoreTestData.OPERATOR_ID, ActorRole.OPERATOR_ADMIN);
        LoginResult login = authService.login("admin@example.com", "password123");
        TokenPair original = new TokenPair(login.accessToken(), login.refreshToken());

        TokenPair rotated = authService.refresh(original.refreshToken());

        assertThat(rotated.refreshToken()).isNotEqualTo(original.refreshToken());
        assertThatThrownBy(() -> authService.refresh(original.refreshToken())).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> authService.refresh(rotated.refreshToken())).isInstanceOf(ApiException.class);
    }

    @Test
    void concurrentRefreshAttemptsDoNotIssueTwoUsableFamilies() throws Exception {
        UserEntity user = seedUser("race@example.com");
        seedMembership(user.id(), CoreTestData.OPERATOR_ID, ActorRole.OPERATOR_ADMIN);
        LoginResult login = authService.login("race@example.com", "password123");
        CountDownLatch start = new CountDownLatch(1);
        var executor = Executors.newFixedThreadPool(2);
        List<Future<TokenPair>> attempts = List.of(
                executor.submit(() -> refreshAfterStart(start, login.refreshToken())),
                executor.submit(() -> refreshAfterStart(start, login.refreshToken())));

        start.countDown();

        List<TokenPair> successful = attempts.stream()
                .map(this::resultOrNull)
                .filter(java.util.Objects::nonNull)
                .toList();
        assertThat(successful).hasSize(1);
        successful.forEach(pair -> assertThatThrownBy(() -> authService.refresh(pair.refreshToken()))
                .isInstanceOf(ApiException.class));
        executor.shutdownNow();
    }

    private UserEntity seedUser(String email) {
        return users.save(new UserEntity(
                UUID.randomUUID(), email, encoder.encode("password123"), email, clock.instant()));
    }

    private UUID seedMembership(UUID userId, UUID operatorId, ActorRole role) {
        UUID membershipId = UUID.randomUUID();
        memberships.save(new OperatorMembershipEntity(membershipId, userId, operatorId, role, null, clock.instant()));
        return membershipId;
    }

    private TokenPair refreshAfterStart(CountDownLatch start, String refreshToken) throws Exception {
        start.await();
        return authService.refresh(refreshToken);
    }

    private TokenPair resultOrNull(Future<TokenPair> result) {
        try {
            return result.get();
        } catch (Exception ex) {
            return null;
        }
    }
}

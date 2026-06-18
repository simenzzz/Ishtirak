package dev.ishtirak.core.bootstrap;

import dev.ishtirak.core.domain.ActorRole;
import dev.ishtirak.core.domain.ResourceStatus;
import dev.ishtirak.core.domain.Subscriber;
import dev.ishtirak.core.domain.TariffPolicy;
import dev.ishtirak.core.domain.Tier;
import dev.ishtirak.core.persistence.OperatorEntity;
import dev.ishtirak.core.persistence.OperatorMembershipEntity;
import dev.ishtirak.core.persistence.Repositories;
import dev.ishtirak.core.persistence.SubscriberEntity;
import dev.ishtirak.core.persistence.TierEntity;
import dev.ishtirak.core.persistence.UserEntity;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.UUID;
import org.springframework.boot.ApplicationRunner;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
@Profile("dev")
public class DemoSeedData {
    public static final UUID OPERATOR_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    public static final UUID TIER_ID = UUID.fromString("20000000-0000-0000-0000-000000000001");
    public static final UUID SUBSCRIBER_ID = UUID.fromString("30000000-0000-0000-0000-000000000001");
    public static final UUID ADMIN_USER_ID = UUID.fromString("40000000-0000-0000-0000-000000000001");
    public static final UUID STAFF_USER_ID = UUID.fromString("40000000-0000-0000-0000-000000000002");
    public static final UUID SUBSCRIBER_USER_ID = UUID.fromString("40000000-0000-0000-0000-000000000003");

    @Bean
    ApplicationRunner seedDemoData(
            Repositories.Operators operators,
            Repositories.Tiers tiers,
            Repositories.Subscribers subscribers,
            Repositories.Users users,
            Repositories.Memberships memberships,
            PasswordEncoder encoder,
            @Value("${ishtirak.demo-password:}") String demoPassword,
            Clock clock) {
        return args -> {
            if (demoPassword == null || demoPassword.length() < 12) {
                throw new IllegalStateException("ishtirak.demo-password must be set to seed dev demo users");
            }
            operators.findById(OPERATOR_ID).orElseGet(() -> operators.save(new OperatorEntity(
                    OPERATOR_ID, "Beirut Demo Operator", TariffPolicy.HYBRID, clock.instant())));
            tiers.findById(TIER_ID).orElseGet(() -> tiers.save(new TierEntity(new Tier(
                    TIER_ID,
                    OPERATOR_ID,
                    "10A",
                    10,
                    TariffPolicy.HYBRID,
                    new BigDecimal("5.00"),
                    450000L,
                    new BigDecimal("0.50"),
                    45000L,
                    ResourceStatus.ACTIVE))));
            subscribers.findById(SUBSCRIBER_ID).orElseGet(() -> subscribers.save(new SubscriberEntity(new Subscriber(
                    SUBSCRIBER_ID,
                    OPERATOR_ID,
                    "Nour Haddad",
                    TIER_ID,
                    "M-1",
                    ResourceStatus.ACTIVE,
                    clock.instant()))));
            seedUser(users, memberships, encoder, clock, ADMIN_USER_ID, "admin@ishtirak.local",
                    demoPassword, ActorRole.OPERATOR_ADMIN, null);
            seedUser(users, memberships, encoder, clock, STAFF_USER_ID, "staff@ishtirak.local",
                    demoPassword, ActorRole.OPERATOR_STAFF, null);
            seedUser(users, memberships, encoder, clock, SUBSCRIBER_USER_ID, "subscriber@ishtirak.local",
                    demoPassword, ActorRole.SUBSCRIBER, SUBSCRIBER_ID);
        };
    }

    private static void seedUser(
            Repositories.Users users,
            Repositories.Memberships memberships,
            PasswordEncoder encoder,
            Clock clock,
            UUID userId,
            String email,
            String password,
            ActorRole role,
            UUID subscriberId) {
        users.findById(userId).orElseGet(() -> users.save(new UserEntity(
                userId, email, encoder.encode(password), email, clock.instant())));
        UUID membershipId = UUID.nameUUIDFromBytes((userId + ":" + role).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        memberships.findById(membershipId).orElseGet(() -> memberships.save(new OperatorMembershipEntity(
                membershipId, userId, OPERATOR_ID, role, subscriberId, clock.instant())));
    }
}

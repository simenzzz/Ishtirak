package dev.ishtirak.core.support;

import dev.ishtirak.core.domain.ResourceStatus;
import dev.ishtirak.core.domain.Subscriber;
import dev.ishtirak.core.domain.TariffPolicy;
import dev.ishtirak.core.domain.Tier;
import dev.ishtirak.core.persistence.OperatorEntity;
import dev.ishtirak.core.persistence.Repositories;
import dev.ishtirak.core.persistence.SubscriberEntity;
import dev.ishtirak.core.persistence.TierEntity;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class CoreTestData {
    public static final UUID OPERATOR_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");

    private final Repositories.Operators operators;
    private final Repositories.Tiers tiers;
    private final Repositories.Subscribers subscribers;
    private final Repositories.Readings readings;
    private final Repositories.Invoices invoices;
    private final Repositories.Payments payments;
    private final Repositories.BillingRuns billingRuns;
    private final Repositories.Outages outages;
    private final Repositories.Users users;
    private final Repositories.Memberships memberships;
    private final Repositories.RefreshTokens refreshTokens;
    private final Repositories.OutboxEvents outboxEvents;
    private final Clock clock;

    public CoreTestData(
            Repositories.Operators operators,
            Repositories.Tiers tiers,
            Repositories.Subscribers subscribers,
            Repositories.Readings readings,
            Repositories.Invoices invoices,
            Repositories.Payments payments,
            Repositories.BillingRuns billingRuns,
            Repositories.Outages outages,
            Repositories.Users users,
            Repositories.Memberships memberships,
            Repositories.RefreshTokens refreshTokens,
            Repositories.OutboxEvents outboxEvents,
            Clock clock) {
        this.operators = operators;
        this.tiers = tiers;
        this.subscribers = subscribers;
        this.readings = readings;
        this.invoices = invoices;
        this.payments = payments;
        this.billingRuns = billingRuns;
        this.outages = outages;
        this.users = users;
        this.memberships = memberships;
        this.refreshTokens = refreshTokens;
        this.outboxEvents = outboxEvents;
        this.clock = clock;
    }

    @Transactional
    public void reset() {
        outboxEvents.deleteAll();
        refreshTokens.deleteAll();
        billingRuns.deleteAll();
        payments.deleteAll();
        invoices.deleteAll();
        readings.deleteAll();
        outages.deleteAll();
        memberships.deleteAll();
        users.deleteAll();
        subscribers.deleteAll();
        tiers.deleteAll();
        operators.deleteAll();
        operators.save(new OperatorEntity(OPERATOR_ID, "Test Operator", TariffPolicy.HYBRID, clock.instant()));
    }

    @Transactional
    public Tier seedTier() {
        return tiers.save(new TierEntity(new Tier(
                UUID.randomUUID(),
                OPERATOR_ID,
                "10A",
                10,
                TariffPolicy.HYBRID,
                new BigDecimal("5.00"),
                450000L,
                new BigDecimal("0.50"),
                45000L,
                ResourceStatus.ACTIVE))).toDomain();
    }

    @Transactional
    public Subscriber seedSubscriber(UUID tierId) {
        return subscribers.save(new SubscriberEntity(new Subscriber(
                UUID.randomUUID(),
                OPERATOR_ID,
                "Nour",
                tierId,
                "M-1",
                ResourceStatus.ACTIVE,
                clock.instant()))).toDomain();
    }
}

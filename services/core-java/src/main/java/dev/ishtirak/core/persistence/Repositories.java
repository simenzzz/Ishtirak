package dev.ishtirak.core.persistence;

import dev.ishtirak.core.domain.InvoiceStatus;
import dev.ishtirak.core.domain.ResourceStatus;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface Repositories {
    interface Operators extends JpaRepository<OperatorEntity, UUID> {
        @Lock(LockModeType.PESSIMISTIC_WRITE)
        @Query("select o from OperatorEntity o where o.id = :id")
        Optional<OperatorEntity> lockById(@Param("id") UUID id);
    }

    interface Users extends JpaRepository<UserEntity, UUID> {
        Optional<UserEntity> findByEmailIgnoreCase(String email);
    }

    interface Memberships extends JpaRepository<OperatorMembershipEntity, UUID> {
        List<OperatorMembershipEntity> findByUserIdAndStatus(UUID userId, ResourceStatus status);
        Optional<OperatorMembershipEntity> findByIdAndUserIdAndStatus(UUID id, UUID userId, ResourceStatus status);
    }

    interface Tiers extends JpaRepository<TierEntity, UUID> {
        Optional<TierEntity> findByOperatorIdAndId(UUID operatorId, UUID id);
        List<TierEntity> findByOperatorId(UUID operatorId);
    }

    interface Subscribers extends JpaRepository<SubscriberEntity, UUID> {
        Optional<SubscriberEntity> findByOperatorIdAndId(UUID operatorId, UUID id);
        Optional<SubscriberEntity> findByOperatorIdAndMeterId(UUID operatorId, String meterId);
        List<SubscriberEntity> findByOperatorId(UUID operatorId);
        List<SubscriberEntity> findByOperatorIdAndStatus(UUID operatorId, ResourceStatus status);
        List<SubscriberEntity> findByOperatorIdAndNameContainingIgnoreCase(UUID operatorId, String name);
        List<SubscriberEntity> findByOperatorIdAndIdIn(UUID operatorId, List<UUID> ids);

        @Lock(LockModeType.PESSIMISTIC_WRITE)
        @Query("select s from SubscriberEntity s where s.operatorId = :operatorId and s.id = :id")
        Optional<SubscriberEntity> lockByOperatorIdAndId(@Param("operatorId") UUID operatorId, @Param("id") UUID id);
    }

    interface Readings extends JpaRepository<ReadingEntity, UUID> {
        List<ReadingEntity> findByOperatorIdAndSubscriberIdOrderByReadingAtDesc(UUID operatorId, UUID subscriberId);

        Optional<ReadingEntity> findFirstByOperatorIdAndSubscriberIdAndReadingAtLessThanEqualOrderByReadingAtDesc(
                UUID operatorId, UUID subscriberId, Instant readingAt);

        Optional<ReadingEntity> findFirstByOperatorIdAndSubscriberIdAndReadingAtLessThanOrderByReadingAtDesc(
                UUID operatorId, UUID subscriberId, Instant readingAt);
    }

    interface Invoices extends JpaRepository<InvoiceEntity, UUID> {
        Optional<InvoiceEntity> findByOperatorIdAndId(UUID operatorId, UUID id);
        List<InvoiceEntity> findByOperatorId(UUID operatorId);
        List<InvoiceEntity> findByOperatorIdAndSubscriberIdOrderByPeriodEndDescIssuedAtDesc(
                UUID operatorId, UUID subscriberId);
        List<InvoiceEntity> findByIdIn(List<UUID> ids);

        Optional<InvoiceEntity> findByOperatorIdAndSubscriberIdAndPeriodStartAndPeriodEnd(
                UUID operatorId, UUID subscriberId, LocalDate periodStart, LocalDate periodEnd);

        @Lock(LockModeType.PESSIMISTIC_WRITE)
        @Query("select i from InvoiceEntity i where i.operatorId = :operatorId and i.id = :id")
        Optional<InvoiceEntity> lockByOperatorIdAndId(@Param("operatorId") UUID operatorId, @Param("id") UUID id);

        List<InvoiceEntity> findByOperatorIdAndStatus(UUID operatorId, InvoiceStatus status);
        List<InvoiceEntity> findByOperatorIdAndPeriodStartAndPeriodEnd(
                UUID operatorId, LocalDate periodStart, LocalDate periodEnd);
    }

    interface Payments extends JpaRepository<PaymentEntity, UUID> {
        List<PaymentEntity> findByOperatorIdAndInvoiceId(UUID operatorId, UUID invoiceId);
    }

    interface BillingRuns extends JpaRepository<BillingRunEntity, UUID> {
        Optional<BillingRunEntity> findByOperatorIdAndIdempotencyKey(UUID operatorId, String idempotencyKey);
    }

    interface Outages extends JpaRepository<OutageEntity, UUID> {
        List<OutageEntity> findByOperatorIdOrderByStartsAtAsc(UUID operatorId);
    }

    interface RefreshTokens extends JpaRepository<RefreshTokenEntity, UUID> {
        Optional<RefreshTokenEntity> findByTokenHash(String tokenHash);

        @Lock(LockModeType.PESSIMISTIC_WRITE)
        @Query("select t from RefreshTokenEntity t where t.tokenHash = :tokenHash")
        Optional<RefreshTokenEntity> lockByTokenHash(@Param("tokenHash") String tokenHash);

        List<RefreshTokenEntity> findByFamilyId(UUID familyId);
    }

    interface DeviceTokens extends JpaRepository<DeviceTokenEntity, UUID> {
        Optional<DeviceTokenEntity> findByTokenHash(String tokenHash);
        List<DeviceTokenEntity> findByOperatorIdOrderByCreatedAtDesc(UUID operatorId);
        Optional<DeviceTokenEntity> findByOperatorIdAndId(UUID operatorId, UUID id);
    }

    interface OutboxEvents extends JpaRepository<OutboxEventEntity, UUID> {
        @Query(value = """
                select * from outbox_events
                where published_at is null and next_attempt_at <= :now
                order by created_at
                limit :limit
                for update skip locked
                """, nativeQuery = true)
        List<OutboxEventEntity> lockPending(@Param("now") Instant now, @Param("limit") int limit);
    }
}

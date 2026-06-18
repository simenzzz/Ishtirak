package dev.ishtirak.core.persistence;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "refresh_tokens")
public class RefreshTokenEntity {
    @Id
    private UUID id;
    private UUID userId;
    private UUID membershipId;
    private String tokenHash;
    private UUID familyId;
    private Instant issuedAt;
    private Instant expiresAt;
    private Instant usedAt;
    private Instant revokedAt;

    protected RefreshTokenEntity() {
    }

    public RefreshTokenEntity(
            UUID id,
            UUID userId,
            UUID membershipId,
            String tokenHash,
            UUID familyId,
            Instant issuedAt,
            Instant expiresAt) {
        this.id = id;
        this.userId = userId;
        this.membershipId = membershipId;
        this.tokenHash = tokenHash;
        this.familyId = familyId;
        this.issuedAt = issuedAt;
        this.expiresAt = expiresAt;
    }

    public UUID userId() {
        return userId;
    }

    public UUID membershipId() {
        return membershipId;
    }

    public UUID familyId() {
        return familyId;
    }

    public boolean usableAt(Instant now) {
        return usedAt == null && revokedAt == null && expiresAt.isAfter(now);
    }

    public void markUsed(Instant now) {
        usedAt = now;
    }

    public void revoke(Instant now) {
        revokedAt = now;
    }
}

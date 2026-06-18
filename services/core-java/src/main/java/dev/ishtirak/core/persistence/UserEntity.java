package dev.ishtirak.core.persistence;

import dev.ishtirak.core.domain.ResourceStatus;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "users")
public class UserEntity {
    @Id
    private UUID id;
    private String email;
    private String passwordHash;
    private String displayName;
    @Enumerated(EnumType.STRING)
    private ResourceStatus status;
    private Instant createdAt;

    protected UserEntity() {
    }

    public UserEntity(UUID id, String email, String passwordHash, String displayName, Instant createdAt) {
        this.id = id;
        this.email = email;
        this.passwordHash = passwordHash;
        this.displayName = displayName;
        this.status = ResourceStatus.ACTIVE;
        this.createdAt = createdAt;
    }

    public UUID id() {
        return id;
    }

    public String email() {
        return email;
    }

    public String passwordHash() {
        return passwordHash;
    }

    public String displayName() {
        return displayName;
    }

    public boolean active() {
        return status == ResourceStatus.ACTIVE;
    }
}

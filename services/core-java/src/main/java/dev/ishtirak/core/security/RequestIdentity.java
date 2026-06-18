package dev.ishtirak.core.security;

import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.domain.ActorRole;
import java.util.UUID;
import org.springframework.http.HttpStatus;

public record RequestIdentity(UUID operatorId, ActorRole role, UUID subscriberId) {
    public boolean isAdmin() {
        return role == ActorRole.OPERATOR_ADMIN;
    }

    public boolean isStaffOrAdmin() {
        return role == ActorRole.OPERATOR_ADMIN || role == ActorRole.OPERATOR_STAFF;
    }

    public UUID requireSubscriberId() {
        if (role != ActorRole.SUBSCRIBER || subscriberId == null) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Subscriber identity required");
        }
        return subscriberId;
    }

    public void requireAdmin() {
        if (!isAdmin()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Admin role required");
        }
    }

    public void requireStaffOrAdmin() {
        if (!isStaffOrAdmin()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Staff or admin role required");
        }
    }
}

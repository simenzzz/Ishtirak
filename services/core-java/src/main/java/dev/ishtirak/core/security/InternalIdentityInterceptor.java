package dev.ishtirak.core.security;

import dev.ishtirak.core.domain.ActorRole;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class InternalIdentityInterceptor implements HandlerInterceptor {
    public static final String IDENTITY_ATTRIBUTE = "ishtirak.identity";
    private final ServiceTokenVerifier serviceTokenVerifier;

    public InternalIdentityInterceptor(ObjectProvider<ServiceTokenVerifier> serviceTokenVerifier) {
        this.serviceTokenVerifier = serviceTokenVerifier.getIfAvailable();
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (isPublic(request.getRequestURI())) {
            return true;
        }
        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
        String operatorId = request.getHeader("X-Operator-Id");
        String role = request.getHeader("X-Actor-Role");
        if (missingBearer(authorization) || operatorId == null || role == null) {
            response.setStatus(HttpStatus.UNAUTHORIZED.value());
            return false;
        }
        if (serviceTokenVerifier == null) {
            response.setStatus(HttpStatus.UNAUTHORIZED.value());
            return false;
        }
        try {
            Map<String, Object> claims = serviceTokenVerifier.verify(authorization.substring(7));
            requireClaim(claims, "operatorId", operatorId);
            requireClaim(claims, "role", role);
            requireOptionalClaim(claims, "subscriberId", request.getHeader("X-Actor-Subscriber-Id"));
            UUID subscriberId = optionalUuid(request.getHeader("X-Actor-Subscriber-Id"));
            request.setAttribute(IDENTITY_ATTRIBUTE,
                    new RequestIdentity(UUID.fromString(operatorId), ActorRole.valueOf(role), subscriberId));
        } catch (RuntimeException ex) {
            response.setStatus(HttpStatus.UNAUTHORIZED.value());
            return false;
        }
        return true;
    }

    private static boolean isPublic(String uri) {
        return uri.equals("/health")
                || uri.equals("/ready")
                || uri.startsWith("/actuator")
                || uri.startsWith("/auth/")
                || uri.startsWith("/ingest/");
    }

    private static boolean missingBearer(String authorization) {
        return authorization == null || !authorization.startsWith("Bearer ") || authorization.length() <= 7;
    }

    private static UUID optionalUuid(String value) {
        return value == null || value.isBlank() ? null : UUID.fromString(value);
    }

    private static void requireClaim(Map<String, Object> claims, String name, String header) {
        if (!String.valueOf(claims.get(name)).equals(header)) {
            throw new IllegalArgumentException("Service token claim mismatch");
        }
    }

    private static void requireOptionalClaim(Map<String, Object> claims, String name, String header) {
        Object claim = claims.get(name);
        if (header == null || header.isBlank()) {
            if (claim != null) {
                throw new IllegalArgumentException("Unexpected service token claim");
            }
            return;
        }
        if (!String.valueOf(claim).equals(header)) {
            throw new IllegalArgumentException("Service token claim mismatch");
        }
    }
}

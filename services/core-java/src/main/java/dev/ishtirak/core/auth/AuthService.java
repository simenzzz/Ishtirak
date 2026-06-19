package dev.ishtirak.core.auth;

import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.domain.ResourceStatus;
import dev.ishtirak.core.persistence.OperatorMembershipEntity;
import dev.ishtirak.core.persistence.RefreshTokenEntity;
import dev.ishtirak.core.persistence.Repositories;
import dev.ishtirak.core.persistence.UserEntity;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
    private static final Duration ACCESS_TTL = Duration.ofMinutes(15);
    private static final Duration SELECTION_TTL = Duration.ofMinutes(5);
    private static final Duration REFRESH_TTL = Duration.ofDays(30);

    private final Repositories.Users users;
    private final Repositories.Memberships memberships;
    private final Repositories.Operators operators;
    private final Repositories.RefreshTokens refreshTokens;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public AuthService(
            Repositories.Users users,
            Repositories.Memberships memberships,
            Repositories.Operators operators,
            Repositories.RefreshTokens refreshTokens,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            Clock clock) {
        this.users = users;
        this.memberships = memberships;
        this.operators = operators;
        this.refreshTokens = refreshTokens;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.clock = clock;
    }

    @Transactional
    public LoginResult login(String email, String password) {
        UserEntity user = users.findByEmailIgnoreCase(email)
                .filter(UserEntity::active)
                .filter(candidate -> passwordEncoder.matches(password, candidate.passwordHash()))
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Invalid credentials"));
        List<MembershipView> views = membershipViews(user.id());
        if (views.isEmpty()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "No active memberships");
        }
        if (views.size() == 1) {
            OperatorMembershipEntity membership = memberships.findById(views.getFirst().membershipId()).orElseThrow();
            return LoginResult.tokens(issueTokens(user, membership), views);
        }
        String selectionToken = jwtService.sign(Map.of("typ", "selection", "userId", user.id()), SELECTION_TTL);
        return LoginResult.selection(selectionToken, views);
    }

    @Transactional
    public TokenPair selectContext(String selectionToken, UUID membershipId) {
        Map<String, Object> claims = jwtService.verify(selectionToken, "selection");
        UUID userId = UUID.fromString(String.valueOf(claims.get("userId")));
        UserEntity user = users.findById(userId)
                .filter(UserEntity::active)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Invalid token"));
        OperatorMembershipEntity membership = memberships.findByIdAndUserIdAndStatus(
                        membershipId, user.id(), ResourceStatus.ACTIVE)
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Membership not available"));
        return issueTokens(user, membership);
    }

    @Transactional(noRollbackFor = ApiException.class)
    public TokenPair refresh(String refreshToken) {
        RefreshTokenEntity current = refreshTokens.lockByTokenHash(hash(refreshToken))
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Invalid refresh token"));
        if (!current.usableAt(clock.instant())) {
            revokeFamily(current.familyId());
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Invalid refresh token");
        }
        UserEntity user = users.findById(current.userId())
                .filter(UserEntity::active)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Invalid refresh token"));
        OperatorMembershipEntity membership = memberships.findByIdAndUserIdAndStatus(
                        current.membershipId(), user.id(), ResourceStatus.ACTIVE)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Invalid refresh token"));
        current.markUsed(clock.instant());
        return issueTokens(user, membership, current.familyId());
    }

    /**
     * Revoke the refresh-token family behind {@code refreshToken} so logout invalidates
     * the credential server-side, not just in the browser. Unknown or already-revoked
     * tokens are a no-op — we never reveal whether a token exists.
     */
    @Transactional
    public void logout(String refreshToken) {
        refreshTokens.lockByTokenHash(hash(refreshToken))
                .ifPresent(token -> revokeFamily(token.familyId()));
    }

    private List<MembershipView> membershipViews(UUID userId) {
        return memberships.findByUserIdAndStatus(userId, ResourceStatus.ACTIVE).stream()
                .map(membership -> new MembershipView(
                        membership.id(),
                        membership.operatorId(),
                        operators.findById(membership.operatorId()).map(operator -> operator.name()).orElse("Operator"),
                        membership.role(),
                        membership.subscriberId()))
                .toList();
    }

    private TokenPair issueTokens(UserEntity user, OperatorMembershipEntity membership) {
        return issueTokens(user, membership, UUID.randomUUID());
    }

    private TokenPair issueTokens(UserEntity user, OperatorMembershipEntity membership, UUID familyId) {
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("typ", "access");
        claims.put("sub", user.id());
        claims.put("membershipId", membership.id());
        claims.put("operatorId", membership.operatorId());
        claims.put("role", membership.role());
        if (membership.subscriberId() != null) {
            claims.put("subscriberId", membership.subscriberId());
        }
        String refresh = randomToken();
        refreshTokens.save(new RefreshTokenEntity(
                UUID.randomUUID(),
                user.id(),
                membership.id(),
                hash(refresh),
                familyId,
                clock.instant(),
                clock.instant().plus(REFRESH_TTL)));
        return new TokenPair(jwtService.sign(claims, ACCESS_TTL), refresh);
    }

    private void revokeFamily(UUID familyId) {
        refreshTokens.findByFamilyId(familyId).forEach(token -> token.revoke(clock.instant()));
    }

    private String randomToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception ex) {
            throw new IllegalStateException("Could not hash token", ex);
        }
    }
}

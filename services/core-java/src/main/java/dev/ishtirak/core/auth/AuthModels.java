package dev.ishtirak.core.auth;

import dev.ishtirak.core.domain.ActorRole;
import java.util.List;
import java.util.UUID;

record MembershipView(
        UUID membershipId,
        UUID operatorId,
        String operatorName,
        ActorRole role,
        UUID subscriberId) {
}

record TokenPair(String accessToken, String refreshToken) {
}

record LoginResult(
        boolean contextSelectionRequired,
        String selectionToken,
        String accessToken,
        String refreshToken,
        List<MembershipView> memberships) {
    static LoginResult selection(String selectionToken, List<MembershipView> memberships) {
        return new LoginResult(true, selectionToken, null, null, memberships);
    }

    static LoginResult tokens(TokenPair tokens, List<MembershipView> memberships) {
        return new LoginResult(false, null, tokens.accessToken(), tokens.refreshToken(), memberships);
    }
}

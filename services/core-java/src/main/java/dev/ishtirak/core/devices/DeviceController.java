package dev.ishtirak.core.devices;

import dev.ishtirak.core.devices.DeviceTokenService.MintDeviceTokenRequest;
import dev.ishtirak.core.devices.DeviceTokenService.MintedDeviceToken;
import dev.ishtirak.core.domain.DeviceToken;
import dev.ishtirak.core.domain.DeviceTokenStatus;
import dev.ishtirak.core.security.RequestIdentity;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DeviceController {
    private final DeviceTokenService deviceTokenService;

    public DeviceController(DeviceTokenService deviceTokenService) {
        this.deviceTokenService = deviceTokenService;
    }

    @PostMapping("/devices")
    @ResponseStatus(HttpStatus.CREATED)
    MintedDeviceTokenResponse mint(RequestIdentity identity, @Valid @RequestBody MintDeviceTokenRequest request) {
        identity.requireAdmin();
        return MintedDeviceTokenResponse.from(deviceTokenService.mint(identity.operatorId(), request));
    }

    @GetMapping("/devices")
    List<DeviceTokenResponse> list(RequestIdentity identity) {
        identity.requireStaffOrAdmin();
        return deviceTokenService.list(identity.operatorId()).stream().map(DeviceTokenResponse::from).toList();
    }

    @PostMapping("/devices/{id}/revoke")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void revoke(RequestIdentity identity, @PathVariable UUID id) {
        identity.requireAdmin();
        deviceTokenService.revoke(identity.operatorId(), id);
    }

    record DeviceTokenResponse(
            UUID id, String label, DeviceTokenStatus status, Instant createdAt, Instant lastSeenAt) {
        static DeviceTokenResponse from(DeviceToken token) {
            return new DeviceTokenResponse(
                    token.id(), token.label(), token.status(), token.createdAt(), token.lastSeenAt());
        }
    }

    /** The plaintext {@code token} is returned only here, at mint time, and never stored. */
    record MintedDeviceTokenResponse(
            UUID id, String label, String token, DeviceTokenStatus status, Instant createdAt) {
        static MintedDeviceTokenResponse from(MintedDeviceToken minted) {
            DeviceToken token = minted.token();
            return new MintedDeviceTokenResponse(
                    token.id(), token.label(), minted.secret(), token.status(), token.createdAt());
        }
    }
}

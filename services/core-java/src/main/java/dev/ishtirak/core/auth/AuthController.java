package dev.ishtirak.core.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuthController {
    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/auth/login")
    LoginResult login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request.email(), request.password());
    }

    @PostMapping("/auth/select-context")
    TokenPair selectContext(@Valid @RequestBody SelectContextRequest request) {
        return authService.selectContext(request.selectionToken(), request.membershipId());
    }

    @PostMapping("/auth/refresh")
    TokenPair refresh(@Valid @RequestBody RefreshRequest request) {
        return authService.refresh(request.refreshToken());
    }

    record LoginRequest(@NotNull @Email String email, @NotBlank String password) {
    }

    record SelectContextRequest(@NotBlank String selectionToken, @NotNull UUID membershipId) {
    }

    record RefreshRequest(@NotBlank String refreshToken) {
    }
}

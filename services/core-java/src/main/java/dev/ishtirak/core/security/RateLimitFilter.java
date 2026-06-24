package dev.ishtirak.core.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class RateLimitFilter extends OncePerRequestFilter {
    private final int mutationsPerMinute;
    private final int readingsPerMinute;
    private final int billingPerHour;
    private final int ingestPerMinute;
    private final Clock clock = Clock.systemUTC();
    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    public RateLimitFilter(
            @Value("${ishtirak.rate-limit.mutations-per-minute:60}") int mutationsPerMinute,
            @Value("${ishtirak.rate-limit.readings-per-minute:120}") int readingsPerMinute,
            @Value("${ishtirak.rate-limit.billing-per-hour:3}") int billingPerHour,
            @Value("${ishtirak.rate-limit.ingest-per-minute:300}") int ingestPerMinute) {
        this.mutationsPerMinute = mutationsPerMinute;
        this.readingsPerMinute = readingsPerMinute;
        this.billingPerHour = billingPerHour;
        this.ingestPerMinute = ingestPerMinute;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        Limit limit = limitFor(request);
        if (limit != null && exceeded(request, limit)) {
            response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            return;
        }
        filterChain.doFilter(request, response);
    }

    private boolean exceeded(HttpServletRequest request, Limit limit) {
        String subject = subject(request);
        long window = window(limit.seconds());
        pruneOldWindows(limit.name(), window);
        String key = subject + ":" + limit.name() + ":" + window;
        Window updated = windows.compute(key, (ignored, current) -> current == null ? new Window(1) : current.increment());
        return updated.count() > limit.maxRequests();
    }

    private String subject(HttpServletRequest request) {
        // The ingest path is device-authenticated and carries no operator header, so
        // keying on the (gateway) source IP would collapse every device of every
        // operator into one shared bucket. Key on the device credential instead so the
        // limit is genuinely per-device and independent of the gateway's own limiter.
        if ("/ingest/readings".equals(request.getRequestURI())) {
            return deviceSubject(request);
        }
        String operatorId = request.getHeader("X-Operator-Id");
        String actorRole = request.getHeader("X-Actor-Role");
        return operatorId == null ? request.getRemoteAddr() : operatorId + ":" + actorRole;
    }

    private static String deviceSubject(HttpServletRequest request) {
        String authorization = request.getHeader("Authorization");
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return request.getRemoteAddr();
        }
        return "device:" + sha256(authorization.substring(7).trim());
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception ex) {
            throw new IllegalStateException("Could not hash device credential", ex);
        }
    }

    private void pruneOldWindows(String limitName, long currentWindow) {
        windows.keySet().removeIf(key -> key.contains(":" + limitName + ":")
                && windowFrom(key) < currentWindow - 1);
    }

    private static long windowFrom(String key) {
        return Long.parseLong(key.substring(key.lastIndexOf(':') + 1));
    }

    private Limit limitFor(HttpServletRequest request) {
        if ("POST".equals(request.getMethod()) && request.getRequestURI().equals("/billing-runs")) {
            return new Limit("billing", billingPerHour, 3600);
        }
        if ("POST".equals(request.getMethod()) && request.getRequestURI().equals("/readings")) {
            return new Limit("readings", readingsPerMinute, 60);
        }
        if ("POST".equals(request.getMethod()) && request.getRequestURI().equals("/ingest/readings")) {
            return new Limit("ingest", ingestPerMinute, 60);
        }
        if (!"GET".equals(request.getMethod()) && !isPublic(request.getRequestURI())) {
            return new Limit("mutations", mutationsPerMinute, 60);
        }
        return null;
    }

    private long window(int seconds) {
        return clock.instant().getEpochSecond() / seconds;
    }

    private static boolean isPublic(String uri) {
        return uri.equals("/health") || uri.equals("/ready") || uri.startsWith("/actuator");
    }

    private record Limit(String name, int maxRequests, int seconds) {
    }

    private record Window(int count) {
        Window increment() {
            return new Window(count + 1);
        }
    }
}

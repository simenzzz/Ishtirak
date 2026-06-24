package dev.ishtirak.core.readings.ingest;

import dev.ishtirak.core.common.ApiException;
import dev.ishtirak.core.devices.DeviceTokenService;
import dev.ishtirak.core.persistence.Repositories;
import dev.ishtirak.core.persistence.SubscriberEntity;
import dev.ishtirak.core.readings.ReadingService;
import dev.ishtirak.core.readings.ReadingService.IngestOutcome;
import dev.ishtirak.core.readings.ingest.IngestResult.IngestError;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Orchestrates a device-authenticated batch of meter readings: resolve the device
 * to its operator, map each meter serial to a subscriber, and record idempotently.
 *
 * <p>Items are processed independently so a single bad reading (unknown meter,
 * conflicting value) never fails the whole batch — the edge agent gets a per-item
 * verdict and only retries what it must. This package depends on
 * {@link ReadingService} and repositories, never the reverse, so the whole ingest
 * surface can later move behind a standalone service without touching the contract.
 */
@Service
public class IngestService {
    private final DeviceTokenService deviceTokenService;
    private final Repositories.Subscribers subscribers;
    private final ReadingService readingService;

    public IngestService(
            DeviceTokenService deviceTokenService,
            Repositories.Subscribers subscribers,
            ReadingService readingService) {
        this.deviceTokenService = deviceTokenService;
        this.subscribers = subscribers;
        this.readingService = readingService;
    }

    public IngestResult ingest(String deviceToken, List<IngestReadingItem> items) {
        UUID operatorId = deviceTokenService.authenticate(deviceToken);
        int recorded = 0;
        int duplicates = 0;
        List<IngestError> errors = new ArrayList<>();
        for (IngestReadingItem item : items) {
            try {
                IngestOutcome outcome = recordItem(operatorId, item);
                if (outcome == IngestOutcome.DUPLICATE) {
                    duplicates++;
                } else {
                    recorded++;
                }
            } catch (ApiException ex) {
                errors.add(new IngestError(item.meterId(), item.readingAt(), ex.code(), ex.getMessage()));
            }
        }
        return new IngestResult(recorded, duplicates, List.copyOf(errors));
    }

    private IngestOutcome recordItem(UUID operatorId, IngestReadingItem item) {
        UUID subscriberId = subscribers.findByOperatorIdAndMeterId(operatorId, item.meterId())
                .map(SubscriberEntity::id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "UNKNOWN_METER", "No subscriber for meter id"));
        return readingService.ingest(operatorId, subscriberId, item.kwh(), item.readingAt());
    }
}

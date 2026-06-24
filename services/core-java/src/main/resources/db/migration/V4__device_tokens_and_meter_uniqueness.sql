-- Physical-meter ingestion: device credentials + meter-serial uniqueness.

-- Long-lived, operator-scoped credentials presented by a generator-site edge agent.
-- Only the SHA-256 hash of the token is stored; the plaintext is shown once at mint.
CREATE TABLE device_tokens (
    id UUID PRIMARY KEY,
    operator_id UUID NOT NULL REFERENCES operators(id),
    label TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
    created_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ
);

CREATE INDEX idx_device_tokens_operator ON device_tokens(operator_id);

-- A meter serial identifies at most one subscriber within an operator, so the
-- ingest path can resolve meter_id -> subscriber deterministically. Partial
-- index keeps NULL meter_id (un-metered subscribers) unconstrained.
CREATE UNIQUE INDEX uq_subscribers_operator_meter
    ON subscribers (operator_id, meter_id)
    WHERE meter_id IS NOT NULL;

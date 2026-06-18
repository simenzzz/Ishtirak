CREATE TABLE operators (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    default_tariff_policy TEXT NOT NULL CHECK (default_tariff_policy IN ('FLAT', 'METERED', 'HYBRID')),
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE operator_memberships (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    operator_id UUID NOT NULL REFERENCES operators(id),
    role TEXT NOT NULL CHECK (role IN ('OPERATOR_ADMIN', 'OPERATOR_STAFF', 'SUBSCRIBER')),
    subscriber_id UUID,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (user_id, operator_id, role, subscriber_id)
);

CREATE TABLE tiers (
    id UUID PRIMARY KEY,
    operator_id UUID NOT NULL REFERENCES operators(id),
    name TEXT NOT NULL,
    amperage INTEGER NOT NULL CHECK (amperage >= 1),
    tariff_policy_override TEXT CHECK (tariff_policy_override IN ('FLAT', 'METERED', 'HYBRID')),
    standing_fee_usd NUMERIC(12, 2) NOT NULL CHECK (standing_fee_usd >= 0),
    standing_fee_lbp BIGINT NOT NULL CHECK (standing_fee_lbp >= 0),
    per_kwh_rate_usd NUMERIC(12, 4) NOT NULL CHECK (per_kwh_rate_usd >= 0),
    per_kwh_rate_lbp BIGINT NOT NULL CHECK (per_kwh_rate_lbp >= 0),
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE subscribers (
    id UUID PRIMARY KEY,
    operator_id UUID NOT NULL REFERENCES operators(id),
    name TEXT NOT NULL,
    tier_id UUID NOT NULL REFERENCES tiers(id),
    meter_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE operator_memberships
    ADD CONSTRAINT fk_membership_subscriber FOREIGN KEY (subscriber_id) REFERENCES subscribers(id);

CREATE TABLE readings (
    id UUID PRIMARY KEY,
    operator_id UUID NOT NULL REFERENCES operators(id),
    subscriber_id UUID NOT NULL REFERENCES subscribers(id),
    kwh NUMERIC(14, 3) NOT NULL CHECK (kwh >= 0),
    reading_at TIMESTAMPTZ NOT NULL,
    UNIQUE (operator_id, subscriber_id, reading_at)
);

CREATE INDEX readings_subscriber_time_idx ON readings(operator_id, subscriber_id, reading_at DESC);

CREATE TABLE invoices (
    id UUID PRIMARY KEY,
    operator_id UUID NOT NULL REFERENCES operators(id),
    subscriber_id UUID NOT NULL REFERENCES subscribers(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    amount_usd NUMERIC(12, 2) NOT NULL CHECK (amount_usd >= 0),
    amount_lbp BIGINT NOT NULL CHECK (amount_lbp >= 0),
    kwh_consumed NUMERIC(14, 3) NOT NULL CHECK (kwh_consumed >= 0),
    status TEXT NOT NULL CHECK (status IN ('ISSUED', 'PARTIAL', 'PAID', 'VOID')),
    issued_at TIMESTAMPTZ NOT NULL,
    UNIQUE (operator_id, subscriber_id, period_start, period_end)
);

CREATE TABLE payments (
    id UUID PRIMARY KEY,
    operator_id UUID NOT NULL REFERENCES operators(id),
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    subscriber_id UUID NOT NULL REFERENCES subscribers(id),
    currency TEXT NOT NULL CHECK (currency IN ('USD', 'LBP')),
    tendered_amount NUMERIC(14, 2) NOT NULL CHECK (tendered_amount > 0),
    applied_usd NUMERIC(12, 2) NOT NULL CHECK (applied_usd >= 0),
    applied_lbp BIGINT NOT NULL CHECK (applied_lbp >= 0),
    method TEXT NOT NULL CHECK (method IN ('CASH', 'WHISH')),
    received_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE billing_runs (
    id UUID PRIMARY KEY,
    operator_id UUID NOT NULL REFERENCES operators(id),
    idempotency_key TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    invoice_count INTEGER NOT NULL CHECK (invoice_count >= 0),
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (operator_id, idempotency_key)
);

CREATE TABLE billing_run_invoices (
    billing_run_id UUID NOT NULL REFERENCES billing_runs(id),
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    PRIMARY KEY (billing_run_id, invoice_id)
);

CREATE TABLE outages (
    id UUID PRIMARY KEY,
    operator_id UUID NOT NULL REFERENCES operators(id),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('FUEL', 'MAINTENANCE', 'GRID', 'OTHER')),
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (ends_at > starts_at)
);

CREATE INDEX outages_operator_time_idx ON outages(operator_id, starts_at, ends_at);

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    membership_id UUID NOT NULL REFERENCES operator_memberships(id),
    token_hash TEXT NOT NULL UNIQUE,
    family_id UUID NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX refresh_tokens_family_idx ON refresh_tokens(family_id);

CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    event_type TEXT NOT NULL,
    operator_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX outbox_pending_idx ON outbox_events(published_at, next_attempt_at, created_at);

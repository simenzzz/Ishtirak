-- Allow the NEEDS_REVIEW invoice state: a billing run that cannot compute a
-- subscriber's consumption (missing period reading or a meter rollback) holds the
-- invoice for operator review instead of aborting the whole run.
ALTER TABLE invoices DROP CONSTRAINT invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('ISSUED', 'PARTIAL', 'PAID', 'VOID', 'NEEDS_REVIEW'));

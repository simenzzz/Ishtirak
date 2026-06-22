package dev.ishtirak.core.domain;

public enum InvoiceStatus {
    ISSUED,
    PARTIAL,
    PAID,
    VOID,
    /** Consumption could not be computed (missing reading or meter rollback); held for operator review. */
    NEEDS_REVIEW
}

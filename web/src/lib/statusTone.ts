import type { InvoiceStatus, Status } from "./types";

export type Tone = "neutral" | "ok" | "warn" | "danger" | "brass";

export type StatusView = Readonly<{ label: string; tone: Tone }>;

const UNKNOWN: StatusView = { label: "—", tone: "neutral" };

// Subscriber-facing labels stay in the interface's voice; tests assert on the
// exact strings ("Under review", "Voided"), so keep them stable.
const INVOICE_STATUS: Record<InvoiceStatus, StatusView> = {
  ISSUED: { label: "Issued", tone: "neutral" },
  PARTIAL: { label: "Partially paid", tone: "warn" },
  PAID: { label: "Paid", tone: "ok" },
  VOID: { label: "Voided", tone: "danger" },
  NEEDS_REVIEW: { label: "Under review", tone: "warn" },
};

const SUBSCRIBER_STATUS: Record<Status, StatusView> = {
  ACTIVE: { label: "Active", tone: "ok" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
};

export function invoiceStatusView(status?: InvoiceStatus): StatusView {
  return status ? INVOICE_STATUS[status] : UNKNOWN;
}

export function subscriberStatusView(status?: Status): StatusView {
  return status ? SUBSCRIBER_STATUS[status] : UNKNOWN;
}

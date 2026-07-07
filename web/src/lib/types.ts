export type Role = "OPERATOR_ADMIN" | "OPERATOR_STAFF" | "SUBSCRIBER";
export type Status = "ACTIVE" | "INACTIVE";
export type TariffPolicy = "FLAT" | "METERED" | "HYBRID";
export type Currency = "USD" | "LBP";

export type PageMeta = Readonly<{ total: number; page: number; limit: number }>;
export type Paginated<T> = Readonly<{ data: readonly T[]; meta: PageMeta }>;
export type ApiErrorBody = Readonly<{
  error: { code: string; message: string; details?: readonly { field?: string; issue?: string }[] };
}>;

export type Membership = Readonly<{
  membershipId: string;
  operatorId: string;
  operatorName: string;
  role: Role;
  subscriberId?: string;
}>;

export type Identity = Readonly<{
  operatorId: string;
  role: Role;
  subscriberId?: string;
  name?: string;
}>;

// The refresh token lives only in an HttpOnly cookie set by the gateway; the
// browser holds the short-lived access token in memory.
export type AuthTokens = Readonly<{ accessToken: string }>;
export type LoginResult =
  | Readonly<{ contextSelectionRequired: true; selectionToken: string; memberships: readonly Membership[] }>
  | Readonly<{ contextSelectionRequired?: false; accessToken: string; memberships: readonly Membership[] }>;

export type Tier = Readonly<{
  id: string;
  name: string;
  amperage: number;
  tariffPolicyOverride?: TariffPolicy | null;
  effectiveTariffPolicy: TariffPolicy;
  standingFeeUsd: number;
  standingFeeLbp: number;
  perKwhRateUsd: number;
  perKwhRateLbp: number;
  status: Status;
}>;

export type Subscriber = Readonly<{
  id: string;
  name: string;
  tierId: string;
  meterId?: string;
  status: Status;
  createdAt?: string;
}>;

export type Reading = Readonly<{ id: string; subscriberId: string; kwh: number; readingAt: string }>;
export type InvoiceStatus = "ISSUED" | "PARTIAL" | "PAID" | "VOID" | "NEEDS_REVIEW";
export type Invoice = Readonly<{
  id: string;
  subscriberId: string;
  periodStart: string;
  periodEnd: string;
  amountUsd: number;
  amountLbp: number;
  kwhConsumed: number;
  status: InvoiceStatus;
  issuedAt?: string;
}>;

export type BillingRunInvoice = Readonly<{
  id: string;
  subscriberId: string;
  subscriberName: string;
  amountUsd: number;
  amountLbp: number;
}>;

export type Payment = Readonly<{
  id: string;
  invoiceId: string;
  subscriberId: string;
  currency: Currency;
  tenderedAmount: number;
  appliedUsd: number;
  appliedLbp: number;
  method: "CASH" | "WHISH";
  receivedAt?: string;
}>;

export type Outage = Readonly<{
  id: string;
  startsAt: string;
  endsAt: string;
  reason: "FUEL" | "MAINTENANCE" | "GRID" | "OTHER";
  createdAt?: string;
}>;

export type RiskFlag = Readonly<{
  readingId: string;
  subscriberId: string;
  score: number;
  reason: "NEGATIVE_DELTA" | "ZERO_DELTA" | "DROP_GT_THRESHOLD" | "EXCEEDS_TIER_CAP" | "ML_ANOMALY";
  label?: "UNREVIEWED" | "CONFIRMED" | "DISMISSED";
  scoredAt?: string;
}>;

export type CollectionRate = Readonly<{
  periodStart: string;
  periodEnd: string;
  issuedUsd: number;
  issuedLbp: number;
  collectedUsd: number;
  collectedLbp: number;
  rate: number;
}>;

export type WsChannel = "alerts" | "outages" | "invoices";
export type WsEvent =
  | Readonly<{ type: "outage.countdown"; data: { outageId: string; startsAt: string; endsAt: string; secondsRemaining: number } }>
  | Readonly<{ type: "invoice.ready"; data: { invoiceId: string; amountUsd: number; amountLbp: number; periodEnd: string } }>
  | Readonly<{ type: "invoice.updated"; data: { invoiceId: string; periodEnd: string; status: "NEEDS_REVIEW" | "VOID" } }>
  | Readonly<{ type: "tampering.alert"; data: { subscriberId: string; readingId: string; reason: string; score: number } }>
  | Readonly<{ type: "pong"; data?: unknown }>
  | Readonly<{ type: "unauthorized"; data: { channel: WsChannel; reason: string } }>;

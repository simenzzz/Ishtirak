import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { App } from "../App";
import { AuthProvider } from "../auth/AuthContext";
import { clearAccessToken, writeAccessToken } from "../lib/tokenStore";
import { installMockWebSocket } from "../test/testUtils";

const subscriber = { id: "11111111-1111-4111-8111-111111111111", name: "Rana", tierId: "t1", meterId: "M-1", status: "ACTIVE" };
const tier = { id: "t1", name: "10A", amperage: 10, effectiveTariffPolicy: "HYBRID", standingFeeUsd: 5, standingFeeLbp: 450000, perKwhRateUsd: 0.2, perKwhRateLbp: 18000, status: "ACTIVE" };
const invoice = { id: "22222222-2222-4222-8222-222222222222", subscriberId: subscriber.id, periodStart: "2026-06-01", periodEnd: "2026-06-30", amountUsd: 12, amountLbp: 1080000, kwhConsumed: 30, status: "ISSUED" };
const outage = { id: "o1", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 60000).toISOString(), reason: "GRID" };

function page<T>(data: T[]) {
  return { data, meta: { total: data.length, page: 1, limit: 10 } };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installGatewayMock(options: {
  readonly currentInvoice?: typeof invoice;
  readonly payments?: readonly unknown[];
  readonly billingResult?: unknown;
} = {}) {
  const currentInvoice = options.currentInvoice ?? invoice;
  const currentPayments = options.payments ?? [{ id: "p1", invoiceId: invoice.id, subscriberId: subscriber.id, currency: "USD", tenderedAmount: 5, appliedUsd: 5, appliedLbp: 450000, method: "CASH" }];
  const billingResult = options.billingResult ?? {
    issuedCount: 2,
    needsReviewCount: 0,
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    invoices: [
      { id: invoice.id, subscriberId: subscriber.id, subscriberName: "Rana", amountUsd: 12, amountLbp: 1080000 },
      { id: "33333333-3333-4333-8333-333333333333", subscriberId: "44444444-4444-4444-8444-444444444444", subscriberName: "Wael", amountUsd: 8, amountLbp: 720000 },
    ],
  };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/me")) return Promise.resolve(json({ operatorId: "op", role: "OPERATOR_ADMIN", name: "Admin" }));
    if (init?.method === "POST" && url.includes("/api/billing-runs")) return Promise.resolve(json(billingResult));
    if (init?.method === "POST" || init?.method === "PATCH") return Promise.resolve(json({ ...subscriber, ...tier, ...currentInvoice, ...outage }));
    if (url.includes("/api/subscribers/") && url.includes("/readings")) return Promise.resolve(json(page([{ id: "r1", subscriberId: subscriber.id, kwh: 44, readingAt: new Date().toISOString() }])));
    if (url.includes("/api/subscribers/")) return Promise.resolve(json(subscriber));
    if (url.includes("/api/subscribers")) return Promise.resolve(json(page([subscriber])));
    if (url.includes("/api/tiers")) return Promise.resolve(json(page([tier])));
    if (url.includes("/api/invoices/") && url.includes("/payments")) return Promise.resolve(json(currentPayments));
    if (url.includes("/api/invoices/")) return Promise.resolve(json(currentInvoice));
    if (url.includes("/api/invoices")) return Promise.resolve(json(page([currentInvoice])));
    if (url.includes("/api/outages")) return Promise.resolve(json(page([outage])));
    if (url.includes("/api/analytics/collection-rate")) return Promise.resolve(json([{ periodStart: "2026-06-01", periodEnd: "2026-06-30", issuedUsd: 12, issuedLbp: 1080000, collectedUsd: 6, collectedLbp: 540000, rate: 0.5 }]));
    if (url.includes("/api/analytics/risk")) return Promise.resolve(json(page([{ readingId: "r1", subscriberId: subscriber.id, score: 0.8, reason: "ZERO_DELTA" }])));
    return Promise.resolve(json({}));
  }));
}

function renderOperator(route: string, options?: Parameters<typeof installGatewayMock>[0]) {
  writeAccessToken("a");
  installMockWebSocket();
  installGatewayMock(options);
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider><App /></AuthProvider>
    </MemoryRouter>,
  );
}

describe("operator pages", () => {
  beforeEach(() => {
    clearAccessToken();
    vi.restoreAllMocks();
  });

  it.each([
    ["/operator/subscribers", "Rana"],
    [`/operator/subscribers/${subscriber.id}`, "Record reading"],
    ["/operator/tiers", "10A"],
    ["/operator/readings", "Meter stream"],
    ["/operator/billing", "Month close"],
    ["/operator/invoices", "Receivables"],
    [`/operator/invoices/${invoice.id}`, "Record payment"],
    ["/operator/outages", "Load shedding"],
    ["/operator/analytics", "Revenue and risk"],
  ])("renders %s", async (route, text) => {
    renderOperator(route);
    await screen.findByText(text);
  });

  it("submits the primary operator forms", async () => {
    const billing = renderOperator("/operator/billing");
    await screen.findByText("Month close");
    fireEvent.click(screen.getByRole("button", { name: "Run billing" }));
    const summaryLink = await screen.findByRole("link", { name: "2 invoices issued" });
    expect(summaryLink).toHaveAttribute("href", "/operator/invoices?status=ISSUED&periodStart=2026-06-01&periodEnd=2026-06-30");
    await screen.findByText("Rana");
    await screen.findByText("Wael");
    expect(screen.getAllByRole("link", { name: "Open" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "View all 2 invoices" })).toHaveAttribute(
      "href",
      "/operator/invoices?status=ISSUED&periodStart=2026-06-01&periodEnd=2026-06-30",
    );
    billing.unmount();

    const outages = renderOperator("/operator/outages");
    await screen.findByText("Load shedding");
    const dateInputs = outages.container.querySelectorAll<HTMLInputElement>("input[type='datetime-local']");
    fireEvent.change(dateInputs[0]!, { target: { value: "2026-06-18T10:00" } });
    fireEvent.change(dateInputs[1]!, { target: { value: "2026-06-18T11:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule outage" }));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
    outages.unmount();
  });

  it("shows held invoice count after a mixed billing run", async () => {
    renderOperator("/operator/billing", {
      billingResult: {
        issuedCount: 1,
        needsReviewCount: 1,
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        invoices: [{ id: invoice.id, subscriberId: subscriber.id, subscriberName: "Rana", amountUsd: 12, amountLbp: 1080000 }],
      },
    });

    await screen.findByText("Month close");
    fireEvent.click(screen.getByRole("button", { name: "Run billing" }));

    await screen.findByRole("link", { name: "1 invoices issued, 1 need review" });
  });

  it("submits ledger edit forms", async () => {
    const subscribers = renderOperator("/operator/subscribers");
    await screen.findByText("Rana");
    fireEvent.change(screen.getByLabelText("Subscriber name"), { target: { value: "Maya" } });
    fireEvent.change(screen.getByLabelText("Meter ID"), { target: { value: "M-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
    subscribers.unmount();

    const tiers = renderOperator("/operator/tiers");
    await screen.findByText("10A");
    fireEvent.change(screen.getByLabelText("Tier name"), { target: { value: "15A" } });
    fireEvent.click(screen.getByRole("button", { name: "Create tier" }));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
    tiers.unmount();

    const detail = renderOperator(`/operator/subscribers/${subscriber.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "Update subscriber" }));
    fireEvent.change(screen.getByLabelText("kWh"), { target: { value: "55" } });
    fireEvent.click(screen.getByRole("button", { name: "Record reading" }));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
    detail.unmount();

    renderOperator(`/operator/invoices/${invoice.id}`);
    await screen.findByText("Record payment");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
  });

  it("shows review actions and hides payment form for held invoices", async () => {
    const held = { ...invoice, amountUsd: 0, amountLbp: 0, kwhConsumed: 0, status: "NEEDS_REVIEW" };

    renderOperator(`/operator/invoices/${invoice.id}`, { currentInvoice: held, payments: [] });

    await screen.findByText(/record a corrective reading/i);
    expect(screen.queryByText("Record payment")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-issue" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/invoices/22222222-2222-4222-8222-222222222222/reissue"), expect.anything()));
  });

  it("shows and clears a period filter passed via the URL", async () => {
    renderOperator("/operator/invoices?status=ISSUED&periodStart=2026-06-01&periodEnd=2026-06-30");

    await screen.findByText("Receivables");
    await screen.findByText(/Filtered to/);
    expect(screen.getByLabelText("Filter by status")).toHaveValue("ISSUED");
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    await waitFor(() => expect(screen.queryByText(/Filtered to/)).not.toBeInTheDocument());
  });

  it("allows voiding an issued invoice only when it has no payments", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderOperator(`/operator/invoices/${invoice.id}`, { payments: [] });

    await screen.findByText("Record payment");
    fireEvent.click(screen.getByRole("button", { name: "Void invoice" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/invoices/22222222-2222-4222-8222-222222222222/void"), expect.anything()));
  });
});

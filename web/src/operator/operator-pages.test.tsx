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

function installGatewayMock() {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/me")) return Promise.resolve(json({ operatorId: "op", role: "OPERATOR_ADMIN", name: "Admin" }));
    if (init?.method === "POST" || init?.method === "PATCH") return Promise.resolve(json({ issuedCount: 2, ...subscriber, ...tier, ...invoice, ...outage }));
    if (url.includes("/api/subscribers/") && url.includes("/readings")) return Promise.resolve(json(page([{ id: "r1", subscriberId: subscriber.id, kwh: 44, readingAt: new Date().toISOString() }])));
    if (url.includes("/api/subscribers/")) return Promise.resolve(json(subscriber));
    if (url.includes("/api/subscribers")) return Promise.resolve(json(page([subscriber])));
    if (url.includes("/api/tiers")) return Promise.resolve(json([tier]));
    if (url.includes("/api/invoices/") && url.includes("/payments")) return Promise.resolve(json([{ id: "p1", invoiceId: invoice.id, subscriberId: subscriber.id, currency: "USD", tenderedAmount: 5, appliedUsd: 5, appliedLbp: 450000, method: "CASH" }]));
    if (url.includes("/api/invoices/")) return Promise.resolve(json(invoice));
    if (url.includes("/api/invoices")) return Promise.resolve(json(page([invoice])));
    if (url.includes("/api/outages")) return Promise.resolve(json([outage]));
    if (url.includes("/api/analytics/collection-rate")) return Promise.resolve(json([{ periodStart: "2026-06-01", periodEnd: "2026-06-30", issuedUsd: 12, issuedLbp: 1080000, collectedUsd: 6, collectedLbp: 540000, rate: 0.5 }]));
    if (url.includes("/api/analytics/risk")) return Promise.resolve(json(page([{ readingId: "r1", subscriberId: subscriber.id, score: 0.8, reason: "ZERO_DELTA" }])));
    return Promise.resolve(json({}));
  }));
}

function renderOperator(route: string) {
  writeAccessToken("a");
  installMockWebSocket();
  installGatewayMock();
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
    await screen.findByText("2 invoices issued");
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

  it("submits ledger edit forms", async () => {
    const subscribers = renderOperator("/operator/subscribers");
    await screen.findByText("Rana");
    fireEvent.change(screen.getByPlaceholderText("Subscriber name"), { target: { value: "Maya" } });
    fireEvent.change(screen.getByPlaceholderText("Meter ID"), { target: { value: "M-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
    subscribers.unmount();

    const tiers = renderOperator("/operator/tiers");
    await screen.findByText("10A");
    fireEvent.change(screen.getByPlaceholderText("Tier name"), { target: { value: "15A" } });
    fireEvent.click(screen.getByRole("button", { name: "Create tier" }));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
    tiers.unmount();

    const detail = renderOperator(`/operator/subscribers/${subscriber.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "Update subscriber" }));
    fireEvent.change(screen.getByPlaceholderText("kWh"), { target: { value: "55" } });
    fireEvent.click(screen.getByRole("button", { name: "Record reading" }));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
    detail.unmount();

    renderOperator(`/operator/invoices/${invoice.id}`);
    await screen.findByText("Record payment");
    fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
  });
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { AlertsFeed } from "./operator/AnalyticsPage";
import { CurrentBillPage } from "./subscriber/CurrentBillPage";
import { ConsumptionHistoryPage } from "./subscriber/ConsumptionHistoryPage";
import { OutageCountdown } from "./subscriber/OutageCountdown";
import { clearAccessToken, writeAccessToken } from "./lib/tokenStore";
import type { Membership } from "./lib/types";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const unauthorized = () => json({ error: { code: "UNAUTHORIZED", message: "no session" } }, 401);
const emptyPage = () => json({ data: [], meta: { total: 0, page: 1, limit: 10 } });

function renderRoute(route: string, ui = <App />) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}

describe("auth pages", () => {
  beforeEach(() => {
    clearAccessToken();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("logs in directly and redirects to the operator dashboard", async () => {
    let authed = false;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/refresh")) return Promise.resolve(unauthorized());
      if (url.includes("/api/auth/login")) {
        authed = true;
        return Promise.resolve(json({ accessToken: "a", memberships: [{ role: "OPERATOR_ADMIN" }] }));
      }
      if (url.includes("/api/me")) return Promise.resolve(authed ? json({ operatorId: "op", role: "OPERATOR_ADMIN", name: "Admin" }) : unauthorized());
      void init;
      return Promise.resolve(emptyPage());
    }));
    renderRoute("/login");
    await screen.findByRole("button", { name: "Sign in" });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "demo-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByText("Customer ledger")).toBeInTheDocument());
  });

  it("branches to context selection for multi-membership login", async () => {
    const memberships: Membership[] = [{ membershipId: crypto.randomUUID(), operatorId: "op", operatorName: "Hamra", role: "SUBSCRIBER" }];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/refresh")) return Promise.resolve(unauthorized());
      if (url.includes("/api/auth/login")) return Promise.resolve(json({ contextSelectionRequired: true, selectionToken: "s", memberships }));
      return Promise.resolve(emptyPage());
    }));
    renderRoute("/login");
    await screen.findByRole("button", { name: "Sign in" });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "demo-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByText("Choose workspace")).toBeInTheDocument());
  });

  it("selects a context", async () => {
    const memberships: Membership[] = [{ membershipId: crypto.randomUUID(), operatorId: "op", operatorName: "Hamra", role: "SUBSCRIBER" }];
    let authed = false;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/refresh")) return Promise.resolve(unauthorized());
      if (url.includes("/api/auth/select-context")) {
        authed = true;
        return Promise.resolve(json({ accessToken: "a" }));
      }
      if (url.includes("/api/me")) return Promise.resolve(authed ? json({ operatorId: "op", role: "SUBSCRIBER", subscriberId: "sub" }) : unauthorized());
      return Promise.resolve(json({ data: [], meta: { total: 0, page: 1, limit: 5 } }));
    }));
    render(
      <MemoryRouter initialEntries={[{ pathname: "/select-context", state: { selectionToken: "s", memberships } }]}>
        <AuthProvider><App /></AuthProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Current bill")).toBeInTheDocument());
  });
});

describe("dashboard and portal components", () => {
  beforeEach(() => {
    clearAccessToken();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("redirects subscribers away from operator routes", async () => {
    writeAccessToken("a");
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/me")) return Promise.resolve(json({ operatorId: "op", role: "SUBSCRIBER", subscriberId: "sub" }));
      return Promise.resolve(json({ data: [], meta: { total: 0, page: 1, limit: 5 } }));
    }));
    renderRoute("/operator");
    await waitFor(() => expect(screen.getByText("Subscriber")).toBeInTheDocument());
  });

  it("renders live tampering alerts", () => {
    render(<AlertsFeed />);
    act(() => window.dispatchEvent(new CustomEvent("ishtirak:ws", {
      detail: { type: "tampering.alert", data: { subscriberId: "sub", readingId: "read", reason: "ZERO_DELTA", score: 0.81 } },
    })));
    expect(screen.getByText(/ZERO_DELTA/)).toBeInTheDocument();
  });

  it("refreshes current bill when invoice.ready arrives", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ id: "i1", subscriberId: "s", periodStart: "2026-06-01", periodEnd: "2026-06-30", amountUsd: 10, amountLbp: 900000, kwhConsumed: 12, status: "ISSUED" }], meta: { total: 1, page: 1, limit: 5 } }))
      .mockResolvedValueOnce(json({ data: [{ id: "i2", subscriberId: "s", periodStart: "2026-07-01", periodEnd: "2026-07-31", amountUsd: 20, amountLbp: 1800000, kwhConsumed: 18, status: "ISSUED" }], meta: { total: 1, page: 1, limit: 5 } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CurrentBillPage />);
    await screen.findByText(/900,000 LBP/);
    act(() => window.dispatchEvent(new CustomEvent("ishtirak:ws", { detail: { type: "invoice.ready", data: { invoiceId: "i2" } } })));
    await screen.findByText(/1,800,000 LBP/);
  });

  it("refreshes current bill when invoice.updated arrives", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ id: "i1", subscriberId: "s", periodStart: "2026-06-01", periodEnd: "2026-06-30", amountUsd: 10, amountLbp: 900000, kwhConsumed: 12, status: "ISSUED" }], meta: { total: 1, page: 1, limit: 5 } }))
      .mockResolvedValueOnce(json({ data: [
        { id: "i2", subscriberId: "s", periodStart: "2026-07-01", periodEnd: "2026-07-31", amountUsd: 0, amountLbp: 0, kwhConsumed: 0, status: "VOID" },
        { id: "i1", subscriberId: "s", periodStart: "2026-06-01", periodEnd: "2026-06-30", amountUsd: 10, amountLbp: 900000, kwhConsumed: 12, status: "ISSUED" },
      ], meta: { total: 2, page: 1, limit: 5 } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CurrentBillPage />);
    await screen.findByText(/900,000 LBP/);
    act(() => window.dispatchEvent(new CustomEvent("ishtirak:ws", { detail: { type: "invoice.updated", data: { invoiceId: "i2", status: "VOID" } } })));
    await screen.findByText("Voided");
    expect(screen.getByTestId("current-bill")).toHaveTextContent("31 Jul 2026");
  });

  it.each([
    ["NEEDS_REVIEW", "Under review"],
    ["VOID", "Voided"],
  ])("renders %s current bill as a status", async (status, label) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      data: [{
        id: "i1",
        subscriberId: "s",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        amountUsd: 0,
        amountLbp: 0,
        kwhConsumed: 0,
        status,
      }],
      meta: { total: 1, page: 1, limit: 5 },
    })));

    render(<CurrentBillPage />);

    await screen.findByText(label);
    expect(screen.queryByText(/\$0.00/)).not.toBeInTheDocument();
  });

  it("renders an outage countdown snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json([{ id: "o", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 5000).toISOString(), reason: "FUEL" }])));
    render(<OutageCountdown />);
    await waitFor(() => expect(screen.getByText("Countdown")).toBeInTheDocument());
    expect(screen.getAllByText(/:/).length).toBeGreaterThan(0);
  });

  it("renders subscriber consumption history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: [{ id: "r", subscriberId: "s", kwh: 42, readingAt: new Date().toISOString() }], meta: { total: 1, page: 1, limit: 10 } })));
    render(<ConsumptionHistoryPage />);
    await screen.findByText("42");
  });
});

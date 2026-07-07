import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { App } from "../App";
import { AuthProvider } from "../auth/AuthContext";
import { clearAccessToken, writeAccessToken } from "../lib/tokenStore";
import { installMockWebSocket } from "../test/testUtils";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const tier = { id: "t1", name: "10A", amperage: 10, effectiveTariffPolicy: "HYBRID", standingFeeUsd: 0, standingFeeLbp: 0, perKwhRateUsd: 0, perKwhRateLbp: 0, status: "ACTIVE" };

describe("operator form error handling", () => {
  beforeEach(() => {
    clearAccessToken();
    vi.restoreAllMocks();
  });

  it("surfaces a gateway error when creating a subscriber fails", async () => {
    writeAccessToken("a");
    installMockWebSocket();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/me")) return Promise.resolve(json({ operatorId: "op", role: "OPERATOR_ADMIN", name: "Admin" }));
      if (url.includes("/api/tiers")) return Promise.resolve(json({ data: [tier], meta: { total: 1, page: 1, limit: 100 } }));
      if (url.includes("/api/subscribers") && init?.method === "POST") {
        return Promise.resolve(json({ error: { code: "CONFLICT", message: "Meter already in use" } }, 409));
      }
      return Promise.resolve(json({ data: [], meta: { total: 0, page: 1, limit: 10 } }));
    }));
    render(
      <MemoryRouter initialEntries={["/operator/subscribers"]}>
        <AuthProvider><App /></AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByText("Customer ledger");
    fireEvent.change(screen.getByLabelText("Subscriber name"), { target: { value: "Maya" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: tier.id } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("Meter already in use");
  });
});

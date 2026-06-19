import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { App } from "../App";
import { AuthProvider } from "./AuthContext";
import { SESSION_EXPIRED_EVENT } from "../lib/apiClient";
import { clearAccessToken, writeAccessToken } from "../lib/tokenStore";
import { installMockWebSocket } from "../test/testUtils";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const operator = { operatorId: "op", role: "OPERATOR_ADMIN", name: "Admin" };

function mountOperator() {
  writeAccessToken("a");
  installMockWebSocket();
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/auth/logout")) return Promise.resolve(new Response(null, { status: 204 }));
    if (url.includes("/api/me")) return Promise.resolve(json(operator));
    if (url.includes("/api/tiers")) return Promise.resolve(json([]));
    return Promise.resolve(json({ data: [], meta: { total: 0, page: 1, limit: 10 } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <MemoryRouter initialEntries={["/operator/subscribers"]}>
      <AuthProvider><App /></AuthProvider>
    </MemoryRouter>,
  );
  return fetchMock;
}

describe("auth session lifecycle", () => {
  beforeEach(() => {
    clearAccessToken();
    vi.restoreAllMocks();
  });

  it("logs out via the gateway and returns to the login screen", async () => {
    const fetchMock = mountOperator();
    await screen.findByText("Customer ledger");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("button", { name: "Sign in" });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/auth/logout"))).toBe(true);
  });

  it("resets to the login screen on a session-expired signal", async () => {
    mountOperator();
    await screen.findByText("Customer ledger");
    act(() => window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT)));
    await screen.findByRole("button", { name: "Sign in" });
  });
});

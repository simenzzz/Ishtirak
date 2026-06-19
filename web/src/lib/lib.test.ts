import { apiRequest, ApiError, asPage, SESSION_EXPIRED_EVENT } from "./apiClient";
import { wsUrlFromApi } from "./config";
import { formatDual, secondsToClock } from "./format";
import { clearAccessToken, readAccessToken, writeAccessToken } from "./tokenStore";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("api client", () => {
  beforeEach(() => {
    clearAccessToken();
    vi.restoreAllMocks();
  });

  it("refreshes via the cookie on 401 and retries once", async () => {
    writeAccessToken("old");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: "UNAUTHORIZED", message: "expired" } }, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "new" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiRequest<{ ok: boolean }>("/resource")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The refresh call carries the cookie and no body.
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "POST", credentials: "include" });
    expect(readAccessToken()).toBe("new");
  });

  it("signals session expiry when the refresh fails", async () => {
    writeAccessToken("old");
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(jsonResponse({ error: { code: "UNAUTHORIZED", message: "expired" } }, 401))
        .mockResolvedValueOnce(jsonResponse({ error: { code: "UNAUTHORIZED", message: "no cookie" } }, 401)),
    );
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    await expect(apiRequest("/resource")).rejects.toBeInstanceOf(ApiError);
    window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
    expect(expired).toHaveBeenCalledOnce();
    expect(readAccessToken()).toBeNull();
  });

  it("tolerates a non-JSON error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 })));
    await expect(apiRequest("/resource", { auth: false })).rejects.toMatchObject({ status: 502, code: "HTTP_ERROR" });
  });

  it("throws gateway error envelopes including rate limits", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { code: "RATE_LIMITED", message: "Too many" } }, 429)));
    await expect(apiRequest("/limited", { auth: false })).rejects.toMatchObject(new ApiError(429, "RATE_LIMITED", "Too many"));
  });

  it("normalizes bare arrays and ignores malformed pagination meta", () => {
    expect(asPage<number>([1, 2], 2, 10)).toEqual({ data: [1, 2], meta: { total: 2, page: 2, limit: 10 } });
    expect(asPage<number>({ data: [9], meta: { total: "x" } }, 1, 5)).toEqual({ data: [9], meta: { total: 1, page: 1, limit: 5 } });
  });
});

describe("format, config, and token helpers", () => {
  it("formats money, countdowns, ws urls, and keeps the access token out of storage", () => {
    expect(writeAccessToken("a")).toBe("a");
    expect(readAccessToken()).toBe("a");
    expect(localStorage.getItem("ishtirak.tokens")).toBeNull();
    expect(formatDual(12.5, 900000)).toContain("$12.50");
    expect(secondsToClock(3661)).toBe("01:01:01");
    expect(wsUrlFromApi("https://localhost:8080")).toBe("wss://localhost:8080/api/ws");
    clearAccessToken();
    expect(readAccessToken()).toBeNull();
  });
});

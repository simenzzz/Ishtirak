import { describe, expect, it, vi } from "vitest";

import { clearRefreshCookie, readRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from "./cookies.js";

const config = { COOKIE_SECURE: true, REFRESH_COOKIE_MAX_AGE_SECS: 2592000 };

describe("refresh cookie helpers", () => {
  it("sets an HttpOnly, SameSite=Strict, path-scoped cookie", () => {
    const cookie = vi.fn();
    setRefreshCookie({ cookie } as never, "rt-123", config);
    expect(cookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, "rt-123", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/api/auth",
      maxAge: 2592000 * 1000,
    });
  });

  it("clears the cookie with matching attributes", () => {
    const clearCookie = vi.fn();
    clearRefreshCookie({ clearCookie } as never, config);
    expect(clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/api/auth",
    });
  });

  it("reads the refresh token from the cookie header", () => {
    const req = { headers: { cookie: `other=1; ${REFRESH_COOKIE_NAME}=rt-abc; x=2` } };
    expect(readRefreshCookie(req as never)).toBe("rt-abc");
  });

  it("url-decodes cookie values", () => {
    const req = { headers: { cookie: `${REFRESH_COOKIE_NAME}=a%2Bb` } };
    expect(readRefreshCookie(req as never)).toBe("a+b");
  });

  it("returns null when the cookie is absent or empty", () => {
    expect(readRefreshCookie({ headers: {} } as never)).toBeNull();
    expect(readRefreshCookie({ headers: { cookie: "other=1" } } as never)).toBeNull();
    expect(readRefreshCookie({ headers: { cookie: `${REFRESH_COOKIE_NAME}=` } } as never)).toBeNull();
  });
});

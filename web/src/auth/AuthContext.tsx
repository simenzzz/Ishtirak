import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { apiRequest, refreshSession, SESSION_EXPIRED_EVENT } from "../lib/apiClient";
import { clearAccessToken, readAccessToken, writeAccessToken } from "../lib/tokenStore";
import type { AuthTokens, Identity, LoginResult } from "../lib/types";

type AuthValue = Readonly<{
  identity: Identity | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  selectContext: (selectionToken: string, membershipId: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}>;

export const AuthContext = createContext<AuthValue | null>(null);

function hasAccessToken(value: unknown): value is AuthTokens {
  return typeof (value as Partial<AuthTokens>).accessToken === "string";
}

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  // Always attempt to bootstrap the session from the refresh cookie on load.
  const [loading, setLoading] = useState(true);

  const resetSession = useCallback(() => {
    clearAccessToken();
    setIdentity(null);
  }, []);

  const refreshMe = useCallback(async () => {
    setLoading(true);
    try {
      // Mint an access token from the refresh cookie when we don't hold one yet
      // (e.g. a cold load after reload). No cookie => logged out, no `/me` call.
      const token = readAccessToken() ?? (await refreshSession());
      if (!token) {
        resetSession();
        return;
      }
      setIdentity(await apiRequest<Identity>("/me"));
    } catch {
      resetSession();
    } finally {
      setLoading(false);
    }
  }, [resetSession]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  // A terminal refresh failure anywhere clears the React session too.
  useEffect(() => {
    const onExpired = () => resetSession();
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [resetSession]);

  const logout = useCallback(async () => {
    try {
      await apiRequest<void>("/auth/logout", { method: "POST", auth: false });
    } catch {
      // Cookie clearing is best-effort; always reset local state.
    }
    resetSession();
  }, [resetSession]);

  const acceptToken = useCallback(
    async (accessToken: string) => {
      writeAccessToken(accessToken);
      await refreshMe();
    },
    [refreshMe],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await apiRequest<LoginResult>("/auth/login", {
        method: "POST",
        auth: false,
        body: { email, password },
      });
      if (!result.contextSelectionRequired && hasAccessToken(result)) await acceptToken(result.accessToken);
      return result;
    },
    [acceptToken],
  );

  const selectContext = useCallback(
    async (selectionToken: string, membershipId: string) => {
      const next = await apiRequest<AuthTokens>("/auth/select-context", {
        method: "POST",
        auth: false,
        body: { selectionToken, membershipId },
      });
      await acceptToken(next.accessToken);
    },
    [acceptToken],
  );

  const value = useMemo(
    () => ({ identity, loading, login, selectContext, logout, refreshMe }),
    [identity, loading, login, selectContext, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

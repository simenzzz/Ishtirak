import { apiBaseUrl } from "./config";
import { clearAccessToken, readAccessToken, writeAccessToken } from "./tokenStore";
import type { ApiErrorBody, Paginated } from "./types";

type Method = "GET" | "POST" | "PATCH";
type RequestOptions = Readonly<{
  method?: Method;
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
}>;

/** Dispatched when an active session can no longer be refreshed (terminal 401). */
export const SESSION_EXPIRED_EVENT = "ishtirak:session-expired";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorBody["error"]["details"] = [],
  ) {
    super(message);
  }
}

let refreshInFlight: Promise<string | null> | null = null;

function isErrorEnvelope(value: unknown): value is ApiErrorBody {
  const maybe = value as ApiErrorBody;
  return typeof maybe?.error?.code === "string" && typeof maybe.error.message === "string";
}

function pathUrl(path: string) {
  const normalized = path.startsWith("/api") ? path : `/api${path.startsWith("/") ? path : `/${path}`}`;
  return `${apiBaseUrl()}${normalized}`;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Non-JSON body (proxy/HTML error page); let the status drive the error.
    return null;
  }
}

async function doRefresh(): Promise<string | null> {
  // Authenticated solely by the HttpOnly refresh cookie; no body is sent.
  const response = await fetch(pathUrl("/auth/refresh"), { method: "POST", credentials: "include" });
  if (!response.ok) return clearAccessToken();
  const body = (await parseResponse(response)) as { accessToken?: unknown } | null;
  if (!body || typeof body.accessToken !== "string") return clearAccessToken();
  return writeAccessToken(body.accessToken);
}

/**
 * Refresh the access token via the cookie, de-duplicating concurrent attempts.
 * Returns the new token, or null when no valid session exists. Does not signal
 * session-expiry — boot-time failures are a normal "logged out" state.
 */
export function refreshSession(): Promise<string | null> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

function notifySessionExpired(): void {
  clearAccessToken();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
}

async function requestOnce<T>(path: string, options: RequestOptions, token: string | null): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.auth !== false && token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(pathUrl(path), {
    method: options.method ?? "GET",
    headers,
    credentials: "include",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await parseResponse(response);
  if (!response.ok) {
    if (isErrorEnvelope(body)) {
      throw new ApiError(response.status, body.error.code, body.error.message, body.error.details ?? []);
    }
    throw new ApiError(response.status, "HTTP_ERROR", `Request failed with status ${response.status}`);
  }
  return body as T;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await requestOnce<T>(path, options, readAccessToken());
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && options.auth !== false) {
      const refreshed = await refreshSession();
      if (refreshed) return requestOnce<T>(path, options, refreshed);
      // An in-flight, authenticated request lost its session for good.
      notifySessionExpired();
    }
    throw error;
  }
}

export function asArray<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

function isValidMeta(meta: unknown): meta is Paginated<unknown>["meta"] {
  const maybe = meta as Partial<Paginated<unknown>["meta"]>;
  return typeof maybe?.total === "number" && typeof maybe.page === "number" && typeof maybe.limit === "number";
}

export function asPage<T>(value: unknown, page: number, limit: number): Paginated<T> {
  const maybe = value as Partial<Paginated<T>>;
  if (Array.isArray(maybe.data) && isValidMeta(maybe.meta)) return maybe as Paginated<T>;
  const data = asArray<T>(Array.isArray(maybe.data) ? maybe.data : value);
  return Object.freeze({ data, meta: { total: data.length, page, limit } });
}

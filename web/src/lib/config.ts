const DEFAULT_API_URL = "http://localhost:8080";

// Browsers treat loopback origins as a secure context, so plain HTTP to these
// hosts is safe even from a production build (this is what the local E2E stack
// uses: a prod Vite build talking to http://localhost:8080). Match on the exact
// URL.hostname — note `new URL("http://[::1]").hostname` is the bracketed form.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function apiBaseUrl() {
  const raw = import.meta.env.VITE_API_URL ?? DEFAULT_API_URL;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("VITE_API_URL must be a non-empty URL");
  }
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("VITE_API_URL must use http or https");
  }
  // Production must use TLS so the bearer token and refresh cookie are never
  // sent over plaintext. Plain HTTP is allowed only in development or for
  // loopback hosts (a secure context the local E2E stack relies on).
  if (import.meta.env.PROD && parsed.protocol !== "https:" && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error("VITE_API_URL must use https in production");
  }
  return trimSlash(parsed.toString());
}

export function wsUrlFromApi(apiUrl = apiBaseUrl()) {
  const parsed = new URL(apiUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/api/ws";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

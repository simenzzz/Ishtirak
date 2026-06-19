const DEFAULT_API_URL = "http://localhost:8080";

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
  // sent over plaintext. Plain HTTP is allowed only in development.
  if (import.meta.env.PROD && parsed.protocol !== "https:") {
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

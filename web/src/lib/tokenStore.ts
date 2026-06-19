/**
 * Access-token store. The short-lived access token is kept in memory only — it
 * is never persisted, so an XSS foothold cannot read it from storage and a hard
 * reload simply re-mints it via the HttpOnly refresh cookie. The refresh token
 * never reaches the browser (it lives in the gateway-set cookie).
 */
let accessToken: string | null = null;

export function readAccessToken(): string | null {
  return accessToken;
}

export function writeAccessToken(token: string): string {
  accessToken = token;
  return token;
}

export function clearAccessToken(): null {
  accessToken = null;
  return null;
}

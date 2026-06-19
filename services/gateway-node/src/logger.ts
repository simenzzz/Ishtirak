import pino from "pino";

/** Structured logger shared across the gateway. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    "req.body.password",
    "req.body.refreshToken",
    "req.body.selectionToken",
  ],
});

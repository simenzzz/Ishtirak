import pino from "pino";

/** Structured logger shared across the gateway. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "req.headers.cookie"],
});

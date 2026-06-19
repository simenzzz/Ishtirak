import { z } from "zod";

/**
 * Environment schema. Validated once at startup so a misconfigured container
 * fails fast and loudly rather than at first request.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  CORE_JAVA_URL: z.string().url(),
  ANALYTICS_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  GATEWAY_SERVICE_TOKEN_SECRET: z
    .string()
    .min(32, "GATEWAY_SERVICE_TOKEN_SECRET must be at least 32 characters"),
  GATEWAY_ANALYTICS_SERVICE_TOKEN_SECRET: z
    .string()
    .min(32, "GATEWAY_ANALYTICS_SERVICE_TOKEN_SECRET must be at least 32 characters"),
  SERVICE_TOKEN_TTL_SECS: z.coerce.number().int().positive().default(300),
  // Browser origin allowed to make credentialed (cookie-bearing) requests.
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  // Emit the refresh cookie with the Secure attribute. Defaults to true; set
  // "false" only for a plain-HTTP local setup that is not localhost.
  // (z.coerce.boolean treats any non-empty string as true, so parse explicitly.)
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  // Refresh-cookie lifetime; mirrors core-java's 30-day refresh token TTL.
  REFRESH_COOKIE_MAX_AGE_SECS: z.coerce.number().int().positive().default(2592000),
});

export type Config = Readonly<z.infer<typeof envSchema>>;

/**
 * Parse and freeze configuration from a record (defaults to process.env).
 * Throws a ZodError with field-level detail when invalid.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  return Object.freeze(envSchema.parse(source));
}

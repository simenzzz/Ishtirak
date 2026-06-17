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
});

export type Config = Readonly<z.infer<typeof envSchema>>;

/**
 * Parse and freeze configuration from a record (defaults to process.env).
 * Throws a ZodError with field-level detail when invalid.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  return Object.freeze(envSchema.parse(source));
}

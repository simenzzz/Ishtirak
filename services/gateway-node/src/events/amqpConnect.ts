import amqp from "amqplib";

import { logger } from "../logger.js";

/** The connection type amqplib's `connect` resolves to, whatever its name. */
type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;

export type ConnectFn = (url: string) => Promise<AmqpConnection>;
export type SleepFn = (ms: number) => Promise<void>;

export type RetryOptions = Readonly<{
  maxAttempts: number;
  retryDelayMs: number;
}>;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Open an AMQP connection, retrying transient failures with a fixed backoff.
 *
 * RabbitMQ reports "healthy" a few seconds before its 5672 listener accepts
 * connections, so a one-shot connect at boot can hit `ECONNREFUSED` and kill the
 * process. Retrying a bounded number of times bridges that gap. `connect` and
 * `sleep` are injectable so the retry logic is unit-testable without a broker.
 */
export async function connectWithRetry(
  url: string,
  options: RetryOptions,
  deps: { connect?: ConnectFn; sleep?: SleepFn } = {},
): Promise<AmqpConnection> {
  const connect = deps.connect ?? (amqp.connect as ConnectFn);
  const sleep = deps.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await connect(url);
    } catch (error) {
      // Retry on any error: at boot the only expected failure is the broker not yet
      // accepting connections, and a genuinely fatal misconfig (bad URL/credentials)
      // still surfaces after the attempts are exhausted — the process restarts either way.
      lastError = error;
      if (attempt >= options.maxAttempts) {
        break;
      }
      logger.warn(
        { err: error, attempt, maxAttempts: options.maxAttempts },
        "rabbitmq connect failed; retrying",
      );
      await sleep(options.retryDelayMs);
    }
  }

  logger.error({ err: lastError, attempts: options.maxAttempts }, "rabbitmq connect exhausted retries");
  throw lastError;
}

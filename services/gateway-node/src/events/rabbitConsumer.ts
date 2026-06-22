import amqp from "amqplib";

import { type Config } from "../config.js";
import { logger } from "../logger.js";
import { connectWithRetry } from "./amqpConnect.js";
import { mapEventToFanout, parseGatewayEvent } from "./envelope.js";
import { type RedisFanoutRuntime } from "./redisFanout.js";

const exchange = "ishtirak.events";
const queue = "gateway.ws-fanout";
// Per-service dead-letter exchange + queue. Poison messages and transient failures
// that survive one retry land here instead of being silently dropped or requeued in
// a hot loop. Named per-service so the gateway's dead-letters never mix with another
// consumer's.
const deadLetterExchange = "gateway.ws-fanout.dlx";
const deadLetterQueue = "gateway.ws-fanout.dlq";
const routingKeys = ["outage.scheduled", "invoice.issued", "invoice.status.changed", "reading.flagged"] as const;

export type RabbitRuntime = Readonly<{
  close(): Promise<void>;
  isReady(): boolean;
}>;

/** Minimal channel surface the message handler needs — keeps it unit-testable. */
type AckChannel = Readonly<{
  ack(message: amqp.Message): void;
  nack(message: amqp.Message, allUpTo: boolean, requeue: boolean): void;
}>;

/**
 * Decide the fate of a consumed event:
 * - invalid/poison payload → dead-letter immediately (it will never parse).
 * - transient fanout failure → requeue once, then dead-letter on redelivery.
 * - success → ack.
 */
export async function handleGatewayMessage(
  channel: AckChannel,
  message: amqp.Message,
  redisFanout: RedisFanoutRuntime,
): Promise<void> {
  const event = parseGatewayEvent(message.content);
  if (!event) {
    logger.error("dropping invalid gateway event to dead-letter queue");
    channel.nack(message, false, false);
    return;
  }
  try {
    await redisFanout.publish(mapEventToFanout(event));
    channel.ack(message);
  } catch (error) {
    if (message.fields.redelivered) {
      logger.error({ err: error }, "gateway fanout publish failed after retry; dead-lettering");
      channel.nack(message, false, false);
    } else {
      logger.warn({ err: error }, "gateway fanout publish failed; requeueing once");
      channel.nack(message, false, true);
    }
  }
}

export async function startRabbitConsumer(config: Config, redisFanout: RedisFanoutRuntime): Promise<RabbitRuntime> {
  const connection = await connectWithRetry(config.RABBITMQ_URL, {
    maxAttempts: config.RABBITMQ_CONNECT_MAX_ATTEMPTS,
    retryDelayMs: config.RABBITMQ_CONNECT_RETRY_DELAY_MS,
  });
  const channel = await connection.createChannel();
  let ready = true;
  const markClosed = () => {
    ready = false;
  };
  connection.on("close", markClosed);
  connection.on("error", markClosed);
  channel.on("close", markClosed);
  channel.on("error", markClosed);
  await channel.assertExchange(exchange, "topic", { durable: true });
  await channel.assertExchange(deadLetterExchange, "fanout", { durable: true });
  // Bound the sink so a flood of poison/failed messages can't grow unbounded on the
  // broker; oldest entries are dropped once the cap is hit.
  await channel.assertQueue(deadLetterQueue, { durable: true, arguments: { "x-max-length": 10000 } });
  await channel.bindQueue(deadLetterQueue, deadLetterExchange, "");
  await channel.assertQueue(queue, { durable: true, arguments: { "x-dead-letter-exchange": deadLetterExchange } });
  await Promise.all(routingKeys.map((key) => channel.bindQueue(queue, exchange, key)));
  await channel.consume(queue, async (message) => {
    if (!message) {
      return;
    }
    await handleGatewayMessage(channel, message, redisFanout);
  });
  return Object.freeze({
    close: async () => {
      ready = false;
      await channel.close();
      await connection.close();
    },
    isReady: () => ready,
  });
}

import amqp from "amqplib";

import { type Config } from "../config.js";
import { logger } from "../logger.js";
import { mapEventToFanout, parseGatewayEvent } from "./envelope.js";
import { type RedisFanoutRuntime } from "./redisFanout.js";

const exchange = "ishtirak.events";
const queue = "gateway.ws-fanout";
const routingKeys = ["outage.scheduled", "invoice.issued", "reading.flagged"] as const;

export type RabbitRuntime = Readonly<{
  close(): Promise<void>;
  isReady(): boolean;
}>;

export async function startRabbitConsumer(config: Config, redisFanout: RedisFanoutRuntime): Promise<RabbitRuntime> {
  const connection = await amqp.connect(config.RABBITMQ_URL);
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
  await channel.assertQueue(queue, { durable: true });
  await Promise.all(routingKeys.map((key) => channel.bindQueue(queue, exchange, key)));
  await channel.consume(queue, async (message) => {
    if (!message) {
      return;
    }
    const event = parseGatewayEvent(message.content);
    if (!event) {
      logger.error("dropping invalid gateway event");
      channel.ack(message);
      return;
    }
    try {
      await redisFanout.publish(mapEventToFanout(event));
      channel.ack(message);
    } catch (error) {
      logger.error({ err: error }, "gateway fanout publish failed");
      channel.nack(message, false, true);
    }
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

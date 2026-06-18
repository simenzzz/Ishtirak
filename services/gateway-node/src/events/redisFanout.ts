import { type Redis } from "ioredis";
import { z } from "zod";

import { fanout, type FanoutEnvelope } from "../ws/fanout.js";
import { type GatewayWsServer } from "../ws/wsServer.js";
import { logger } from "../logger.js";

const fanoutEnvelopeSchema = z.object({
  operatorId: z.string().uuid(),
  audience: z.object({
    kind: z.enum(["operator", "subscriber"]),
    channel: z.string(),
    subscriberId: z.string().uuid().optional(),
  }),
  message: z.object({ type: z.string(), ts: z.string().optional() }).passthrough(),
});

export const WS_FANOUT_CHANNEL = "ws:fanout";

export type RedisFanoutRuntime = Readonly<{
  publish(envelope: FanoutEnvelope): Promise<void>;
  close(): Promise<void>;
  isReady(): boolean;
}>;

export function startRedisFanout(publisher: Redis, subscriber: Redis, ws: GatewayWsServer): RedisFanoutRuntime {
  let ready = false;
  subscriber.on("ready", () => {
    ready = true;
  });
  subscriber.on("end", () => {
    ready = false;
  });
  subscriber.on("message", (_channel, raw) => {
    try {
      const parsed = fanoutEnvelopeSchema.safeParse(JSON.parse(raw) as unknown);
      if (!parsed.success) {
        logger.warn({ err: parsed.error }, "invalid redis fanout envelope; dropping");
        return;
      }
      fanout(ws.registry(), parsed.data as FanoutEnvelope);
    } catch (error) {
      logger.error({ err: error }, "unparseable redis fanout message; dropping");
    }
  });
  void subscriber.subscribe(WS_FANOUT_CHANNEL).then(() => {
    ready = true;
  });

  return Object.freeze({
    publish: async (envelope) => {
      await publisher.publish(WS_FANOUT_CHANNEL, JSON.stringify(envelope));
    },
    close: async () => {
      await subscriber.quit();
      await publisher.quit();
    },
    isReady: () => ready,
  });
}

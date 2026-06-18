import { createServer } from "node:http";

import { Redis } from "ioredis";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { startRabbitConsumer, type RabbitRuntime } from "./events/rabbitConsumer.js";
import { startRedisFanout, type RedisFanoutRuntime } from "./events/redisFanout.js";
import { logger } from "./logger.js";
import { attachWsServer, type GatewayWsServer } from "./ws/wsServer.js";

class RuntimeProbe {
  constructor(
    private readonly redisFanout: () => RedisFanoutRuntime | null,
    private readonly rabbit: () => RabbitRuntime | null,
    private readonly rateRedis: Redis,
  ) {}

  isReady(): boolean {
    return Boolean(this.redisFanout()?.isReady() && this.rabbit()?.isReady() && this.rateRedis.status === "ready");
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  let redisFanout: RedisFanoutRuntime | null = null;
  let rabbit: RabbitRuntime | null = null;
  let ws: GatewayWsServer | null = null;
  const rateRedis = new Redis(config.REDIS_URL);
  const app = createApp({
    config,
    redis: rateRedis,
    probe: new RuntimeProbe(
      () => redisFanout,
      () => rabbit,
      rateRedis,
    ),
  });
  const server = createServer(app);

  ws = attachWsServer(server, config);
  redisFanout = startRedisFanout(new Redis(config.REDIS_URL), new Redis(config.REDIS_URL), ws);
  rabbit = await startRabbitConsumer(config, redisFanout);

  server.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, "gateway listening");
  });

  const shutdown = async (): Promise<void> => {
    logger.info("gateway shutdown requested");
    server.close();
    await Promise.allSettled([rabbit?.close(), redisFanout?.close(), ws?.close(), rateRedis.quit()]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  logger.error({ err: error }, "gateway failed to start");
  process.exit(1);
});

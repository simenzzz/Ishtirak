import { createServer } from "node:http";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";

function main(): void {
  const config = loadConfig();
  const app = createApp();
  const server = createServer(app);

  // Phase 4 attaches the WebSocket server and RabbitMQ consumer to `server`.

  server.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, "gateway listening");
  });
}

main();

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "**/*.test.ts",
        "vitest.config.ts",
        "eslint.config.js",
        "dist/**",
        "src/server.ts",
        "src/events/rabbitConsumer.ts",
        "src/events/redisFanout.ts",
        "src/ws/wsServer.ts",
        "src/proxy/authRoutes.ts",
        "src/proxy/coreRoutes.ts",
        "src/proxy/analyticsRoutes.ts",
        "src/proxy/meRoute.ts",
      ],
    },
  },
});

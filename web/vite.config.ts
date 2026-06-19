import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, port: 3000 },
  preview: { host: true, port: 3000 },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Unit/component tests live under src/. Playwright E2E specs live under e2e/
    // and must not be collected by Vitest (they run against a live stack instead).
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
      exclude: ["dist/**", "vite.config.ts", "src/main.tsx", "src/test/**", "src/**/*.d.ts", "src/lib/types.ts"],
    },
  },
});

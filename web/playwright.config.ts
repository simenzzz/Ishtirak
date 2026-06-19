import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the three showcase flows. These run against the full
 * docker-compose stack (web + gateway + core-java + analytics + infra) seeded
 * with the `dev` profile demo users — not against mocks. Bring the stack up
 * first (see e2e/README.md), then `npm run test:e2e`.
 *
 * The flows are cross-user and rely on real-time WebSocket pushes, so we run a
 * single worker (no parallelism) to keep broker/Redis fan-out deterministic.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

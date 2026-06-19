import { type Page, expect } from "@playwright/test";

/**
 * Demo credentials seeded by core-java's `dev` profile (see DemoSeedData.java).
 * The password comes from DEMO_PASSWORD — the same value passed to the stack.
 */
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "ishtirak-demo-password";

export const USERS = {
  admin: "admin@ishtirak.local",
  staff: "staff@ishtirak.local",
  subscriber: "subscriber@ishtirak.local",
} as const;

/** Seeded subscriber linked to subscriber@ishtirak.local (DemoSeedData.SUBSCRIBER_ID). */
export const SEEDED_SUBSCRIBER_ID = "30000000-0000-0000-0000-000000000001";

/** Log in through the real login form and wait for the post-login landing route. */
export async function login(page: Page, email: string, landingPath: RegExp): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(landingPath);
}

/** Record a meter reading for a subscriber via the operator Readings form. */
export async function recordReading(page: Page, subscriberId: string, kwh: number): Promise<void> {
  await page.goto("/operator/readings");
  await page.getByPlaceholder("Subscriber ID").fill(subscriberId);
  await page.getByPlaceholder("kWh").fill(String(kwh));
  await page.getByRole("button", { name: /record reading/i }).click();
}

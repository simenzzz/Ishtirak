import { expect, test } from "@playwright/test";

import { USERS, login } from "./helpers";

/** datetime-local value (YYYY-MM-DDTHH:MM) `minutesFromNow` in the future. */
function localDateTime(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString().slice(0, 16);
}

/**
 * Showcase flow 3 — Load-shedding countdown.
 * The operator schedules an outage; the subscriber, on the outage page, receives
 * the `outage.countdown` push and sees a live ticking countdown.
 */
test("a scheduled outage drives a live countdown in the subscriber portal", async ({ browser }) => {
  const operatorCtx = await browser.newContext();
  const subscriberCtx = await browser.newContext();
  const operator = await operatorCtx.newPage();
  const subscriber = await subscriberCtx.newPage();

  // Subscriber waits on the outage page with a live WebSocket connection.
  await login(subscriber, USERS.subscriber, /\/portal/);
  await subscriber.goto("/portal/outage");
  await expect(subscriber.getByText(/live updates connected/i)).toBeVisible();

  // Operator schedules an outage starting shortly and ending in two hours.
  await login(operator, USERS.admin, /\/operator/);
  await operator.goto("/operator/outages");
  await operator.locator('input[type="datetime-local"]').first().fill(localDateTime(1));
  await operator.locator('input[type="datetime-local"]').nth(1).fill(localDateTime(120));
  await operator.getByRole("button", { name: /schedule outage/i }).click();

  // The outage.countdown push seeds the portal and a clock renders + ticks.
  const countdown = subscriber.getByTestId("outage-countdown");
  await expect(countdown).toBeVisible();
  await expect(countdown).toContainText(/\d+:\d{2}/);

  await operatorCtx.close();
  await subscriberCtx.close();
});

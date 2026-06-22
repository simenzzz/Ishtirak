import { expect, test } from "@playwright/test";

import { SEEDED_SUBSCRIBER_ID, USERS, login, recordReading } from "./helpers";

/**
 * Showcase flow 1 — Billing run.
 * Operator records readings and runs billing; the subscriber, sitting on the bill
 * page, receives the `invoice.ready` WebSocket push and sees the new bill appear.
 *
 * Ordering note: specs share the seeded subscriber and run serially (workers: 1).
 * This spec must run before any that record a meter rollback (e.g. tampering's
 * 500→50) so billing's period-end reading isn't a lower value, which billing
 * rejects as a negative consumption delta. The filename sorts first; keep it so.
 */
test("operator billing run pushes a live bill to the subscriber", async ({ browser }) => {
  const operatorCtx = await browser.newContext();
  const subscriberCtx = await browser.newContext();
  const operator = await operatorCtx.newPage();
  const subscriber = await subscriberCtx.newPage();

  // Subscriber waits on the bill page with a live WebSocket connection.
  await login(subscriber, USERS.subscriber, /\/portal/);
  await subscriber.goto("/portal/bill");
  await expect(subscriber.getByText(/live updates connected/i)).toBeVisible();

  // Operator records two readings so the period has a positive consumption delta.
  await login(operator, USERS.admin, /\/operator/);
  await recordReading(operator, SEEDED_SUBSCRIBER_ID, 100);
  await recordReading(operator, SEEDED_SUBSCRIBER_ID, 125);

  // Operator runs billing for the default (current) period.
  await operator.goto("/operator/billing");
  await operator.getByRole("button", { name: /run billing/i }).click();
  await expect(operator.getByText(/invoices issued/i)).toBeVisible();

  // Analytics collection-rate view renders from the gateway analytics endpoint.
  await operator.goto("/operator/analytics");
  await expect(operator.getByRole("heading", { name: /analytics/i })).toBeVisible();

  // The bill-ready push refetches /me/invoices and the latest bill appears.
  await expect(subscriber.getByTestId("current-bill")).toBeVisible();

  await operatorCtx.close();
  await subscriberCtx.close();
});

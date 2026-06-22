import { expect, test } from "@playwright/test";

import { SEEDED_SUBSCRIBER_ID, USERS, login, recordReading } from "./helpers";

/**
 * Showcase flow 2 — Tampering catch.
 * One operator watches the Analytics alert strip while another records an anomalous
 * (meter-rolled-back) reading; analytics scores it and the live tampering alert
 * surfaces with its reason and score.
 */
test("an anomalous reading raises a live tampering alert on the dashboard", async ({ browser }) => {
  const watcherCtx = await browser.newContext();
  const recorderCtx = await browser.newContext();
  const watcher = await watcherCtx.newPage();
  const recorder = await recorderCtx.newPage();

  // Admin watches the Analytics page with the alert feed listening.
  await login(watcher, USERS.admin, /\/operator/);
  await watcher.goto("/operator/analytics");
  await expect(watcher.getByText(/live alerts connected/i)).toBeVisible();

  // Admin records a high baseline then a sharply lower value (negative delta). The
  // rollback (50 < 500) is a corrective reading, which core-java permits only for
  // admins — see ReadingService.record's backdated/rollback guard.
  await login(recorder, USERS.admin, /\/operator/);
  await recordReading(recorder, SEEDED_SUBSCRIBER_ID, 500);
  await recordReading(recorder, SEEDED_SUBSCRIBER_ID, 50);

  // The reading.flagged event fans out to the watcher's live tampering strip.
  await expect(watcher.getByTestId("tampering-alerts")).toContainText(/NEGATIVE_DELTA/);

  await watcherCtx.close();
  await recorderCtx.close();
});

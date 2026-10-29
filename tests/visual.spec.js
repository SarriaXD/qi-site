import { expect, test } from "@playwright/test";

function isMobileProject(testInfo) {
  return testInfo.project.name.startsWith("mobile-");
}

async function prepareVisualState(page, state) {
  await page.goto("/?test=1", { waitUntil: "load" });
  await page.locator("body.is-ready").waitFor();
  await page.evaluate(({ nextState }) => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    hooks.seed(20260730);
    hooks.setState(nextState);
  }, { nextState: state });
  await expect(page.locator("#storyCanvas")).toBeVisible();
  await page.waitForTimeout(320);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
}

test("desktop arrival visual", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop baseline");
  await prepareVisualState(page, "arrival");
  await expect(page).toHaveScreenshot("arrival-desktop.png");
});

test("mobile arrival visual", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "Mobile baseline");
  await prepareVisualState(page, "arrival");
  await expect(page).toHaveScreenshot("arrival-mobile.png");
});

test("compact signal scroll-conducted visual", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-webkit", "Compact WebKit baseline");
  await page.setViewportSize({ width: 320, height: 568 });
  await prepareVisualState(page, "signal");
  await expect(page).toHaveScreenshot("signal-compact.png");
});

test("mobile craft visual", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "Mobile baseline");
  await prepareVisualState(page, "craft");
  await expect(page).toHaveScreenshot("craft-mobile.png");
});

test("mobile final visual", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "Mobile baseline");
  await prepareVisualState(page, "contact");
  await expect(page).toHaveScreenshot("contact-mobile.png");
});

test("mobile settings visual", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "Mobile baseline");
  await prepareVisualState(page, "field");
  await page.getByRole("button", { name: "Open experience settings" }).click();
  await expect(page.getByRole("dialog", { name: "Tune the light" })).toBeVisible();
  await expect(page).toHaveScreenshot("settings-mobile.png");
});

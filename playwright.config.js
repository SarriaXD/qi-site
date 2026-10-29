import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.018,
    },
  },
  use: {
    baseURL: "http://127.0.0.1:8788",
    colorScheme: "dark",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node serve.ts",
    url: "http://127.0.0.1:8788",
    reuseExistingServer: true,
    timeout: 15_000,
  },
  projects: [
    {
      name: "desktop-chrome",
      use: {
        browserName: "chromium",
        channel: "chrome",
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: "mobile-chrome",
      use: {
        browserName: "chromium",
        channel: "chrome",
        viewport: { width: 393, height: 852 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "mobile-webkit",
      use: {
        ...devices["iPhone 13"],
        browserName: "webkit",
        colorScheme: "dark",
      },
    },
  ],
});

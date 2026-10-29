import { chromium, devices } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";

const args = {
  mobile: false,
  state: "arrival",
  url: "http://127.0.0.1:8788/?test=1",
  output: "artifacts/canvas-inspection",
};

for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value === "--mobile") args.mobile = true;
  else if (value === "--state") args.state = process.argv[++index];
  else if (value === "--url") args.url = process.argv[++index];
  else if (value === "--output") args.output = process.argv[++index];
  else throw new Error(`Unknown argument: ${value}`);
}

const budgets = args.mobile
  ? { calls: 150, triangles: 300_000, geometries: 200, textures: 40 }
  : { calls: 300, triangles: 750_000, geometries: 300, textures: 60 };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext(
  args.mobile
    ? { ...devices["iPhone 13"], userAgent: undefined }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
);
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));

await page.goto(args.url, { waitUntil: "load" });
await page.locator("body.is-ready").waitFor();
await page.locator("#storyCanvas").waitFor({ state: "visible" });
await page.evaluate(({ state }) => {
  const hooks = window.__THREE_GAME_TEST_HOOKS__;
  hooks.seed(20260730);
  hooks.setState(state);
}, { state: args.state });
await page.waitForTimeout(360);

const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.snapshot());
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));

const canvas = page.locator("#storyCanvas");
const canvasBox = await canvas.boundingBox();
const canvasPng = PNG.sync.read(await canvas.screenshot());
const histogram = new Map();
let minLuminance = 255;
let maxLuminance = 0;
let nonTransparent = 0;
let edgeSamples = 0;
let edges = 0;
const stepX = Math.max(1, Math.floor(canvasPng.width / 160));
const stepY = Math.max(1, Math.floor(canvasPng.height / 90));
const sampled = [];

for (let y = 0; y < canvasPng.height; y += stepY) {
  const row = [];
  for (let x = 0; x < canvasPng.width; x += stepX) {
    const offset = (y * canvasPng.width + x) * 4;
    const red = canvasPng.data[offset];
    const green = canvasPng.data[offset + 1];
    const blue = canvasPng.data[offset + 2];
    const alpha = canvasPng.data[offset + 3];
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    row.push(luminance);
    minLuminance = Math.min(minLuminance, luminance);
    maxLuminance = Math.max(maxLuminance, luminance);
    if (alpha > 0) nonTransparent += 1;
    const bucket = `${red >> 4},${green >> 4},${blue >> 4},${alpha >> 6}`;
    histogram.set(bucket, (histogram.get(bucket) || 0) + 1);
  }
  sampled.push(row);
}

for (let y = 0; y < sampled.length - 1; y += 1) {
  for (let x = 0; x < sampled[y].length - 1; x += 1) {
    const deltaX = Math.abs(sampled[y][x] - sampled[y][x + 1]);
    const deltaY = Math.abs(sampled[y][x] - sampled[y + 1][x]);
    if (Math.max(deltaX, deltaY) > 12) edges += 1;
    edgeSamples += 1;
  }
}

const renderer = diagnostics.world?.renderer || {};
const budgetRows = Object.entries(budgets).map(([metric, limit]) => ({
  metric,
  actual: renderer[metric] ?? null,
  limit,
  ok: typeof renderer[metric] === "number" ? renderer[metric] <= limit : false,
}));
const nonblank =
  canvasBox?.width > 32 &&
  canvasBox?.height > 32 &&
  nonTransparent > 256 &&
  maxLuminance - minLuminance > 8 &&
  histogram.size > 3;

await mkdir(args.output, { recursive: true });
const mode = args.mobile ? "mobile" : "desktop";
const basename = `${mode}-${args.state}`;
const screenshotPath = path.join(args.output, `${basename}.png`);
const reportPath = path.join(args.output, `${basename}.json`);
await page.screenshot({ path: screenshotPath, fullPage: true });

const report = {
  url: args.url,
  mode,
  state: args.state,
  seed: 20260730,
  screenshotPath,
  canvas: {
    nonblank,
    box: canvasBox,
    drawingBuffer: await canvas.evaluate((element) => ({
      width: element.width,
      height: element.height,
    })),
    colorBuckets: histogram.size,
    luminanceContrast: Number((maxLuminance - minLuminance).toFixed(1)),
    edgeDensity: Number((edges / Math.max(1, edgeSamples)).toFixed(3)),
  },
  diagnostics,
  renderBudget: {
    rows: budgetRows,
    withinBudget: budgetRows.every((row) => row.ok),
  },
  consoleErrors,
  pageErrors,
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (!nonblank || !report.renderBudget.withinBudget || consoleErrors.length || pageErrors.length) {
  process.exitCode = 1;
}

import { chromium, devices, webkit } from "@playwright/test";

const PUBLIC_URL = "https://me.sarria.ca/";
const REDIRECT_URL = "http://me.sarria.ca/path?q=1";
const SENSITIVE_PATHS = [
  "/.git/HEAD",
  "/.git/config",
  "/qiwang.md",
  "/DESIGN.md",
  "/serve.ts",
  "/.env",
];
const LOAD_TIMEOUT = 30_000;

const failures = [];
const report = {
  url: PUBLIC_URL,
  chromeMobile: null,
  webkitIPhone13: null,
  webkitReducedMotion: null,
  webkitNoJavaScript: null,
  http: null,
};

function assertCheck(label, condition, actual) {
  if (!condition) failures.push({ check: label, actual });
}

function isCloudflareBeacon(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "cloudflareinsights.com" ||
      parsed.hostname.endsWith(".cloudflareinsights.com") ||
      /\/cdn-cgi\/(?:rum|beacon)(?:[/?]|$)/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function observePage(page) {
  const signals = {
    console: [],
    page: [],
    requestFailed: [],
    cloudflareBeacons: [],
  };

  page.on("console", (message) => {
    if (message.type() === "error") signals.console.push(message.text());
  });
  page.on("pageerror", (error) => signals.page.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    signals.requestFailed.push(
      `${request.method()} ${request.url()}${failure?.errorText ? `: ${failure.errorText}` : ""}`,
    );
  });
  page.on("request", (request) => {
    if (isCloudflareBeacon(request.url())) signals.cloudflareBeacons.push(request.url());
  });

  return signals;
}

function summarizeSignals(signals) {
  const summary = {
    console: signals.console.length,
    page: signals.page.length,
    requestFailed: signals.requestFailed.length,
    cloudflareBeacons: signals.cloudflareBeacons.length,
  };
  const errorCount = summary.console + summary.page + summary.requestFailed;

  if (errorCount || summary.cloudflareBeacons) {
    summary.details = {
      console: signals.console,
      page: signals.page,
      requestFailed: signals.requestFailed,
      cloudflareBeacons: [...new Set(signals.cloudflareBeacons)],
    };
  }

  return { summary, errorCount };
}

async function navigateToPublic(page) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await page.goto(PUBLIC_URL, {
        waitUntil: "load",
        timeout: LOAD_TIMEOUT,
      });
    } catch (error) {
      lastError = error;
      if (attempt === 0) await page.waitForTimeout(500);
    }
  }
  throw lastError;
}

async function tapLocator(page, locator) {
  await locator.waitFor({ state: "visible", timeout: LOAD_TIMEOUT });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Visible control has no touch geometry: ${await locator.getAttribute("id")}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function scrollToProductionChapter(page, id, expectedName) {
  const target = await page.evaluate((chapterId) => {
    const chapter = document.getElementById(chapterId);
    if (!chapter) return null;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const targetY = Math.min(maxScroll, Math.max(0, chapter.offsetTop));
    window.scrollTo(0, targetY);
    return targetY;
  }, id);

  await page.waitForFunction(
    (name) => document.querySelector("#chapterName")?.textContent?.trim() === name,
    expectedName,
    { timeout: LOAD_TIMEOUT },
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

  const state = await page.evaluate(() => ({
    chapter: document.querySelector("#chapterName")?.textContent?.trim() ?? null,
    scrollY,
  }));

  return { id, target, expected: expectedName, ...state };
}

async function inspectWebkitProductionInteractions(page, label) {
  const field = await scrollToProductionChapter(page, "field-notes", "Field notes");
  const contact = await scrollToProductionChapter(page, "open-channel", "Open channel");

  assertCheck(`${label}.navigation.field`, field.chapter === field.expected, field);
  assertCheck(`${label}.navigation.contact`, contact.chapter === contact.expected, contact);

  const settingsButton = page.locator("#settingsButton");
  const settingsDialog = page.locator("#settingsDialog");
  const closeSettingsButton = settingsDialog.locator('button[aria-label="Close settings"]');
  const materialToggle = page.locator("#materialToggle");
  const scrollBefore = await page.evaluate(() => scrollY);

  await tapLocator(page, settingsButton);
  await settingsDialog.waitFor({ state: "visible", timeout: LOAD_TIMEOUT });
  const afterOpen = await page.evaluate(() => {
    const dialog = document.querySelector("#settingsDialog");
    return {
      scrollY,
      open: dialog?.open ?? false,
      position: dialog ? getComputedStyle(dialog).position : null,
    };
  });
  await tapLocator(page, closeSettingsButton);
  await settingsDialog.waitFor({ state: "hidden", timeout: LOAD_TIMEOUT });
  const afterClose = await page.evaluate(() => ({
    scrollY,
    open: document.querySelector("#settingsDialog")?.open ?? false,
  }));
  const settings = {
    scrollBefore,
    afterOpen,
    afterClose,
    openScrollDelta: Number((afterOpen.scrollY - scrollBefore).toFixed(2)),
    closeScrollDelta: Number((afterClose.scrollY - scrollBefore).toFixed(2)),
  };

  assertCheck(
    `${label}.settings.openPreservesScroll`,
    Math.abs(settings.openScrollDelta) <= 1,
    settings,
  );
  assertCheck(
    `${label}.settings.closePreservesScroll`,
    Math.abs(settings.closeScrollDelta) <= 1,
    settings,
  );
  assertCheck(`${label}.settings.dialogPosition`, afterOpen.position === "fixed", afterOpen);
  assertCheck(`${label}.settings.opened`, afterOpen.open, afterOpen);
  assertCheck(`${label}.settings.closed`, !afterClose.open, afterClose);

  await tapLocator(page, settingsButton);
  await settingsDialog.waitFor({ state: "visible", timeout: LOAD_TIMEOUT });
  await tapLocator(page, materialToggle);
  await page.waitForFunction(
    () =>
      document.body.classList.contains("solid-materials") &&
      document.querySelector("#materialToggle")?.getAttribute("aria-checked") === "false" &&
      getComputedStyle(document.querySelector(".topbar")).backdropFilter === "none",
    undefined,
    { timeout: LOAD_TIMEOUT },
  );
  const off = await page.evaluate(() => ({
    ariaChecked: document.querySelector("#materialToggle")?.getAttribute("aria-checked") ?? null,
    solidMaterials: document.body.classList.contains("solid-materials"),
    topbarBackdropFilter: getComputedStyle(document.querySelector(".topbar")).backdropFilter,
  }));
  await tapLocator(page, materialToggle);
  await page.waitForFunction(
    () =>
      !document.body.classList.contains("solid-materials") &&
      document.querySelector("#materialToggle")?.getAttribute("aria-checked") === "true",
    undefined,
    { timeout: LOAD_TIMEOUT },
  );
  const restored = await page.evaluate(() => ({
    ariaChecked: document.querySelector("#materialToggle")?.getAttribute("aria-checked") ?? null,
    solidMaterials: document.body.classList.contains("solid-materials"),
    topbarBackdropFilter: getComputedStyle(document.querySelector(".topbar")).backdropFilter,
  }));
  await tapLocator(page, closeSettingsButton);
  const glassEffects = { off, restored };

  assertCheck(
    `${label}.glassEffects.solidMaterials`,
    off.solidMaterials && off.ariaChecked === "false",
    off,
  );
  assertCheck(
    `${label}.glassEffects.noBackdropFilter`,
    off.topbarBackdropFilter === "none",
    off,
  );
  assertCheck(
    `${label}.glassEffects.restored`,
    !restored.solidMaterials && restored.ariaChecked === "true",
    restored,
  );

  const dynamicViewport = [];
  for (const height of [600, 780, 664]) {
    await page.setViewportSize({ width: 390, height });
    await page.waitForFunction(
      ({ width, expectedHeight }) => {
        const rect = document.querySelector("#storyCanvas")?.getBoundingClientRect();
        return (
          innerWidth === width &&
          innerHeight === expectedHeight &&
          rect &&
          Math.abs(rect.width - width) <= 1 &&
          Math.abs(rect.height - expectedHeight) <= 1
        );
      },
      { width: 390, expectedHeight: height },
      { timeout: LOAD_TIMEOUT },
    );
    const chapter = await scrollToProductionChapter(page, "open-channel", "Open channel");
    const fit = await page.evaluate(() => {
      const root = document.documentElement;
      const canvas = document.querySelector("#storyCanvas")?.getBoundingClientRect();
      const dock = document.querySelector(".story-dock")?.getBoundingClientRect();
      return {
        viewport: [innerWidth, innerHeight],
        canvas: canvas
          ? [Number(canvas.width.toFixed(2)), Number(canvas.height.toFixed(2))]
          : [0, 0],
        dock: dock
          ? [
              Number(dock.left.toFixed(2)),
              Number(dock.top.toFixed(2)),
              Number(dock.right.toFixed(2)),
              Number(dock.bottom.toFixed(2)),
            ]
          : null,
        overflow: Math.max(0, root.scrollWidth - innerWidth),
      };
    });
    const canvasFits =
      Math.abs(fit.canvas[0] - fit.viewport[0]) <= 1 &&
      Math.abs(fit.canvas[1] - fit.viewport[1]) <= 1;
    const dockFits =
      fit.dock &&
      fit.dock[0] >= 0 &&
      fit.dock[1] >= 0 &&
      fit.dock[2] <= fit.viewport[0] &&
      fit.dock[3] <= fit.viewport[1];
    const snapshot = { height, chapter, ...fit, canvasFits, dockFits };
    dynamicViewport.push(snapshot);

    assertCheck(
      `${label}.dynamicViewport.${height}.viewport`,
      fit.viewport[0] === 390 && fit.viewport[1] === height,
      snapshot,
    );
    assertCheck(`${label}.dynamicViewport.${height}.canvas`, canvasFits, snapshot);
    assertCheck(`${label}.dynamicViewport.${height}.dock`, dockFits, snapshot);
    assertCheck(
      `${label}.dynamicViewport.${height}.horizontalOverflow`,
      fit.overflow === 0,
      snapshot,
    );
  }

  return {
    navigation: { field, contact },
    settings,
    glassEffects,
    dynamicViewport,
  };
}

async function inspectRendered(browser, contextOptions, label, inspectPage = null) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const signals = observePage(page);

  try {
    const response = await navigateToPublic(page);
    await page
      .locator('body.is-ready[data-render-mode="webgl"]')
      .waitFor({ state: "attached", timeout: LOAD_TIMEOUT })
      .catch(() => {});
    await page.waitForTimeout(500);

    const state = await page.evaluate(() => {
      const canvas = document.querySelector("#storyCanvas");
      const rect = canvas?.getBoundingClientRect();
      const root = document.documentElement;
      return {
        ready: document.body?.classList.contains("is-ready") ?? false,
        renderMode: document.body?.dataset.renderMode ?? null,
        canvasCss: rect
          ? [Number(rect.width.toFixed(2)), Number(rect.height.toFixed(2))]
          : [0, 0],
        canvasBuffer: canvas ? [canvas.width, canvas.height] : [0, 0],
        overflow: Math.max(0, root.scrollWidth - innerWidth),
        hooksAbsent:
          !("__THREE_GAME_TEST_HOOKS__" in window) &&
          !("__THREE_GAME_DIAGNOSTICS__" in window),
      };
    });
    const interactions = inspectPage ? await inspectPage(page, label) : null;
    const observed = summarizeSignals(signals);
    const result = {
      status: response?.status() ?? null,
      ready: state.ready,
      renderMode: state.renderMode,
      canvas: { css: state.canvasCss, buffer: state.canvasBuffer },
      overflow: state.overflow,
      hooksAbsent: state.hooksAbsent,
      errors: observed.summary,
    };
    if (interactions) result.interactions = interactions;

    assertCheck(`${label}.status`, result.status === 200, result.status);
    assertCheck(`${label}.bodyReady`, result.ready, result.ready);
    assertCheck(`${label}.renderMode`, result.renderMode === "webgl", result.renderMode);
    assertCheck(
      `${label}.canvasCss`,
      result.canvas.css.every((value) => value > 0),
      result.canvas.css,
    );
    assertCheck(
      `${label}.canvasBuffer`,
      result.canvas.buffer.every((value) => value > 0),
      result.canvas.buffer,
    );
    assertCheck(`${label}.horizontalOverflow`, result.overflow === 0, result.overflow);
    assertCheck(`${label}.productionHooks`, result.hooksAbsent, result.hooksAbsent);
    assertCheck(`${label}.browserErrors`, observed.errorCount === 0, observed.summary);
    assertCheck(
      `${label}.cloudflareBeacon`,
      observed.summary.cloudflareBeacons === 0,
      observed.summary,
    );

    return result;
  } finally {
    await context.close();
  }
}

async function inspectReducedMotion(browser) {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const signals = observePage(page);

  try {
    const response = await navigateToPublic(page);
    await page
      .locator('body.is-ready[data-render-mode="css-reduced-motion"]')
      .waitFor({ state: "attached", timeout: LOAD_TIMEOUT })
      .catch(() => {});
    await page.waitForTimeout(500);

    const state = await page.evaluate(() => {
      const root = document.documentElement;
      const canvas = document.querySelector("#storyCanvas");
      const dock = document.querySelector(".story-dock");
      const canvasStyle = canvas ? getComputedStyle(canvas) : null;
      const dockStyle = dock ? getComputedStyle(dock) : null;
      const canvasRect = canvas?.getBoundingClientRect();
      const dockRect = dock?.getBoundingClientRect();
      const canvasHidden =
        !canvas ||
        canvasStyle?.display === "none" ||
        canvasStyle?.visibility === "hidden" ||
        !canvasRect?.width ||
        !canvasRect?.height;
      const canvasOpacity = canvasStyle ? Number(canvasStyle.opacity) : 0;
      const dockHidden =
        !dock ||
        dockStyle?.display === "none" ||
        dockStyle?.visibility === "hidden" ||
        !dockRect?.width ||
        !dockRect?.height;

      return {
        ready: document.body?.classList.contains("is-ready") ?? false,
        renderMode: document.body?.dataset.renderMode ?? null,
        hooksAbsent:
          !("__THREE_GAME_TEST_HOOKS__" in window) &&
          !("__THREE_GAME_DIAGNOSTICS__" in window),
        canvas: {
          hidden: canvasHidden,
          opacity: canvasOpacity,
          inactive: canvasHidden || canvasOpacity === 0,
        },
        dockHidden,
        overflow: Math.max(0, root.scrollWidth - innerWidth),
      };
    });
    const observed = summarizeSignals(signals);
    const result = {
      status: response?.status() ?? null,
      ...state,
      errors: observed.summary,
    };

    assertCheck("webkitReducedMotion.status", result.status === 200, result.status);
    assertCheck("webkitReducedMotion.bodyReady", result.ready, result.ready);
    assertCheck(
      "webkitReducedMotion.renderMode",
      result.renderMode === "css-reduced-motion",
      result.renderMode,
    );
    assertCheck("webkitReducedMotion.productionHooks", result.hooksAbsent, result.hooksAbsent);
    assertCheck("webkitReducedMotion.canvasInactive", result.canvas.inactive, result.canvas);
    assertCheck("webkitReducedMotion.dockHidden", result.dockHidden, result.dockHidden);
    assertCheck("webkitReducedMotion.horizontalOverflow", result.overflow === 0, result.overflow);
    assertCheck("webkitReducedMotion.browserErrors", observed.errorCount === 0, observed.summary);
    assertCheck(
      "webkitReducedMotion.cloudflareBeacon",
      observed.summary.cloudflareBeacons === 0,
      observed.summary,
    );

    return result;
  } finally {
    await context.close();
  }
}

async function inspectNoJavaScript(browser) {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: "dark",
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  const signals = observePage(page);

  try {
    const response = await navigateToPublic(page);
    const state = await page.evaluate(() => {
      const visible = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const root = document.documentElement;

      return {
        veilHidden: !visible(".load-veil"),
        quickProfileVisible: visible("#quick-profile"),
        contactVisible: visible("#open-channel"),
        mailVisible: visible('a[href^="mailto:"]'),
        overflow: Math.max(0, root.scrollWidth - innerWidth),
      };
    });
    const observed = summarizeSignals(signals);
    const result = {
      status: response?.status() ?? null,
      ...state,
      errors: observed.summary,
    };

    assertCheck("webkitNoJavaScript.status", result.status === 200, result.status);
    assertCheck("webkitNoJavaScript.veilHidden", result.veilHidden, result.veilHidden);
    assertCheck(
      "webkitNoJavaScript.quickProfileVisible",
      result.quickProfileVisible,
      result.quickProfileVisible,
    );
    assertCheck("webkitNoJavaScript.contactVisible", result.contactVisible, result.contactVisible);
    assertCheck("webkitNoJavaScript.mailVisible", result.mailVisible, result.mailVisible);
    assertCheck("webkitNoJavaScript.horizontalOverflow", result.overflow === 0, result.overflow);
    assertCheck("webkitNoJavaScript.browserErrors", observed.errorCount === 0, observed.summary);
    assertCheck(
      "webkitNoJavaScript.cloudflareBeacon",
      observed.summary.cloudflareBeacons === 0,
      observed.summary,
    );

    return result;
  } finally {
    await context.close();
  }
}

async function inspectHttp() {
  const redirectResponse = await fetch(REDIRECT_URL, {
    redirect: "manual",
    signal: AbortSignal.timeout(LOAD_TIMEOUT),
  });
  const location = redirectResponse.headers.get("location");
  let redirectTarget = null;
  let preservesPathAndQuery = false;

  if (location) {
    redirectTarget = new URL(location, REDIRECT_URL);
    preservesPathAndQuery =
      redirectTarget.protocol === "https:" &&
      redirectTarget.host === "me.sarria.ca" &&
      redirectTarget.pathname === "/path" &&
      redirectTarget.search === "?q=1";
  }

  const sensitiveEntries = await Promise.all(
    SENSITIVE_PATHS.map(async (path) => {
      const response = await fetch(new URL(path, PUBLIC_URL), {
        redirect: "manual",
        signal: AbortSignal.timeout(LOAD_TIMEOUT),
      });
      return [path, response.status];
    }),
  );
  const sensitive = Object.fromEntries(sensitiveEntries);
  const result = {
    redirect: {
      status: redirectResponse.status,
      location,
      preservesPathAndQuery,
    },
    sensitive,
  };

  assertCheck("http.redirectStatus", result.redirect.status === 308, result.redirect);
  assertCheck("http.redirectTarget", preservesPathAndQuery, result.redirect);
  for (const [path, status] of sensitiveEntries) {
    assertCheck(`http.sensitive:${path}`, status === 404, status);
  }

  return result;
}

async function capture(label, operation) {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ check: `${label}.execution`, actual: message });
    return { fatal: message };
  }
}

let chromeBrowser;
try {
  chromeBrowser = await chromium.launch({ channel: "chrome", headless: true });
  report.chromeMobile = await capture("chromeMobile", () =>
    inspectRendered(
      chromeBrowser,
      {
        viewport: { width: 393, height: 852 },
        colorScheme: "dark",
        hasTouch: true,
        isMobile: true,
      },
      "chromeMobile",
    ),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  failures.push({ check: "chrome.launch", actual: message });
  report.chromeMobile = { fatal: message };
} finally {
  await chromeBrowser?.close();
}

let webkitBrowser;
try {
  webkitBrowser = await webkit.launch({ headless: true });
  report.webkitIPhone13 = await capture("webkitIPhone13", () =>
    inspectRendered(
      webkitBrowser,
      { ...devices["iPhone 13"], colorScheme: "dark" },
      "webkitIPhone13",
      inspectWebkitProductionInteractions,
    ),
  );
  report.webkitReducedMotion = await capture("webkitReducedMotion", () =>
    inspectReducedMotion(webkitBrowser),
  );
  report.webkitNoJavaScript = await capture("webkitNoJavaScript", () =>
    inspectNoJavaScript(webkitBrowser),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  failures.push({ check: "webkit.launch", actual: message });
  report.webkitIPhone13 = { fatal: message };
  report.webkitReducedMotion = { fatal: message };
  report.webkitNoJavaScript = { fatal: message };
} finally {
  await webkitBrowser?.close();
}

report.http = await capture("http", inspectHttp);
report.ok = failures.length === 0;
if (failures.length) report.failures = failures;

console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;

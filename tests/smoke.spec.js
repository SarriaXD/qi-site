import { expect, test } from "@playwright/test";

function isMobileProject(testInfo) {
  return testInfo.project.name.startsWith("mobile-");
}

function isWebKitProject(testInfo) {
  return testInfo.project.name.endsWith("webkit");
}

function runsStaticEdgeChecks(testInfo) {
  return testInfo.project.name === "desktop-chrome" || testInfo.project.name === "mobile-webkit";
}

async function openStory(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.goto("/?test=1", { waitUntil: "load" });
  await page.locator("body.is-ready").waitFor();
  await page
    .locator(
      'body[data-render-mode="webgl"], body[data-render-mode="css-fallback"], body[data-render-mode="css-save-data"], body[data-render-mode="css-reduced-motion"]',
    )
    .waitFor({ timeout: 10_000 });
  return errors;
}

async function installFakeAudioContext(page) {
  await page.addInitScript(() => {
    const control = {
      hidden: false,
      resumeMode: "resolve",
      instances: [],
    };

    class FakeAudioParam {
      value = 0;

      setValueAtTime(value) {
        this.value = value;
        return this;
      }

      exponentialRampToValueAtTime(value) {
        this.value = value;
        return this;
      }
    }

    class FakeAudioNode {
      constructor(context, kind) {
        this.context = context;
        this.kind = kind;
        this.frequency = new FakeAudioParam();
        this.gain = new FakeAudioParam();
        this.type = "sine";
      }

      connect() {
        return this;
      }

      start() {
        this.context.startCalls += 1;
      }

      stop() {
        this.context.stopCalls += 1;
      }
    }

    class FakeAudioContext {
      constructor() {
        this.state = "suspended";
        this.currentTime = 1;
        this.destination = {};
        this.resumeCalls = 0;
        this.closeCalls = 0;
        this.startCalls = 0;
        this.stopCalls = 0;
        control.instances.push(this);
      }

      resume() {
        this.resumeCalls += 1;
        if (control.resumeMode === "never") return new Promise(() => {});
        if (control.resumeMode === "reject") return Promise.reject(new Error("interrupted"));
        this.state = "running";
        return Promise.resolve();
      }

      close() {
        this.closeCalls += 1;
        this.state = "closed";
        return Promise.resolve();
      }

      createOscillator() {
        return new FakeAudioNode(this, "oscillator");
      }

      createGain() {
        return new FakeAudioNode(this, "gain");
      }
    }

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => control.hidden,
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(window, "webkitAudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });

    window.__AUDIO_TEST__ = {
      setCurrentState(state) {
        const current = control.instances.at(-1);
        if (current) current.state = state;
      },
      setHidden(hidden) {
        control.hidden = hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      },
      setResumeMode(mode) {
        control.resumeMode = mode;
      },
      snapshot() {
        return {
          hidden: control.hidden,
          resumeMode: control.resumeMode,
          instances: control.instances.map((context) => ({
            state: context.state,
            resumeCalls: context.resumeCalls,
            closeCalls: context.closeCalls,
            startCalls: context.startCalls,
            stopCalls: context.stopCalls,
          })),
        };
      },
    };
  });
}

test("public origin only exposes allowlisted site files", async ({ request }) => {
  const publicPaths = [
    "/",
    "/index.html",
    "/style.css",
    "/nojs.css",
    "/app.js",
    "/vendor/three.module.min.js",
    "/assets/mark.svg",
    "/assets/banff-portrait-test.png",
    "/assets/portrait-placeholder.svg",
  ];
  const privatePaths = [
    "/.git/HEAD",
    "/.git/config",
    "/qiwang.md",
    "/DESIGN.md",
    "/serve.ts",
    "/.env",
    "/assets/banff-1.jpg",
    "/assets/banff-3.jpg",
    "/assets/banff-5.jpg",
  ];

  for (const path of publicPaths) {
    const response = await request.get(path);
    expect(response.status(), `${path} should be public`).toBe(200);
  }

  for (const path of privatePaths) {
    const response = await request.get(path);
    expect(response.status(), `${path} must stay private`).toBe(404);
  }

  const root = await request.get("/");
  const headers = root.headers();
  expect(headers["cache-control"]).toContain("no-transform");
  expect(headers["content-security-policy"]).toContain("script-src 'self'");
  expect(headers["content-security-policy"]).not.toContain("cdn.jsdelivr");
  expect(headers["strict-transport-security"]).toContain("max-age=31536000");
  expect((await request.post("/")).status()).toBe(405);
});

test("story renders, responds to input, and reaches all six memories", async ({ page }, testInfo) => {
  const errors = await openStory(page);
  const canvas = page.locator("#storyCanvas");
  await expect(canvas).toBeVisible();

  const renderState = await page.evaluate(() => {
    const target = document.querySelector("#storyCanvas");
    const rect = target.getBoundingClientRect();
    return {
      mode: document.body.dataset.renderMode,
      css: [rect.width, rect.height],
      buffer: [target.width, target.height],
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  });
  expect(renderState.mode).toBe("webgl");
  expect(renderState.css[0]).toBeGreaterThan(0);
  expect(renderState.css[1]).toBeGreaterThan(0);
  expect(renderState.buffer[0]).toBeGreaterThan(0);
  expect(renderState.buffer[1]).toBeGreaterThan(0);
  expect(renderState.scrollWidth).toBe(renderState.viewportWidth);

  await page.evaluate(() => window.scrollBy(0, innerHeight * 0.75));
  await expect
    .poll(() => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().story.energy))
    .toBeGreaterThan(0.05);
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.keyboard.press(isWebKitProject(testInfo) ? "Alt+Tab" : "Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#quick-profile")).toBeFocused();

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState("contact"));
  await expect(page.locator("#chapterName")).toHaveText("Open channel");
  await expect(page.locator("#memoryCount")).toHaveText("6");
  await expect(page.locator("#resonanceLabel")).toHaveText("river awake");

  await page.keyboard.press("K");
  await expect(page.locator(".glyph-trace")).toHaveText("K");
  await page.locator(".glyph-trace").waitFor({ state: "detached" });

  await page.mouse.click(330, 360);
  await expect(page.locator(".gesture-ripple")).toBeVisible();
  await page.locator(".gesture-ripple").waitFor({ state: "detached" });

  const slider = page.getByRole("slider", { name: "Drag to move through the story" });
  await slider.press("Home");
  await expect(page.locator("#chapterName")).toHaveText("Arrival");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const puck = document.querySelector("#dockPuck").getBoundingClientRect();
        const dot = document.querySelector('[data-scroll-to="arrival"]').getBoundingClientRect();
        return Math.abs(puck.left + puck.width / 2 - (dot.left + dot.width / 2));
      }),
    )
    .toBeLessThan(2);
  const puckBeforeGrab = await slider.boundingBox();
  const centerBeforeGrab = puckBeforeGrab.x + puckBeforeGrab.width / 2;
  await page.mouse.move(centerBeforeGrab + 10, puckBeforeGrab.y + puckBeforeGrab.height / 2);
  await page.mouse.down();
  await expect
    .poll(() =>
      slider.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left + rect.width / 2;
      }),
    )
    .toBeCloseTo(centerBeforeGrab, 0);
  await page.mouse.up();

  await slider.press("End");
  await expect(page.locator("#chapterName")).toHaveText("Open channel");
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const puck = document.querySelector("#dockPuck").getBoundingClientRect();
        const dot = document.querySelector('[data-scroll-to="open-channel"]').getBoundingClientRect();
        return Math.abs(puck.left + puck.width / 2 - (dot.left + dot.width / 2));
      }),
    )
    .toBeLessThan(2);
  expect(errors).toEqual([]);
});

test("settings controls are named, reversible, and reset the story", async ({ page }) => {
  const errors = await openStory(page);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState("field"));
  const scrollBeforeSettings = await page.evaluate(() => scrollY);

  await page.getByRole("button", { name: "Open experience settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Tune the light" });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(scrollBeforeSettings, 0);
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(scrollBeforeSettings, 0);
  await page.getByRole("button", { name: "Open experience settings" }).click();
  await expect(dialog).toBeVisible();

  const sound = page.getByRole("switch", { name: "Sound" });
  await sound.click();
  await expect(sound).toHaveAttribute("aria-checked", "true");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-checked", "false");

  const glass = page.getByRole("switch", { name: "Glass effects" });
  await glass.click();
  await expect(glass).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("body")).toHaveClass(/solid-materials/);
  await expect
    .poll(() => page.locator(".topbar").evaluate((element) => getComputedStyle(element).backdropFilter))
    .toBe("none");
  await glass.click();
  await expect(glass).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("body")).not.toHaveClass(/solid-materials/);

  const motion = page.getByRole("switch", { name: "Motion" });
  await motion.click();
  await expect(page.locator("body")).toHaveClass(/motion-off/);
  await expect
    .poll(() => page.locator(".chapter-stage").first().evaluate((element) => getComputedStyle(element).position))
    .toBe("relative");
  await motion.click();
  await expect(page.locator("body")).not.toHaveClass(/motion-off/);
  await expect
    .poll(() => page.locator(".chapter-stage").first().evaluate((element) => getComputedStyle(element).position))
    .toBe("sticky");

  await page.getByRole("button", { name: "Reset memory nodes" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#chapterName")).toHaveText("Arrival");
  await expect(page.locator("#memoryCount")).toHaveText("1");
  expect(errors).toEqual([]);
});

test("Safari-style audio interruption recovers on the next trusted gesture", async ({ page }, testInfo) => {
  test.skip(!isWebKitProject(testInfo), "WebKit audio lifecycle check");
  await installFakeAudioContext(page);
  const errors = await openStory(page);

  await page.getByRole("button", { name: "Open experience settings" }).click();
  const sound = page.getByRole("switch", { name: "Sound" });
  await sound.click();
  await expect(sound).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(() => page.evaluate(() => window.__AUDIO_TEST__.snapshot().instances[0]))
    .toEqual(expect.objectContaining({
      state: "running",
      resumeCalls: 1,
      startCalls: 2,
    }));

  await page.evaluate(() => {
    document.querySelector("#settingsDialog").close();
    window.__AUDIO_TEST__.setCurrentState("interrupted");
  });
  await page.touchscreen.tap(120, 300);
  await expect
    .poll(() => page.evaluate(() => window.__AUDIO_TEST__.snapshot().instances[0]))
    .toEqual(expect.objectContaining({
      state: "running",
      resumeCalls: 2,
    }));

  await page.evaluate(() => window.__AUDIO_TEST__.setHidden(true));
  await expect
    .poll(() => page.evaluate(() => window.__AUDIO_TEST__.snapshot().instances[0].closeCalls))
    .toBe(1);
  await page.evaluate(() => window.__AUDIO_TEST__.setHidden(false));
  expect(await page.evaluate(() => window.__AUDIO_TEST__.snapshot().instances.length)).toBe(1);
  await page.touchscreen.tap(150, 330);
  await expect
    .poll(() => page.evaluate(() => window.__AUDIO_TEST__.snapshot().instances[1]))
    .toEqual(expect.objectContaining({
      state: "running",
      resumeCalls: 1,
    }));

  await page.getByRole("button", { name: "Open experience settings" }).click();
  await sound.click();
  await expect(sound).toHaveAttribute("aria-checked", "false");
  await page.evaluate(() => window.__AUDIO_TEST__.setResumeMode("never"));
  await sound.click();
  await expect(sound).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(() => page.evaluate(() => window.__AUDIO_TEST__.snapshot().instances[2]))
    .toEqual(expect.objectContaining({
      state: "suspended",
      resumeCalls: 1,
    }));
  await sound.click();
  await expect(sound).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(() => page.evaluate(() => window.__AUDIO_TEST__.snapshot().instances[2].closeCalls))
    .toBe(1);
  expect(errors).toEqual([]);
});

test("short settings dialog stays fixed and contains its own scroll", async ({ page }, testInfo) => {
  test.skip(!runsStaticEdgeChecks(testInfo), "Cross-engine short dialog check");
  await page.setViewportSize(isWebKitProject(testInfo) ? { width: 750, height: 342 } : { width: 852, height: 393 });
  const errors = await openStory(page);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState("field"));
  const beforeY = await page.evaluate(() => scrollY);
  await page.getByRole("button", { name: "Open experience settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Tune the light" });
  await expect(dialog).toBeVisible();

  const layout = await dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      position: style.position,
      overscrollY: style.overscrollBehaviorY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(layout.position).toBe("fixed");
  expect(layout.overscrollY).toBe("contain");
  expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(beforeY, 0);

  const box = await dialog.boundingBox();
  if (isWebKitProject(testInfo)) {
    await dialog.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  } else {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 2_000);
    await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await page.mouse.wheel(0, 2_000);
  }
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(beforeY, 0);
  await page.evaluate(() => document.querySelector("#settingsDialog").close());
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(beforeY, 0);
  expect(errors).toEqual([]);
});

test("mobile touch targets and fixed chrome fit the viewport", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "Mobile-only geometry check");
  const errors = await openStory(page);

  const geometry = await page.evaluate(() => {
    const selectors = [
      ".topbar a",
      ".topbar button",
      ".story-dock button",
      ".primary-action",
      ".social-actions a",
      ".github-ribbon",
      ".text-button",
    ];
    const targets = Array.from(document.querySelectorAll(selectors.join(",")))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name: element.getAttribute("aria-label") || element.textContent.trim().slice(0, 32),
          width: rect.width,
          height: rect.height,
        };
      })
      .filter(({ width, height }) => width > 0 && height > 0);
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    const dock = document.querySelector(".story-dock").getBoundingClientRect();
    return {
      targets,
      topbar: [topbar.left, topbar.top, topbar.right, topbar.bottom],
      dock: [dock.left, dock.top, dock.right, dock.bottom],
      dockTouchAction: getComputedStyle(document.querySelector(".story-dock")).touchAction,
      trackTouchAction: getComputedStyle(document.querySelector(".dock-track")).touchAction,
      puckTouchAction: getComputedStyle(document.querySelector(".dock-puck")).touchAction,
      viewport: [innerWidth, innerHeight],
    };
  });

  for (const target of geometry.targets) {
    expect(target.height, `${target.name} height`).toBeGreaterThanOrEqual(44);
    expect(target.width, `${target.name} width`).toBeGreaterThanOrEqual(44);
  }
  expect(geometry.topbar[0]).toBeGreaterThanOrEqual(0);
  expect(geometry.topbar[2]).toBeLessThanOrEqual(geometry.viewport[0]);
  expect(geometry.dock[0]).toBeGreaterThanOrEqual(0);
  expect(geometry.dock[2]).toBeLessThanOrEqual(geometry.viewport[0]);
  expect(geometry.dock[3]).toBeLessThanOrEqual(geometry.viewport[1]);
  expect(geometry.dockTouchAction).toBe("pan-y");
  expect(geometry.trackTouchAction).toBe("pan-y");
  expect(geometry.puckTouchAction).toBe("none");

  const startX = geometry.viewport[0] / 2;
  if (isWebKitProject(testInfo)) {
    const tapY = Math.min(geometry.dock[1] - 80, geometry.viewport[1] / 2);
    await page.touchscreen.tap(startX, tapY);
    await expect(page.locator(".gesture-ripple")).toBeVisible();
    await page.locator(".gesture-ripple").waitFor({ state: "detached" });
  } else {
    const cdp = await page.context().newCDPSession(page);
    const startY = (geometry.dock[1] + geometry.dock[3]) / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY }],
    });
    for (let step = 1; step <= 5; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: startX, y: startY - step * 70 }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
  }
  await expect
    .poll(() => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().input.pressed))
    .toBe(false);

  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__.setState("contact");
    window.__THREE_GAME_TEST_HOOKS__.showStatus();
  });
  await expect(page.locator("#chapterName")).toHaveText("Open channel");
  await expect(page.locator("#storyToast")).toBeVisible();
  await expect
    .poll(() => page.locator(".story-status").evaluate((element) => Number(getComputedStyle(element).opacity)))
    .toBeLessThan(0.05);

  const contactFit = await page.evaluate(() => {
    const social = document.querySelector(".social-actions").getBoundingClientRect();
    const footer = document.querySelector("footer");
    const footerRect = footer.getBoundingClientRect();
    const dock = document.querySelector(".story-dock").getBoundingClientRect();
    const footerVisible = getComputedStyle(footer).display !== "none";
    return {
      socialDockGap: dock.top - social.bottom,
      socialFooterOverlap: footerVisible
        ? Math.max(0, Math.min(social.bottom, footerRect.bottom) - Math.max(social.top, footerRect.top))
        : 0,
      footerDockOverlap: footerVisible
        ? Math.max(0, Math.min(footerRect.bottom, dock.bottom) - Math.max(footerRect.top, dock.top))
        : 0,
    };
  });
  expect(contactFit.socialDockGap).toBeGreaterThanOrEqual(16);
  expect(contactFit.socialFooterOverlap).toBe(0);
  expect(contactFit.footerDockOverlap).toBe(0);
  expect(errors).toEqual([]);
});

test("mobile WebKit survives dynamic browser chrome viewport changes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-webkit", "iPhone dynamic viewport check");
  const errors = await openStory(page);

  for (const height of [600, 780, 664]) {
    await page.setViewportSize({ width: 390, height });
    await expect
      .poll(() => page.locator("#storyCanvas").evaluate((element) => element.getBoundingClientRect().height))
      .toBe(height);
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState("contact"));
    await expect(page.locator("#chapterName")).toHaveText("Open channel");

    const fit = await page.evaluate(() => {
      const canvas = document.querySelector("#storyCanvas").getBoundingClientRect();
      const dock = document.querySelector(".story-dock").getBoundingClientRect();
      const social = document.querySelector(".social-actions").getBoundingClientRect();
      const footer = document.querySelector("footer");
      const footerRect = footer.getBoundingClientRect();
      const footerVisible = getComputedStyle(footer).display !== "none";
      return {
        viewport: [innerWidth, innerHeight],
        canvas: [canvas.width, canvas.height],
        dock: [dock.left, dock.top, dock.right, dock.bottom],
        socialDockGap: dock.top - social.bottom,
        footerDockOverlap: footerVisible
          ? Math.max(0, Math.min(footerRect.bottom, dock.bottom) - Math.max(footerRect.top, dock.top))
          : 0,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(fit.viewport).toEqual([390, height]);
    expect(fit.canvas).toEqual([390, height]);
    expect(fit.dock[0]).toBeGreaterThanOrEqual(0);
    expect(fit.dock[2]).toBeLessThanOrEqual(390);
    expect(fit.dock[3]).toBeLessThanOrEqual(height);
    expect(fit.socialDockGap).toBeGreaterThanOrEqual(16);
    expect(fit.footerDockOverlap).toBe(0);
    expect(fit.scrollWidth).toBe(390);
  }
  expect(errors).toEqual([]);
});

test("short landscape keeps active story content between fixed chrome", async ({ page }, testInfo) => {
  test.skip(!runsStaticEdgeChecks(testInfo), "Cross-engine landscape geometry check");
  await page.setViewportSize(isWebKitProject(testInfo) ? { width: 750, height: 342 } : { width: 852, height: 393 });
  const errors = await openStory(page);
  const fit = await page.evaluate(() => {
    const name = document.querySelector(".hero-copy h1").getBoundingClientRect();
    const dock = document.querySelector(".story-dock").getBoundingClientRect();
    const stage = document.querySelector(".hero-stage").getBoundingClientRect();
    return {
      nameBottom: name.bottom,
      dockTop: dock.top,
      stageHeight: stage.height,
      viewportHeight: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  });
  expect(fit.nameBottom).toBeLessThan(fit.dockTop);
  expect(fit.stageHeight).toBe(fit.viewportHeight);
  expect(fit.scrollWidth).toBe(fit.viewportWidth);

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState("trajectory"));
  await expect(page.locator("#chapterName")).toHaveText("Trajectory");
  const trajectoryFit = await page.evaluate(() => {
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    const active = document.querySelector(".journey-stop.is-active");
    const meta = active.querySelector(".stop-meta").getBoundingClientRect();
    const title = active.querySelector("h3").getBoundingClientRect();
    return {
      topbarBottom: topbar.bottom,
      metaTop: meta.top,
      titleTop: title.top,
    };
  });
  expect(trajectoryFit.metaTop).toBeGreaterThanOrEqual(trajectoryFit.topbarBottom);
  expect(trajectoryFit.titleTop).toBeGreaterThanOrEqual(trajectoryFit.topbarBottom);

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState("craft"));
  await expect(page.locator("#chapterName")).toHaveText("Craft");
  const craftFit = await page.evaluate(() => {
    const dock = document.querySelector(".story-dock").getBoundingClientRect();
    const paragraph = document.querySelector(".skill-cluster.is-active > p:last-child").getBoundingClientRect();
    return {
      paragraphBottom: paragraph.bottom,
      dockTop: dock.top,
    };
  });
  expect(craftFit.paragraphBottom).toBeLessThanOrEqual(craftFit.dockTop);
  expect(errors).toEqual([]);
});

test("compact portrait conducts card content and keeps contact clear", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const errors = await openStory(page);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState("contact"));
  const fit = await page.evaluate(() => {
    const social = document.querySelector(".social-actions").getBoundingClientRect();
    const dock = document.querySelector(".story-dock").getBoundingClientRect();
    const skip = document.querySelector(".skip-link").getBoundingClientRect();
    return {
      gap: dock.top - social.bottom,
      footerDisplay: getComputedStyle(document.querySelector("footer")).display,
      skipHeight: skip.height,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  });
  expect(fit.gap).toBeGreaterThanOrEqual(16);
  expect(fit.footerDisplay).toBe("none");
  expect(fit.skipHeight).toBeGreaterThanOrEqual(44);
  expect(fit.scrollWidth).toBe(fit.viewportWidth);

  const setSignalProgress = (progress) =>
    page.evaluate((nextProgress) => {
      const chapter = document.querySelector(".chapter-signal");
      const range = Math.max(1, chapter.offsetHeight - innerHeight);
      window.scrollTo(0, chapter.offsetTop + range * nextProgress);
    }, progress);

  await setSignalProgress(0.08);
  const cardStart = await page.locator(".story-card").evaluate((element) => ({
    maxScroll: element.scrollHeight - element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollTop: element.scrollTop,
  }));
  expect(cardStart.maxScroll).toBeGreaterThan(100);
  expect(cardStart.overflowY).toBe("hidden");
  expect(cardStart.scrollTop).toBeLessThanOrEqual(1);

  if (testInfo.project.name === "mobile-chrome") {
    const card = await page.locator(".story-card").boundingBox();
    const beforeY = await page.evaluate(() => scrollY);
    const cdp = await page.context().newCDPSession(page);
    const startX = card.x + card.width / 2;
    const startY = card.y + card.height * 0.7;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY }],
    });
    for (let step = 1; step <= 4; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: startX, y: startY - step * 55 }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(beforeY + 80);
  }

  await setSignalProgress(0.92);
  await expect
    .poll(() =>
      page.locator(".story-card").evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("system Reduce Motion keeps every story item readable", async ({ page }, testInfo) => {
  test.skip(!runsStaticEdgeChecks(testInfo), "Cross-engine accessibility preference check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await openStory(page);
  await expect(page.locator("body")).toHaveClass(/motion-off/);
  await page.getByRole("button", { name: "Open experience settings" }).click();
  await expect(page.getByRole("dialog", { name: "Tune the light" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Motion" })).toHaveAttribute("aria-disabled", "true");

  const reducedLayout = await page.evaluate(() => {
    const stage = document.querySelector(".chapter-stage");
    const journey = Array.from(document.querySelectorAll(".journey-stop"));
    const skills = Array.from(document.querySelectorAll(".skill-cluster"));
    const principles = Array.from(document.querySelectorAll(".principle"));
    const journeyBox = document.querySelector(".journey").getBoundingClientRect();
    const firstStopBox = journey[0].getBoundingClientRect();
    const introBox = document.querySelector(".trajectory-intro").getBoundingClientRect();
    return {
      renderMode: document.body.dataset.renderMode,
      world: window.__THREE_GAME_TEST_HOOKS__.getState().world,
      stagePosition: getComputedStyle(stage).position,
      dockDisplay: getComputedStyle(document.querySelector(".story-dock")).display,
      journeyVisible: journey.every((element) => Number(getComputedStyle(element).opacity) > 0),
      skillsVisible: skills.every((element) => Number(getComputedStyle(element).opacity) > 0),
      principlesVisible: principles.every((element) => Number(getComputedStyle(element).opacity) > 0),
      firstStopInsideJourney: firstStopBox.top >= journeyBox.top,
      trajectoryGap: firstStopBox.top - introBox.bottom,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  });
  expect(reducedLayout.renderMode).toBe("css-reduced-motion");
  expect(reducedLayout.world).toBeNull();
  expect(reducedLayout.stagePosition).toBe("relative");
  expect(reducedLayout.dockDisplay).toBe("none");
  expect(reducedLayout.journeyVisible).toBe(true);
  expect(reducedLayout.skillsVisible).toBe(true);
  expect(reducedLayout.principlesVisible).toBe(true);
  expect(reducedLayout.firstStopInsideJourney).toBe(true);
  expect(reducedLayout.trajectoryGap).toBeGreaterThanOrEqual(0);
  expect(reducedLayout.scrollWidth).toBe(reducedLayout.viewportWidth);
  expect(errors).toEqual([]);
});

test("no-JavaScript fallback exposes the full profile without a loading veil", async ({ browser }, testInfo) => {
  test.skip(!runsStaticEdgeChecks(testInfo), "Cross-engine progressive-enhancement check");
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8788",
    javaScriptEnabled: false,
    viewport: { width: 320, height: 568 },
  });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "load" });

  await expect(page.locator(".load-veil")).toBeHidden();
  await expect(page.locator("#quick-profile")).toBeVisible();
  await expect(page.locator("#open-channel")).toContainText("Start a conversation");
  await expect(page.locator('a[href^="mailto:"]')).toBeVisible();
  const fallback = await page.evaluate(() => ({
    headings: document.querySelectorAll("main h2").length,
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
  }));
  expect(fallback.headings).toBe(5);
  expect(fallback.scrollWidth).toBe(fallback.viewportWidth);
  await context.close();
});

test("blocked storage fails open instead of trapping the loading veil", async ({ page }, testInfo) => {
  test.skip(!runsStaticEdgeChecks(testInfo), "Cross-engine hardened-browser check");
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem"]) {
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value() {
          throw new DOMException("Storage disabled", "SecurityError");
        },
      });
    }
  });
  const errors = await openStory(page);
  await expect(page.locator(".load-veil")).toBeHidden();
  await expect(page.locator("#quick-profile")).toBeVisible();
  expect(errors).toEqual([]);
});

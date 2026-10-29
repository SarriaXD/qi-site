const THREE_URL = "/vendor/three.module.min.js";

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
const smoothstep = (a, b, value) => {
  const t = clamp((value - a) / Math.max(0.00001, b - a));
  return t * t * (3 - 2 * t);
};

function createSeededRandom(seed = 0x51a771a) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const root = document.documentElement;
const body = document.body;
const revealStory = () => {
  body.classList.add("is-ready");
  body.classList.remove("is-loading");
};
body.classList.add("is-loading");
const failOpenTimer = setTimeout(revealStory, 1600);
const storyRoot = document.querySelector("#story");
const chapters = [...document.querySelectorAll(".chapter")];
const dockDots = [...document.querySelectorAll(".dock-dot")];
const dockTrack = document.querySelector("#dockTrack");
const dockPuck = document.querySelector("#dockPuck");
const dockProgress = document.querySelector("#dockProgress");
const dockCurrent = document.querySelector("#dockCurrent");
const chapterNumber = document.querySelector("#chapterNumber");
const chapterName = document.querySelector("#chapterName");
const memoryCount = document.querySelector("#memoryCount");
const resonanceLabel = document.querySelector("#resonanceLabel");
const toast = document.querySelector("#storyToast");
const gestureLayer = document.querySelector("#gestureLayer");
const glyphLayer = document.querySelector("#glyphLayer");
const settingsDialog = document.querySelector("#settingsDialog");
const settingsButton = document.querySelector("#settingsButton");
const motionToggle = document.querySelector("#motionToggle");
const soundToggle = document.querySelector("#soundToggle");
const materialToggle = document.querySelector("#materialToggle");
const resetButton = document.querySelector("#resetButton");
const replayButton = document.querySelector("#replayButton");
const journeyStops = [...document.querySelectorAll(".journey-stop")];
const journeyFill = document.querySelector("#journeyFill");
const skillClusters = [...document.querySelectorAll(".skill-cluster")];
const skillMeters = [...document.querySelectorAll(".craft-meter span")];
const principles = [...document.querySelectorAll(".principle")];
const storyCard = document.querySelector(".story-card");
const canvas = document.querySelector("#storyCanvas");

const systemReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const systemReducedTransparency = matchMedia("(prefers-reduced-transparency: reduce)");
const saveData = Boolean(navigator.connection?.saveData);
const coarsePointer = matchMedia("(pointer: coarse)").matches;
const runtimeParams = new URLSearchParams(location.search);
const localRuntime = location.hostname === "127.0.0.1" || location.hostname === "localhost";
const testEnabled = localRuntime && runtimeParams.has("test");
const debugEnabled = localRuntime && (runtimeParams.has("debug") || testEnabled);

const chapterPalette = [
  ["#73e7ff", "#a99cff"],
  ["#91f2e4", "#73e7ff"],
  ["#7fb8ff", "#b093ff"],
  ["#73e7ff", "#8dffd6"],
  ["#b5a3ff", "#73e7ff"],
  ["#ff9ac8", "#a99cff"],
];

const story = {
  geometry: [],
  scrollY: scrollY,
  previousY: scrollY,
  rawVelocity: 0,
  velocity: 0,
  energy: 0,
  direction: 1,
  activeIndex: 0,
  previousActiveIndex: 0,
  localProgress: 0,
  totalProgress: 0,
  maxScroll: 1,
  anchors: [],
  resizeQueued: false,
};

const input = {
  x: innerWidth * 0.5,
  y: innerHeight * 0.35,
  targetX: innerWidth * 0.5,
  targetY: innerHeight * 0.35,
  nx: 0,
  ny: 0,
  velocityX: 0,
  velocityY: 0,
  pressure: 0,
  pressed: false,
  pointerId: null,
  pointerType: "mouse",
  keyPulse: 0,
  lastPointerAt: performance.now(),
};

function readPreference(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in hardened or private browsing contexts.
  }
}

const prefs = {
  motion: !systemReducedMotion.matches && readPreference("qi-motion") !== "off",
  sound: false,
  glass: !systemReducedTransparency.matches && readPreference("qi-glass") !== "off",
  systemReduced: systemReducedMotion.matches,
  systemReducedTransparency: systemReducedTransparency.matches,
};

const game = {
  awake: new Set(),
  burst: 0,
};

try {
  const saved = JSON.parse(sessionStorage.getItem("qi-memory-nodes") || "[]");
  saved.forEach((value) => {
    if (Number.isInteger(value) && value >= 0 && value < chapters.length) game.awake.add(value);
  });
} catch {
  // Session storage is optional; the experience remains fully functional without it.
}

let audioContext = null;
let world3d = null;
let threeLoading = false;
let rafId = 0;
let lastFrameAt = performance.now();
let elapsed = 0;
let lastActivityAt = performance.now();
let toastTimer = 0;
let geometryObserver = null;
let scrollSpring = null;
let frameCounter = 0;

body.classList.add("is-enhanced");
body.classList.toggle("motion-off", !prefs.motion);
body.classList.toggle("solid-materials", !prefs.glass);
body.dataset.renderMode = "css";
motionToggle.classList.toggle("is-on", prefs.motion);
motionToggle.setAttribute("aria-checked", String(prefs.motion));
materialToggle.classList.toggle("is-on", prefs.glass);
materialToggle.setAttribute("aria-checked", String(prefs.glass));

if (prefs.systemReduced) {
  motionToggle.setAttribute("aria-disabled", "true");
  motionToggle.title = "Your system Reduce Motion preference is active";
}

if (prefs.systemReducedTransparency) {
  materialToggle.setAttribute("aria-disabled", "true");
  materialToggle.title = "Your system Reduce Transparency preference is active";
}

function markActivity() {
  lastActivityAt = performance.now();
}

function wake() {
  markActivity();
  if (!rafId && !document.hidden) {
    lastFrameAt = performance.now();
    rafId = requestAnimationFrame(frame);
  }
}

function springStep(spring, target, dt, response = 0.38, dampingRatio = 1) {
  const omega = (Math.PI * 2) / response;
  const acceleration =
    omega * omega * (target - spring.value) -
    2 * dampingRatio * omega * spring.velocity;
  spring.velocity += acceleration * dt;
  spring.value += spring.velocity * dt;
}

function persistMemory() {
  try {
    sessionStorage.setItem("qi-memory-nodes", JSON.stringify([...game.awake]));
  } catch {
    // Private browsing can reject storage writes.
  }
}

function showToast(message, duration = 1900) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  document.body.classList.add("toast-visible");
  toastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
    document.body.classList.remove("toast-visible");
  }, duration);
}

function getAudioContext() {
  if (!prefs.sound || document.hidden) return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext || audioContext.state === "closed") {
    try {
      audioContext = new AudioContextClass();
    } catch {
      audioContext = null;
    }
  }
  return audioContext;
}

async function ensureAudioRunning() {
  const context = getAudioContext();
  if (!context) return null;
  try {
    if (context.state !== "running") await context.resume();
  } catch {
    if (audioContext === context && context.state === "closed") audioContext = null;
    return null;
  }
  return (
    context === audioContext &&
    prefs.sound &&
    !document.hidden &&
    context.state === "running"
  ) ? context : null;
}

function retireAudioContext() {
  const staleContext = audioContext;
  audioContext = null;
  if (!staleContext || staleContext.state === "closed") return;
  try {
    const closeResult = staleContext.close();
    closeResult?.catch?.(() => {});
  } catch {
    // Safari can throw while an audio interruption is being torn down.
  }
}

async function playTone(index, emphasis = false) {
  const context = await ensureAudioRunning();
  if (!context) return;
  try {
    const now = context.currentTime;
    const frequencies = [261.63, 329.63, 392, 493.88, 587.33, 659.25];
    const oscillator = context.createOscillator();
    const overtone = context.createOscillator();
    const gain = context.createGain();
    const overtoneGain = context.createGain();

    oscillator.type = "sine";
    overtone.type = "triangle";
    oscillator.frequency.value = frequencies[index % frequencies.length];
    overtone.frequency.value = oscillator.frequency.value * 2.01;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(emphasis ? 0.055 : 0.028, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (emphasis ? 0.72 : 0.42));
    overtoneGain.gain.value = 0.16;
    oscillator.connect(gain).connect(context.destination);
    overtone.connect(overtoneGain).connect(gain);
    oscillator.start(now);
    overtone.start(now);
    oscillator.stop(now + 0.78);
    overtone.stop(now + 0.78);
  } catch {
    // Audio feedback is optional; interruption must never break the story.
  }
}

function updateMemoryUI() {
  const count = game.awake.size;
  memoryCount.textContent = String(count);
  const labels = ["river asleep", "first light", "signal found", "river forming", "current rising", "almost awake", "river awake"];
  resonanceLabel.textContent = labels[count] || labels.at(-1);
  dockDots.forEach((dot, index) => dot.classList.toggle("is-awake", game.awake.has(index)));
}

function awakenChapter(index, announce = true) {
  if (game.awake.has(index)) return;
  game.awake.add(index);
  game.burst = Math.min(1, game.burst + 0.72);
  persistMemory();
  updateMemoryUI();
  world3d?.burst(index);
  void playTone(index, game.awake.size === chapters.length);

  if (announce) {
    const name = chapters[index]?.dataset.name || "Memory";
    const complete = game.awake.size === chapters.length;
    showToast(complete ? "All six memories awake · the river remembers ♥" : `${String(index).padStart(2, "0")} · ${name} memory awake`, complete ? 3200 : 1800);
    if (complete && navigator.vibrate) navigator.vibrate([12, 28, 18]);
  }
}

function resetMemory({ announce = true } = {}) {
  game.awake.clear();
  game.burst = 0;
  persistMemory();
  updateMemoryUI();
  world3d?.reset();
  if (announce) showToast("Memory river reset");
  wake();
}

function restartStory(message) {
  cancelScrollSpring();
  const firstY = sectionTargetY(0);
  window.scrollTo(0, firstY);
  story.scrollY = firstY;
  story.previousY = firstY;
  story.rawVelocity = 0;
  story.velocity = 0;
  story.energy = 0;
  story.activeIndex = 0;
  story.previousActiveIndex = 0;
  resetMemory({ announce: false });
  awakenChapter(0, false);
  showToast(message);
  wake();
}

function measureStory() {
  story.geometry = chapters.map((element) => ({
    element,
    top: element.offsetTop,
    height: element.offsetHeight,
  }));
  story.maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  story.anchors = story.geometry.map((geometry) => clamp(geometry.top, 0, story.maxScroll));
  measureDock();
  story.resizeQueued = false;
  wake();
}

function queueMeasure() {
  if (story.resizeQueued) return;
  story.resizeQueued = true;
  requestAnimationFrame(measureStory);
}

function chapterProgressFor(geometry, currentY = story.scrollY) {
  const range = Math.max(1, geometry.height - innerHeight);
  return clamp((currentY - geometry.top) / range);
}

function setActiveItem(items, activeIndex) {
  items.forEach((item, index) => {
    item.classList.toggle("is-active", index === activeIndex);
    item.classList.toggle("is-past", index < activeIndex);
  });
}

function updateChapterDOM() {
  story.geometry.forEach((geometry, index) => {
    const progress = chapterProgressFor(geometry);
    const isHero = index === 0;
    const enter = isHero
      ? 1 - smoothstep(0.56, 0.96, progress)
      : smoothstep(0.015, 0.17, progress) * (1 - smoothstep(0.88, 0.995, progress));
    const enterY = (1 - enter) * 32;
    const introY = enter * -32;

    geometry.element.style.setProperty("--p", progress.toFixed(4));
    geometry.element.style.setProperty("--chapter-progress", progress.toFixed(4));
    geometry.element.style.setProperty("--enter", enter.toFixed(4));
    geometry.element.style.setProperty("--enter-y", `${enterY.toFixed(2)}px`);
    geometry.element.style.setProperty("--intro-y", `${introY.toFixed(2)}px`);
    geometry.element.style.setProperty("--portrait-opacity", (0.7 + enter * 0.3).toFixed(4));
    geometry.element.style.setProperty("--portrait-y", `${((1 - enter) * 24).toFixed(2)}px`);
    geometry.element.style.setProperty("--portrait-scale", (0.96 + enter * 0.04).toFixed(4));
    geometry.element.style.setProperty("--enter-scale", (0.82 + enter * 0.18).toFixed(4));
    geometry.element.style.setProperty("--heart-scale", (0.8 + enter * 0.2).toFixed(4));
    geometry.element.style.setProperty("--p-shift-a", `${((progress - 0.5) * 60).toFixed(2)}px`);
    geometry.element.style.setProperty("--p-shift-b", `${((0.5 - progress) * 72).toFixed(2)}px`);

    if (index === 1 && storyCard) {
      const cardRange = Math.max(0, storyCard.scrollHeight - storyCard.clientHeight);
      const cardProgress = smoothstep(0.08, 0.92, progress);
      const edgeLead =
        Math.min(8, cardRange * 0.03) *
        4 *
        cardProgress *
        (1 - cardProgress);
      storyCard.scrollTop = Math.min(cardRange, cardRange * cardProgress + edgeLead);
    }

    if (index === 2) {
      const timelineProgress = clamp((progress - 0.08) / 0.82);
      const stopIndex = Math.min(journeyStops.length - 1, Math.floor(timelineProgress * journeyStops.length));
      setActiveItem(journeyStops, stopIndex);
      geometry.element.style.setProperty("--journey-progress", `${(timelineProgress * 100).toFixed(2)}%`);
      if (journeyFill) journeyFill.style.height = `${(timelineProgress * 100).toFixed(2)}%`;
    }

    if (index === 3) {
      const craftProgress = clamp((progress - 0.08) / 0.82);
      const skillIndex = Math.min(skillClusters.length - 1, Math.floor(craftProgress * skillClusters.length));
      setActiveItem(skillClusters, skillIndex);
      setActiveItem(skillMeters, skillIndex);
    }

    if (index === 4) {
      const fieldProgress = clamp((progress - 0.1) / 0.8);
      const principleIndex = Math.min(principles.length - 1, Math.floor(fieldProgress * principles.length));
      setActiveItem(principles, principleIndex);
    }
  });
}

function updateStoryState(dt) {
  const currentY = scrollY;
  const deltaY = currentY - story.previousY;
  story.rawVelocity = deltaY / Math.max(0.008, dt);
  story.velocity = damp(story.velocity, story.rawVelocity, deltaY === 0 ? 9 : 15, dt);
  story.energy = damp(story.energy, clamp(Math.abs(story.velocity) / 1900), deltaY === 0 ? 4.6 : 11, dt);
  if (Math.abs(story.velocity) > 4) story.direction = Math.sign(story.velocity);
  story.previousY = currentY;
  story.scrollY = currentY;
  story.totalProgress = clamp(currentY / story.maxScroll);

  const focusY = currentY + innerHeight * 0.48;
  let activeIndex = 0;
  for (let index = 0; index < story.geometry.length; index += 1) {
    if (focusY >= story.geometry[index].top) activeIndex = index;
  }
  activeIndex = Math.min(chapters.length - 1, activeIndex);
  const previousActiveIndex = story.activeIndex;
  story.previousActiveIndex = previousActiveIndex;
  story.activeIndex = activeIndex;
  story.localProgress = chapterProgressFor(story.geometry[activeIndex] || { top: 0, height: innerHeight });

  if (activeIndex !== previousActiveIndex) {
    const step = activeIndex > previousActiveIndex ? 1 : -1;
    for (
      let crossedIndex = previousActiveIndex + step;
      step > 0 ? crossedIndex <= activeIndex : crossedIndex >= activeIndex;
      crossedIndex += step
    ) {
      awakenChapter(crossedIndex, crossedIndex === activeIndex);
    }
  }

  const accent = chapterPalette[activeIndex][0];
  root.style.setProperty("--chapter-accent", accent);
  root.style.setProperty("--story-progress", story.totalProgress.toFixed(4));
  root.style.setProperty("--scroll-energy", story.energy.toFixed(4));
  root.style.setProperty("--energy-opacity", (0.2 + story.energy * 0.16).toFixed(4));
  root.style.setProperty("--light-alpha", (0.08 + story.energy * 0.04).toFixed(4));
  root.style.setProperty("--halo-scale", (0.94 + story.energy * 0.08).toFixed(4));
  root.style.setProperty("--pointer-x", `${((input.x / innerWidth) * 100).toFixed(2)}%`);
  root.style.setProperty("--pointer-y", `${((input.y / innerHeight) * 100).toFixed(2)}%`);
  root.style.setProperty("--pointer-shift-x", `${(input.nx * 14).toFixed(2)}px`);
  root.style.setProperty("--pointer-shift-y", `${(input.ny * 10).toFixed(2)}px`);
  root.style.setProperty("--pointer-shift-x-neg", `${(input.nx * -11).toFixed(2)}px`);
  root.style.setProperty("--pointer-shift-y-neg", `${(input.ny * -8).toFixed(2)}px`);

  updateChapterDOM();
  updateDock(dt);

  const paddedIndex = String(activeIndex).padStart(2, "0");
  const activeName = chapters[activeIndex]?.dataset.name || "Arrival";
  chapterNumber.textContent = paddedIndex;
  chapterName.textContent = activeName;
  dockCurrent.textContent = activeName;
  body.dataset.chapter = String(activeIndex);
  dockPuck.setAttribute("aria-valuenow", String(activeIndex));
  dockPuck.setAttribute("aria-valuetext", activeName);
  dockDots.forEach((dot, index) => {
    dot.classList.toggle("is-active", index === activeIndex);
    if (index === activeIndex) dot.setAttribute("aria-current", "step");
    else dot.removeAttribute("aria-current");
  });

  if (activeIndex === 0 || story.localProgress > 0.045) awakenChapter(activeIndex);
}

function updateInput(dt) {
  input.x = damp(input.x, input.targetX, prefs.motion ? 18 : 100, dt);
  input.y = damp(input.y, input.targetY, prefs.motion ? 18 : 100, dt);
  input.nx = clamp((input.x / innerWidth) * 2 - 1, -1, 1);
  input.ny = clamp(1 - (input.y / innerHeight) * 2, -1, 1);
  input.velocityX = damp(input.velocityX, 0, 7, dt);
  input.velocityY = damp(input.velocityY, 0, 7, dt);
  input.keyPulse = damp(input.keyPulse, 0, 5.5, dt);
  game.burst = damp(game.burst, 0, 4, dt);
}

const tiltStates = new Map();

function createTiltState(element) {
  const state = {
    element,
    active: false,
    pointerId: null,
    targetX: 0,
    targetY: 0,
    tiltX: { value: 0, velocity: 0 },
    tiltY: { value: 0, velocity: 0 },
    liftX: { value: 0, velocity: 0 },
    liftY: { value: 0, velocity: 0 },
  };
  tiltStates.set(element, state);
  return state;
}

function updateTiltTarget(state, event) {
  const rect = state.element.getBoundingClientRect();
  const x = clamp((event.clientX - rect.left) / Math.max(1, rect.width));
  const y = clamp((event.clientY - rect.top) / Math.max(1, rect.height));
  state.targetX = x * 2 - 1;
  state.targetY = y * 2 - 1;
}

document.querySelectorAll("[data-tilt]").forEach((element) => {
  const state = createTiltState(element);

  element.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") {
      state.active = true;
      updateTiltTarget(state, event);
      wake();
    }
  });

  element.addEventListener("pointerdown", (event) => {
    state.active = true;
    state.pointerId = event.pointerId;
    updateTiltTarget(state, event);
    if (event.pointerType !== "touch" && element.setPointerCapture) {
      element.setPointerCapture(event.pointerId);
    }
    wake();
  });

  element.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse" || state.pointerId === event.pointerId) {
      state.active = true;
      updateTiltTarget(state, event);
      wake();
    }
  });

  const release = (event) => {
    if (event.pointerType === "mouse" && event.type === "pointerleave") state.active = false;
    if (state.pointerId === event.pointerId || event.type === "lostpointercapture") {
      state.pointerId = null;
      state.active = false;
    }
    wake();
  };

  element.addEventListener("pointerleave", release);
  element.addEventListener("pointerup", release);
  element.addEventListener("pointercancel", release);
  element.addEventListener("lostpointercapture", release);
});

function updateTilts(dt) {
  let moving = false;
  tiltStates.forEach((state) => {
    const tx = state.active && prefs.motion ? state.targetX : 0;
    const ty = state.active && prefs.motion ? state.targetY : 0;
    springStep(state.tiltX, ty * -3.2, dt, 0.4, 1);
    springStep(state.tiltY, tx * 4.2, dt, 0.4, 1);
    springStep(state.liftX, tx * 5.5, dt, 0.38, 1);
    springStep(state.liftY, ty * 4.5, dt, 0.38, 1);
    state.element.style.setProperty("--tilt-x", `${state.tiltX.value.toFixed(3)}deg`);
    state.element.style.setProperty("--tilt-y", `${state.tiltY.value.toFixed(3)}deg`);
    state.element.style.setProperty("--lift-x", `${state.liftX.value.toFixed(3)}px`);
    state.element.style.setProperty("--lift-y", `${state.liftY.value.toFixed(3)}px`);
    moving ||= Math.abs(state.tiltX.velocity) + Math.abs(state.tiltY.velocity) > 0.02;
  });
  return moving;
}

const puck = {
  centers: [],
  first: 0,
  last: 1,
  position: { value: 0, velocity: 0 },
  dragging: false,
  pointerId: null,
  grabOffset: 0,
  history: [],
};

function dockRatioForScrollY(scrollPosition = story.scrollY) {
  const anchors = story.anchors;
  if (anchors.length < 2) return story.totalProgress;
  if (scrollPosition <= anchors[0]) return 0;
  if (scrollPosition >= anchors.at(-1)) return 1;

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors[index];
    const end = anchors[index + 1];
    if (scrollPosition <= end) {
      const local = clamp((scrollPosition - start) / Math.max(1, end - start));
      return (index + local) / (anchors.length - 1);
    }
  }
  return 1;
}

function scrollYForDockRatio(ratio) {
  const anchors = story.anchors;
  if (anchors.length < 2) return clamp(ratio) * story.maxScroll;
  const scaled = clamp(ratio) * (anchors.length - 1);
  const index = Math.min(anchors.length - 2, Math.floor(scaled));
  return lerp(anchors[index], anchors[index + 1], scaled - index);
}

function measureDock() {
  if (!dockTrack) return;
  const trackRect = dockTrack.getBoundingClientRect();
  puck.centers = dockDots.map((dot) => {
    const rect = dot.getBoundingClientRect();
    return rect.left - trackRect.left + rect.width * 0.5;
  });
  puck.first = puck.centers[0] ?? 0;
  puck.last = puck.centers.at(-1) ?? trackRect.width;
  if (!puck.dragging) {
    puck.position.value = lerp(puck.first, puck.last, dockRatioForScrollY());
    puck.position.velocity = 0;
  }
}

function updateDock(dt) {
  if (!puck.centers.length) return;
  if (!puck.dragging) {
    const target = lerp(puck.first, puck.last, dockRatioForScrollY());
    springStep(puck.position, target, dt, 0.36, 1);
  }
  const position = clamp(puck.position.value, puck.first, puck.last);
  dockPuck.style.left = `${position.toFixed(2)}px`;
  dockProgress.style.width = `${Math.max(0, position - puck.first).toFixed(2)}px`;
}

function projectVelocity(velocity, decelerationRate = 0.99) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}

function sectionTargetY(index) {
  const geometry = story.geometry[index];
  if (!geometry) return 0;
  return clamp(geometry.top, 0, story.maxScroll);
}

function startScrollSpring(targetY, initialVelocity = 0) {
  scrollSpring = {
    target: clamp(targetY, 0, story.maxScroll),
    position: scrollY,
    velocity: clamp(initialVelocity, -6200, 6200),
  };
  wake();
}

function cancelScrollSpring() {
  scrollSpring = null;
}

function updateScrollSpring(dt) {
  if (!scrollSpring) return false;
  const omega = (Math.PI * 2) / 0.46;
  const acceleration =
    omega * omega * (scrollSpring.target - scrollSpring.position) -
    2 * 0.88 * omega * scrollSpring.velocity;
  scrollSpring.velocity += acceleration * dt;
  scrollSpring.position += scrollSpring.velocity * dt;
  window.scrollTo(0, clamp(scrollSpring.position, 0, story.maxScroll));
  if (
    Math.abs(scrollSpring.target - scrollSpring.position) < 0.7 &&
    Math.abs(scrollSpring.velocity) < 7
  ) {
    window.scrollTo(0, scrollSpring.target);
    scrollSpring = null;
  }
  return true;
}

function scrollToChapter(index, initialVelocity = null) {
  const target = sectionTargetY(index);
  if (!prefs.motion) {
    window.scrollTo(0, target);
    return;
  }
  const inheritedVelocity = initialVelocity ?? scrollSpring?.velocity ?? story.velocity;
  startScrollSpring(target, inheritedVelocity);
}

function dragPuckTo(clientX, timestamp) {
  const rect = dockTrack.getBoundingClientRect();
  const x = clamp(clientX - rect.left - puck.grabOffset, puck.first, puck.last);
  puck.position.value = x;
  puck.position.velocity = 0;
  puck.history.push({ x, t: timestamp });
  if (puck.history.length > 6) puck.history.shift();
  const ratio = clamp((x - puck.first) / Math.max(1, puck.last - puck.first));
  window.scrollTo(0, scrollYForDockRatio(ratio));
}

dockPuck.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  cancelScrollSpring();
  puck.dragging = true;
  puck.pointerId = event.pointerId;
  const trackRect = dockTrack.getBoundingClientRect();
  puck.grabOffset = event.clientX - trackRect.left - puck.position.value;
  puck.history = [];
  dockPuck.classList.add("is-dragging");
  dockPuck.setPointerCapture(event.pointerId);
  dragPuckTo(event.clientX, event.timeStamp);
  wake();
});

dockPuck.addEventListener("pointermove", (event) => {
  if (!puck.dragging || puck.pointerId !== event.pointerId) return;
  if (event.pointerType === "mouse" && event.buttons === 0) {
    finishPuckDrag(event);
    return;
  }
  event.preventDefault();
  dragPuckTo(event.clientX, event.timeStamp);
  wake();
});

function finishPuckDrag(event) {
  if (!puck.dragging || (event.pointerId != null && puck.pointerId !== event.pointerId)) return;
  const history = puck.history;
  let velocity = 0;
  if (history.length > 1) {
    const first = history[0];
    const last = history.at(-1);
    velocity = ((last.x - first.x) / Math.max(8, last.t - first.t)) * 1000;
  }
  const projected = clamp(puck.position.value + projectVelocity(velocity), puck.first, puck.last);
  let nearest = 0;
  let nearestDistance = Infinity;
  puck.centers.forEach((center, index) => {
    const distance = Math.abs(center - projected);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  });
  const projectedRatio = clamp((projected - puck.first) / Math.max(1, puck.last - puck.first));
  const ratioStep = 1 / Math.max(1, chapters.length - 1);
  const beforeY = scrollYForDockRatio(clamp(projectedRatio - ratioStep * 0.5));
  const afterY = scrollYForDockRatio(clamp(projectedRatio + ratioStep * 0.5));
  const scrollVelocity =
    velocity *
    ((afterY - beforeY) / Math.max(1, (puck.last - puck.first) * ratioStep));
  puck.dragging = false;
  puck.pointerId = null;
  puck.grabOffset = 0;
  puck.history = [];
  dockPuck.classList.remove("is-dragging");
  scrollToChapter(nearest, scrollVelocity);
  wake();
}

dockPuck.addEventListener("pointerup", finishPuckDrag);
dockPuck.addEventListener("pointercancel", finishPuckDrag);
dockPuck.addEventListener("lostpointercapture", finishPuckDrag);
addEventListener("pointerup", finishPuckDrag, { capture: true });
addEventListener("pointercancel", finishPuckDrag, { capture: true });
addEventListener("mouseup", finishPuckDrag, { capture: true });

dockPuck.addEventListener("keydown", (event) => {
  let next = story.activeIndex;
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= 1;
  else if (event.key === "ArrowRight" || event.key === "ArrowUp") next += 1;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = chapters.length - 1;
  else return;
  event.preventDefault();
  scrollToChapter(clamp(next, 0, chapters.length - 1));
});

dockDots.forEach((dot, index) => {
  dot.addEventListener("click", () => scrollToChapter(index));
});

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (event) => {
    const target = document.querySelector(anchor.getAttribute("href"));
    const index = chapters.indexOf(target);
    if (index < 0) return;
    event.preventDefault();
    scrollToChapter(index);
  });
});

function spawnRipple(x, y) {
  if (!prefs.motion) return;
  const ripple = document.createElement("i");
  ripple.className = "gesture-ripple";
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  gestureLayer.append(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
}

function spawnGlyph(character, x = input.x, y = input.y) {
  if (!prefs.motion) return;
  const glyph = document.createElement("span");
  glyph.className = "glyph-trace";
  glyph.textContent = character.toUpperCase();
  glyph.style.left = `${x}px`;
  glyph.style.top = `${y}px`;
  glyphLayer.append(glyph);
  glyph.addEventListener("animationend", () => glyph.remove(), { once: true });
}

function samplePointer(clientX, clientY, pressure = 0, pointerType = "mouse") {
  const now = performance.now();
  const dt = Math.max(8, now - input.lastPointerAt);
  input.velocityX = ((clientX - input.targetX) / dt) * 1000;
  input.velocityY = ((clientY - input.targetY) / dt) * 1000;
  input.targetX = clientX;
  input.targetY = clientY;
  input.pressure = pressure || (input.pressed ? 0.5 : 0);
  input.pointerType = pointerType;
  input.lastPointerAt = now;
  wake();
}

addEventListener(
  "pointermove",
  (event) => {
    samplePointer(event.clientX, event.clientY, event.pressure, event.pointerType || "mouse");
  },
  { passive: true },
);

addEventListener(
  "touchmove",
  (event) => {
    const touch = event.touches[0];
    if (!touch) return;
    samplePointer(touch.clientX, touch.clientY, touch.force || 0.5, "touch");
  },
  { passive: true },
);

addEventListener(
  "pointerdown",
  (event) => {
    if (prefs.sound) void ensureAudioRunning();
    input.pressed = true;
    input.pointerId = event.pointerId;
    input.targetX = event.clientX;
    input.targetY = event.clientY;
    input.pressure = event.pressure || 0.5;
    game.burst = Math.min(1, game.burst + 0.18);
    if (!event.target.closest("a, button, dialog")) spawnRipple(event.clientX, event.clientY);
    world3d?.pulse(event.clientX / innerWidth, event.clientY / innerHeight);
    wake();
  },
  { passive: true },
);

function releaseGlobalPointer(event) {
  if (input.pointerId != null && event.pointerId !== input.pointerId) return;
  input.pressed = false;
  input.pointerId = null;
  input.pressure = 0;
  wake();
}

addEventListener("pointerup", releaseGlobalPointer, { passive: true });
addEventListener("pointercancel", releaseGlobalPointer, { passive: true });

document.querySelectorAll(".pressable").forEach((element) => {
  const release = () => element.classList.remove("is-pressed");
  element.addEventListener("pointerdown", () => {
    element.classList.add("is-pressed");
    wake();
  });
  element.addEventListener("pointerup", release);
  element.addEventListener("pointercancel", release);
  element.addEventListener("pointerleave", release);
});

addEventListener("keydown", (event) => {
  const target = event.target;
  const editable =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable;

  if (
    editable ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.key.length !== 1 ||
    settingsDialog.open
  ) {
    return;
  }

  input.keyPulse = 1;
  game.burst = Math.min(1, game.burst + 0.34);
  const random = createSeededRandom(event.key.codePointAt(0) + Math.round(story.totalProgress * 1000));
  spawnGlyph(
    event.key,
    clamp(input.x + (random() - 0.5) * 80, 24, innerWidth - 24),
    clamp(input.y + (random() - 0.5) * 80, 70, innerHeight - 70),
  );
  void playTone((event.key.codePointAt(0) + story.activeIndex) % 6);
  world3d?.keyPulse(event.key.codePointAt(0));
  wake();
});

function clearInput() {
  input.pressed = false;
  input.pointerId = null;
  input.pressure = 0;
  input.velocityX = 0;
  input.velocityY = 0;
  tiltStates.forEach((state) => {
    state.active = false;
    state.pointerId = null;
  });
  if (puck.dragging) {
    puck.dragging = false;
    puck.pointerId = null;
    puck.grabOffset = 0;
    dockPuck.classList.remove("is-dragging");
  }
}

addEventListener("blur", clearInput);

addEventListener(
  "scroll",
  () => {
    if (!puck.dragging && scrollSpring && Math.abs(scrollY - scrollSpring.position) > 8) {
      cancelScrollSpring();
    }
    wake();
  },
  { passive: true },
);

addEventListener("wheel", cancelScrollSpring, { passive: true });
addEventListener("touchstart", (event) => {
  if (!event.target.closest("#dockPuck")) cancelScrollSpring();
}, { passive: true });

function applyMotionPreference() {
  body.classList.toggle("motion-off", !prefs.motion);
  motionToggle.classList.toggle("is-on", prefs.motion);
  motionToggle.setAttribute("aria-checked", String(prefs.motion));
  world3d?.setMotion(prefs.motion);
  if (prefs.motion && !world3d) initThree();
  if (!prefs.motion && !world3d) body.dataset.renderMode = "css-reduced-motion";
  queueMeasure();
  wake();
}

function applyMaterialPreference() {
  body.classList.toggle("solid-materials", !prefs.glass);
  materialToggle.classList.toggle("is-on", prefs.glass);
  materialToggle.setAttribute("aria-checked", String(prefs.glass));
}

settingsButton.addEventListener("click", () => {
  if (!settingsDialog.open) settingsDialog.showModal();
});

settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});

motionToggle.addEventListener("click", () => {
  if (prefs.systemReduced) {
    showToast("Reduce Motion is enabled in your system settings");
    return;
  }
  prefs.motion = !prefs.motion;
  writePreference("qi-motion", prefs.motion ? "on" : "off");
  applyMotionPreference();
  showToast(prefs.motion ? "Motion on" : "Motion paused");
});

soundToggle.addEventListener("click", () => {
  prefs.sound = !prefs.sound;
  soundToggle.classList.toggle("is-on", prefs.sound);
  soundToggle.setAttribute("aria-checked", String(prefs.sound));
  showToast(prefs.sound ? "Milestone tones on" : "Sound off");
  if (prefs.sound) void playTone(story.activeIndex);
  else retireAudioContext();
});

materialToggle.addEventListener("click", () => {
  if (prefs.systemReducedTransparency) {
    showToast("Reduce Transparency is enabled in your system settings");
    return;
  }
  prefs.glass = !prefs.glass;
  writePreference("qi-glass", prefs.glass ? "on" : "off");
  applyMaterialPreference();
  showToast(prefs.glass ? "Glass effects on" : "Solid materials on");
});

resetButton.addEventListener("click", () => {
  settingsDialog.close();
  restartStory("Memory river reset");
});

replayButton.addEventListener("click", () => {
  restartStory("Replaying from the first light");
});

systemReducedMotion.addEventListener("change", (event) => {
  prefs.systemReduced = event.matches;
  prefs.motion = !event.matches && readPreference("qi-motion") !== "off";
  motionToggle.setAttribute("aria-disabled", String(event.matches));
  applyMotionPreference();
});

systemReducedTransparency.addEventListener("change", (event) => {
  prefs.systemReducedTransparency = event.matches;
  prefs.glass = !event.matches && readPreference("qi-glass") !== "off";
  materialToggle.setAttribute("aria-disabled", String(event.matches));
  applyMaterialPreference();
});

addEventListener("resize", () => {
  input.targetX = clamp(input.targetX, 0, innerWidth);
  input.targetY = clamp(input.targetY, 0, innerHeight);
  queueMeasure();
  world3d?.resize();
});

addEventListener("orientationchange", queueMeasure);

document.addEventListener("visibilitychange", () => {
  clearInput();
  if (document.hidden) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    world3d?.pause();
    retireAudioContext();
  } else {
    world3d?.resume();
    lastFrameAt = performance.now();
    wake();
  }
});

addEventListener("pagehide", () => {
  clearInput();
  retireAudioContext();
});

addEventListener("pageshow", () => {
  if (document.hidden) return;
  queueMeasure();
  world3d?.resume();
  lastFrameAt = performance.now();
  wake();
});

function frame(now) {
  rafId = 0;
  frameCounter += 1;
  const dt = clamp((now - lastFrameAt) / 1000, 0.001, 0.034);
  lastFrameAt = now;
  elapsed += dt;

  const scrolling = updateScrollSpring(dt);
  updateInput(dt);
  updateStoryState(dt);
  const tiltsMoving = updateTilts(dt);

  if (prefs.motion) {
    world3d?.update(dt, elapsed, {
      story,
      input,
      game,
      motion: prefs.motion,
    });
  }

  const needsFrames =
    prefs.motion &&
    !document.hidden &&
    (
      scrolling ||
      puck.dragging ||
      input.pressed ||
      input.keyPulse > 0.008 ||
      story.energy > 0.004 ||
      game.burst > 0.005 ||
      tiltsMoving ||
      now - lastActivityAt < 2600
    );

  if (needsFrames) rafId = requestAnimationFrame(frame);
}

function makeParticleShapes(count, seed = 0x715a4) {
  const random = createSeededRandom(seed);
  const shapes = Array.from({ length: chapters.length }, () => new Float32Array(count * 3));
  const sizes = new Float32Array(count);
  const mixes = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    const i3 = index * 3;
    const r1 = random();
    const r2 = random();
    const r3 = random();
    const r4 = random();
    sizes[index] = 0.65 + r4 * 1.65;
    mixes[index] = r3;

    // Arrival: a quiet prairie aurora sweeping around the glass core.
    const arrivalAngle = r1 * Math.PI * 8 + r2 * 1.2;
    const arrivalRadius = 0.55 + Math.pow(r2, 0.62) * 4.8;
    shapes[0][i3] = Math.cos(arrivalAngle) * arrivalRadius;
    shapes[0][i3 + 1] = (r3 - 0.5) * 5.6 + Math.sin(arrivalAngle * 0.5) * 0.45;
    shapes[0][i3 + 2] = Math.sin(arrivalAngle) * arrivalRadius * 0.5 - 1.2;

    // Signal: a faceless human constellation, ready to align with Qi's real cutout.
    if (r1 < 0.2) {
      const angle = r2 * Math.PI * 2;
      const radius = Math.sqrt(r3) * 0.78;
      shapes[1][i3] = Math.cos(angle) * radius;
      shapes[1][i3 + 1] = 1.75 + Math.sin(angle) * radius;
      shapes[1][i3 + 2] = (r4 - 0.5) * 0.45;
    } else {
      const y = -2.55 + r2 * 3.9;
      const shoulder = 0.72 + (1 - Math.abs((y + 0.15) / 2.7)) * 0.85;
      const width = y < -1.7 ? 1.08 : shoulder;
      shapes[1][i3] = (r3 * 2 - 1) * width;
      shapes[1][i3 + 1] = y;
      shapes[1][i3 + 2] = (r4 - 0.5) * 0.7;
    }

    // Trajectory: a path with five readable turns.
    const pathT = r1 * 2 - 1;
    shapes[2][i3] = pathT * 4.6;
    shapes[2][i3 + 1] = Math.sin(pathT * Math.PI * 2.4) * 1.55 + (r2 - 0.5) * 0.45;
    shapes[2][i3 + 2] = Math.cos(pathT * Math.PI * 3) * 1.1 + (r3 - 0.5) * 0.32;

    // Craft: four distinct systems orbiting a shared center.
    const cluster = index % 4;
    const clusterCenters = [
      [-2.25, 1.35, 0],
      [2.25, 1.25, -0.5],
      [-2.15, -1.45, 0.4],
      [2.2, -1.35, 0],
    ];
    const sphereAngle = r1 * Math.PI * 2;
    const sphereRadius = Math.cbrt(r2) * 1.08;
    shapes[3][i3] = clusterCenters[cluster][0] + Math.cos(sphereAngle) * sphereRadius;
    shapes[3][i3 + 1] = clusterCenters[cluster][1] + (r3 * 2 - 1) * sphereRadius;
    shapes[3][i3 + 2] = clusterCenters[cluster][2] + Math.sin(sphereAngle) * sphereRadius;

    // Field notes: a calm woven signal surface.
    const fieldX = (r1 * 2 - 1) * 5.1;
    const fieldZ = (r2 * 2 - 1) * 2.8;
    shapes[4][i3] = fieldX;
    shapes[4][i3 + 1] = Math.sin(fieldX * 1.2 + fieldZ) * 0.7 + Math.cos(fieldZ * 1.5) * 0.42;
    shapes[4][i3 + 2] = fieldZ;

    // Open channel: the familiar heart resolves only at the end.
    const heartT = r1 * Math.PI * 2;
    const heartScale = 0.19 * (0.5 + Math.sqrt(r2) * 0.7);
    shapes[5][i3] = 16 * Math.pow(Math.sin(heartT), 3) * heartScale;
    shapes[5][i3 + 1] =
      (13 * Math.cos(heartT) -
        5 * Math.cos(heartT * 2) -
        2 * Math.cos(heartT * 3) -
        Math.cos(heartT * 4)) *
        heartScale -
      0.15;
    shapes[5][i3 + 2] = (r3 - 0.5) * 1.2;
  }

  return { shapes, sizes, mixes };
}

function createThreeWorld(THREE) {
  const reducedParticles = coarsePointer || navigator.hardwareConcurrency <= 4;
  const count = saveData ? 0 : reducedParticles ? 780 : 1680;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !reducedParticles,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, reducedParticles ? 1.5 : 1.8));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x03070f, 0.055);
  const camera = new THREE.PerspectiveCamera(49, innerWidth / innerHeight, 0.1, 50);
  camera.position.set(0, 0, 8.8);

  const ambient = new THREE.HemisphereLight(0xbceeff, 0x11122e, 1.25);
  const keyLight = new THREE.PointLight(0x9befff, 18, 18, 1.8);
  const rimLight = new THREE.PointLight(0xff9ac8, 12, 16, 2);
  keyLight.position.set(2.5, 3.5, 4);
  rimLight.position.set(-4, -1, 2);
  scene.add(ambient, keyLight, rimLight);

  const coreGroup = new THREE.Group();
  scene.add(coreGroup);

  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xbdefff,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.96,
    thickness: 1.35,
    ior: 1.42,
    transparent: true,
    opacity: 0.9,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    iridescence: 0.72,
    iridescenceIOR: 1.3,
    attenuationColor: new THREE.Color(0x73e7ff),
    attenuationDistance: 2.8,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, reducedParticles ? 3 : 5), glassMaterial);
  core.renderOrder = 4;

  const innerMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a91a8,
    emissive: 0x4ddfff,
    emissiveIntensity: 1.4,
    roughness: 0.2,
    transparent: true,
    opacity: 0.2,
  });
  const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.48, 2), innerMaterial);
  const wire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.13, 2),
    new THREE.MeshBasicMaterial({
      color: 0xdafaff,
      wireframe: true,
      transparent: true,
      opacity: 0.075,
    }),
  );
  coreGroup.add(core, inner, wire);

  const rings = new THREE.Group();
  for (let ringIndex = 0; ringIndex < 3; ringIndex += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.65 + ringIndex * 0.48, 0.008 + ringIndex * 0.003, 8, 120),
      new THREE.MeshBasicMaterial({
        color: ringIndex === 2 ? 0xff9ac8 : 0x73e7ff,
        transparent: true,
        opacity: 0.13 - ringIndex * 0.025,
      }),
    );
    ring.rotation.x = Math.PI * (0.3 + ringIndex * 0.16);
    ring.rotation.y = ringIndex * 0.7;
    rings.add(ring);
  }
  coreGroup.add(rings);

  const memoryNodes = [];
  for (let nodeIndex = 0; nodeIndex < chapters.length; nodeIndex += 1) {
    const angle = (nodeIndex / chapters.length) * Math.PI * 2 - Math.PI * 0.5;
    const material = new THREE.MeshStandardMaterial({
      color: 0x36566c,
      emissive: 0x73e7ff,
      emissiveIntensity: 0.05,
      roughness: 0.2,
      transparent: true,
      opacity: 0.55,
    });
    const node = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), material);
    node.position.set(Math.cos(angle) * 2.55, Math.sin(angle) * 2.55, 0);
    coreGroup.add(node);
    memoryNodes.push(node);
  }

  let particlePoints = null;
  let particlePositions = null;
  let particleVelocities = null;
  let particleShapes = null;
  let particleUniforms = null;

  if (count > 0) {
    const generated = makeParticleShapes(count);
    particleShapes = generated.shapes;
    particlePositions = particleShapes[0].slice();
    particleVelocities = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(generated.sizes, 1));
    geometry.setAttribute("aMix", new THREE.BufferAttribute(generated.mixes, 1));
    particleUniforms = {
      uDpr: { value: renderer.getPixelRatio() },
      uEnergy: { value: 0 },
      uColorA: { value: new THREE.Color(chapterPalette[0][0]) },
      uColorB: { value: new THREE.Color(chapterPalette[0][1]) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: particleUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aSize;
        attribute float aMix;
        uniform float uDpr;
        uniform float uEnergy;
        varying float vMix;
        varying float vAlpha;
        void main() {
          vMix = aMix;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.0 + aSize * (1.0 + uEnergy * 0.55)) * uDpr * (7.0 / max(2.5, -mv.z));
          vAlpha = 0.28 + aSize * 0.22;
        }
      `,
      fragmentShader: `
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        varying float vMix;
        varying float vAlpha;
        void main() {
          float distanceToCenter = length(gl_PointCoord - 0.5);
          float alpha = smoothstep(0.5, 0.04, distanceToCenter) * vAlpha;
          if (alpha < 0.01) discard;
          vec3 color = mix(uColorA, uColorB, vMix);
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    particlePoints = new THREE.Points(geometry, material);
    particlePoints.position.z = -0.8;
    scene.add(particlePoints);
  }

  const colorA = new THREE.Color();
  const colorB = new THREE.Color();
  const targetColorA = new THREE.Color();
  const targetColorB = new THREE.Color();
  let pulseEnergy = 0;
  let keyEnergy = 0;
  let keySeed = 0;
  let paused = false;
  let motionEnabled = prefs.motion;
  let lastShape = -1;

  const cameraSpring = {
    x: { value: 0, velocity: 0 },
    y: { value: 0, velocity: 0 },
    z: { value: 8.8, velocity: 0 },
  };

  function resize() {
    const dprCap = reducedParticles ? 1.5 : 1.8;
    renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    if (particleUniforms) particleUniforms.uDpr.value = renderer.getPixelRatio();
  }

  function directShape(shapeIndex) {
    if (!particlePositions || !particleShapes || shapeIndex === lastShape) return;
    particlePositions.set(particleShapes[shapeIndex]);
    particlePoints.geometry.attributes.position.needsUpdate = true;
    particleVelocities.fill(0);
    lastShape = shapeIndex;
  }

  function updateParticles(dt, frameState) {
    if (!particlePositions || !particleShapes) return;
    const current = frameState.story.activeIndex;
    const next =
      frameState.story.direction >= 0
        ? Math.min(chapters.length - 1, current + 1)
        : Math.max(0, current - 1);
    const forwardMorph = smoothstep(0.68, 0.98, frameState.story.localProgress);
    const morph = frameState.story.direction >= 0 ? forwardMorph : 1 - forwardMorph;

    if (!motionEnabled) {
      directShape(current);
      return;
    }

    const fromShape = particleShapes[current];
    const toShape = particleShapes[next];
    const pointerWorldX = frameState.input.nx * 3.2;
    const pointerWorldY = frameState.input.ny * 3.7;
    const scrollSpin = clamp(frameState.story.velocity / 2500, -0.65, 0.65);
    const burst = frameState.game.burst + pulseEnergy + keyEnergy;
    const stiffness = 18;
    const damping = Math.exp(-6.4 * dt);

    for (let index = 0; index < particlePositions.length; index += 3) {
      let tx = lerp(fromShape[index], toShape[index], morph);
      let ty = lerp(fromShape[index + 1], toShape[index + 1], morph);
      let tz = lerp(fromShape[index + 2], toShape[index + 2], morph);

      const phase = index * 0.017 + keySeed * 0.013;
      const turbulence = frameState.story.energy * 0.22 + burst * 0.07;
      tx += Math.sin(elapsed * 1.3 + phase) * turbulence;
      ty += Math.cos(elapsed * 1.07 + phase * 1.4) * turbulence;
      tz += Math.sin(elapsed * 0.9 + phase * 0.8) * turbulence;

      const dx = particlePositions[index] - pointerWorldX;
      const dy = particlePositions[index + 1] - pointerWorldY;
      const distanceSquared = dx * dx + dy * dy + 0.18;
      const influence = clamp(1.25 / distanceSquared, 0, 0.42);
      const polarity = frameState.input.pressed ? 1 : -0.32;
      tx += dx * influence * polarity;
      ty += dy * influence * polarity;

      tx += -particlePositions[index + 1] * scrollSpin * 0.09;
      ty += particlePositions[index] * scrollSpin * 0.09;

      particleVelocities[index] += (tx - particlePositions[index]) * stiffness * dt;
      particleVelocities[index + 1] += (ty - particlePositions[index + 1]) * stiffness * dt;
      particleVelocities[index + 2] += (tz - particlePositions[index + 2]) * stiffness * dt;
      particleVelocities[index] *= damping;
      particleVelocities[index + 1] *= damping;
      particleVelocities[index + 2] *= damping;
      particlePositions[index] += particleVelocities[index] * dt;
      particlePositions[index + 1] += particleVelocities[index + 1] * dt;
      particlePositions[index + 2] += particleVelocities[index + 2] * dt;
    }
    particlePoints.geometry.attributes.position.needsUpdate = true;
    lastShape = -1;
  }

  function update(dt, time, frameState) {
    if (paused) return;
    pulseEnergy = damp(pulseEnergy, 0, 4.5, dt);
    keyEnergy = damp(keyEnergy, 0, 5.5, dt);
    const index = frameState.story.activeIndex;
    const next = Math.min(chapters.length - 1, index + 1);
    const colorMorph = smoothstep(0.68, 0.98, frameState.story.localProgress);
    targetColorA.set(chapterPalette[index][0]).lerp(new THREE.Color(chapterPalette[next][0]), colorMorph);
    targetColorB.set(chapterPalette[index][1]).lerp(new THREE.Color(chapterPalette[next][1]), colorMorph);
    colorA.lerp(targetColorA, 1 - Math.exp(-6 * dt));
    colorB.lerp(targetColorB, 1 - Math.exp(-6 * dt));

    if (particleUniforms) {
      particleUniforms.uColorA.value.copy(colorA);
      particleUniforms.uColorB.value.copy(colorB);
      particleUniforms.uEnergy.value = frameState.story.energy + frameState.game.burst;
    }

    updateParticles(dt, frameState);

    const aspectShift = innerWidth >= 896 ? -0.5 : 0;
    const targetCoreX = aspectShift + frameState.input.nx * 0.22;
    const targetCoreY = (innerWidth >= 896 ? 0 : 0.55) + frameState.input.ny * 0.16;
    coreGroup.position.x = damp(coreGroup.position.x, targetCoreX, 7, dt);
    coreGroup.position.y = damp(coreGroup.position.y, targetCoreY, 7, dt);
    coreGroup.rotation.x += dt * (0.12 + frameState.story.energy * 0.45);
    coreGroup.rotation.y += dt * (0.18 + Math.abs(frameState.story.velocity) / 9000);
    rings.rotation.z += dt * (0.08 + frameState.story.direction * frameState.story.energy * 0.4);
    rings.rotation.x = Math.sin(time * 0.18) * 0.13;

    const scaleByChapter = [0.92, 0.78, 0.66, 0.84, 0.72, 1.05];
    const coreScale =
      scaleByChapter[index] *
      (1 + frameState.game.burst * 0.12 + pulseEnergy * 0.18);
    coreGroup.scale.setScalar(damp(coreGroup.scale.x, coreScale, 7, dt));

    glassMaterial.color.lerp(colorA, 1 - Math.exp(-5 * dt));
    glassMaterial.attenuationColor.lerp(colorB, 1 - Math.exp(-5 * dt));
    glassMaterial.ior = 1.38 + frameState.story.energy * 0.12;
    glassMaterial.thickness = 1.25 + frameState.input.pressure * 0.55;
    innerMaterial.emissive.copy(colorA);
    innerMaterial.emissiveIntensity =
      0.8 + frameState.game.awake.size * 0.11 + frameState.game.burst * 2.1;
    inner.scale.setScalar(0.88 + frameState.game.burst * 0.34);

    memoryNodes.forEach((node, nodeIndex) => {
      const awake = frameState.game.awake.has(nodeIndex);
      node.material.color.set(awake ? chapterPalette[nodeIndex][0] : "#36566c");
      node.material.emissive.set(chapterPalette[nodeIndex][0]);
      node.material.emissiveIntensity = awake ? 1.8 + frameState.game.burst : 0.04;
      node.material.opacity = awake ? 0.95 : 0.38;
      node.scale.setScalar(awake ? 1 + Math.sin(time * 2.2 + nodeIndex) * 0.14 : 0.72);
    });

    keyLight.position.x = frameState.input.nx * 4.5;
    keyLight.position.y = frameState.input.ny * 4.5;
    keyLight.intensity = 13 + frameState.story.energy * 12 + pulseEnergy * 8;
    rimLight.intensity = 7 + index * 1.1 + frameState.game.burst * 7;

    springStep(cameraSpring.x, frameState.input.nx * 0.18, dt, 0.42, 1);
    springStep(cameraSpring.y, frameState.input.ny * 0.14, dt, 0.42, 1);
    springStep(cameraSpring.z, 8.8 - frameState.story.energy * 0.32, dt, 0.42, 1);
    camera.position.set(cameraSpring.x.value, cameraSpring.y.value, cameraSpring.z.value);
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    body.classList.remove("has-webgl");
    body.dataset.renderMode = "css-fallback";
  });

  canvas.addEventListener("webglcontextrestored", () => {
    body.classList.add("has-webgl");
    body.dataset.renderMode = "webgl";
    resize();
    wake();
  });

  return {
    update,
    resize,
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    setMotion(value) {
      motionEnabled = value;
    },
    burst(index) {
      pulseEnergy = Math.min(1.4, pulseEnergy + 0.8 + index * 0.035);
    },
    pulse(x, y) {
      pulseEnergy = Math.min(1.2, pulseEnergy + 0.28 + Math.abs(x - y) * 0.08);
    },
    keyPulse(seed) {
      keySeed = seed;
      keyEnergy = Math.min(1, keyEnergy + 0.5);
    },
    reset() {
      pulseEnergy = 0;
      keyEnergy = 0;
    },
    seed(value) {
      if (!particlePoints || count === 0) return;
      const generated = makeParticleShapes(count, Number(value) || 0x715a4);
      particleShapes = generated.shapes;
      particlePositions.set(particleShapes[story.activeIndex] || particleShapes[0]);
      particleVelocities.fill(0);
      particlePoints.geometry.attributes.position.needsUpdate = true;
      particlePoints.geometry.attributes.aSize.array.set(generated.sizes);
      particlePoints.geometry.attributes.aSize.needsUpdate = true;
      particlePoints.geometry.attributes.aMix.array.set(generated.mixes);
      particlePoints.geometry.attributes.aMix.needsUpdate = true;
      lastShape = -1;
    },
    diagnostics() {
      return {
        renderer: {
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          points: renderer.info.render.points,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          pixelRatio: renderer.getPixelRatio(),
        },
        particles: count,
        context: renderer.getContext().isContextLost() ? "lost" : "ready",
      };
    },
  };
}

async function initThree() {
  if (saveData) {
    body.dataset.renderMode = "css-save-data";
    return;
  }
  if (!prefs.motion) {
    body.dataset.renderMode = "css-reduced-motion";
    return;
  }
  if (world3d || threeLoading) return;

  threeLoading = true;
  try {
    const THREE = await import(THREE_URL);
    world3d = createThreeWorld(THREE);
    body.classList.add("has-webgl");
    body.dataset.renderMode = "webgl";
    wake();
  } catch (error) {
    body.classList.remove("has-webgl");
    body.dataset.renderMode = "css-fallback";
    if (debugEnabled) console.warn("Three.js enhancement unavailable; using the CSS story.", error);
  } finally {
    threeLoading = false;
  }
}

function diagnosticsSnapshot() {
  return {
    story: {
      chapter: story.activeIndex,
      localProgress: story.localProgress,
      totalProgress: story.totalProgress,
      direction: story.direction,
      velocity: story.velocity,
      energy: story.energy,
      frame: frameCounter,
    },
    input: {
      pointer: [input.x, input.y],
      normalized: [input.nx, input.ny],
      pressed: input.pressed,
      pressure: input.pressure,
      keyPulse: input.keyPulse,
    },
    game: {
      awake: [...game.awake],
      count: game.awake.size,
      complete: game.awake.size === chapters.length,
      burst: game.burst,
    },
    preferences: { ...prefs, saveData },
    world: world3d?.diagnostics() || null,
  };
}

if (debugEnabled) {
  window.__THREE_GAME_DIAGNOSTICS__ = {
    get renderer() {
      return world3d?.diagnostics()?.renderer || null;
    },
    get state() {
      return diagnosticsSnapshot();
    },
    snapshot: diagnosticsSnapshot,
    awakenChapter,
    reset: resetMemory,
    scrollToChapter,
    setMotion(value) {
      prefs.motion = Boolean(value) && !prefs.systemReduced;
      applyMotionPreference();
    },
  };
}

if (testEnabled) {
  const testStates = {
    arrival: { index: 0, progress: 0.08 },
    signal: { index: 1, progress: 0.48 },
    trajectory: { index: 2, progress: 0.52 },
    craft: { index: 3, progress: 0.68 },
    field: { index: 4, progress: 0.48 },
    contact: { index: 5, progress: 0.74 },
  };

  window.__THREE_GAME_TEST_HOOKS__ = {
    seed(value) {
      world3d?.seed(value);
      wake();
    },
    setState(name) {
      const selected = testStates[name];
      if (!selected) throw new Error(`Unknown visual test state: ${name}`);
      for (let index = 0; index <= selected.index; index += 1) awakenChapter(index, false);
      const geometry = story.geometry[selected.index];
      const range = Math.max(1, geometry.height - innerHeight);
      window.scrollTo(0, geometry.top + range * selected.progress);
      cancelScrollSpring();
      wake();
    },
    setPausedForScreenshot(paused) {
      body.classList.toggle("visual-test-paused", Boolean(paused));
      if (paused) world3d?.pause();
      else {
        world3d?.resume();
        wake();
      }
    },
    setReducedMotion(enabled) {
      prefs.motion = !enabled && !prefs.systemReduced;
      applyMotionPreference();
    },
    showStatus(message = "All six memories awake · the river remembers ♥") {
      showToast(message, 5_000);
    },
    hideDebugUi() {
      // Debug data is an object only; there is no player-facing overlay to hide.
    },
    getState: diagnosticsSnapshot,
  };
}

root.classList.remove("no-js");
updateMemoryUI();
measureStory();
geometryObserver = new ResizeObserver(queueMeasure);
geometryObserver.observe(storyRoot);
document.fonts?.ready.then(queueMeasure);

// The first chapter is present immediately; its memory should not wait for a scroll event.
awakenChapter(0, game.awake.size > 0);

setTimeout(() => {
  clearTimeout(failOpenTimer);
  revealStory();
}, 260);

initThree();
wake();

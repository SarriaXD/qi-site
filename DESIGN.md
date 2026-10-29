# Qi Wang — Aurora Memory River

## Experience brief

- **Subject:** Qi Wang, a Winnipeg application developer whose path crosses pharmacy, full-stack software, global entertainment, AI, and health benefits.
- **Audience:** hiring teams, collaborators, and curious builders meeting Qi on a phone first.
- **Single job:** make Qi’s range feel coherent, human, and easy to contact.
- **Signature:** one continuous “memory river” of light changes form as the visitor scrolls, with a refractive glass core and a portrait cutout at its center.

## Visual system

- Midnight lake `#03070f`
- Aurora ink `#07192a`
- Glacier white `#e7faff`
- Polar cyan `#73e7ff`
- Iris light `#a99cff`
- Pulse coral `#ff9ac8`

Platform system type carries the interface; large display tracking, compact utility labels, and tabular counters create the hierarchy. The unusual move is spatial rather than typographic: the background behaves like an instrument conducted by touch.

## Ambient game contract

- **Player promise:** conduct Qi’s memory river and wake the story with your gestures.
- **Target feeling:** calm, curious, responsive, a little magical.
- **Primary verb:** scroll to conduct the river.
- **Secondary verbs:** point/touch to bend light, type to seed glyphs, drag the dock to scrub chapters.
- **Objective:** awaken six memory nodes.
- **Pressure:** fast scrolling creates turbulence and makes the river harder to settle; stillness restores clarity.
- **Reward:** every chapter changes the world form and lights a node; all six produce the final heart state.
- **Setback/retry:** there is no hard failure in the portfolio path. Turbulence temporarily scatters light, and “Replay the story” clears the session state.
- **Skill expression:** smooth, intentional gestures create a calmer, brighter field than frantic input.
- **Non-goals:** no combat, hidden navigation, forced tutorial, autoplay audio, or gameplay that blocks the portfolio content.

## Story encounter plan

1. **Arrival:** immediate pointer response and the portrait focal point; first node wakes on entry.
2. **Signal:** the visitor learns that scrolling changes both copy and world form.
3. **Trajectory:** an authored five-stop path turns scroll distance into career progression.
4. **Craft:** four technical clusters create deliberate pacing and recovery between dense facts.
5. **Field notes:** three principles stack into view; pointer tilt provides optional close interaction.
6. **Open channel:** collected nodes converge into a heart and the primary contact action.

The bottom story dock is an optional direct-manipulation route. It follows the finger, projects release velocity, and snaps to the nearest chapter while normal native scrolling always remains available.

## Resilience and handoff

- A dedicated `nojs.css` fallback expands every chapter into normal document flow when JavaScript is disabled or fails before enhancement.
- Reduce Motion uses the same readable static composition and does not initialize WebGL. The in-page Motion switch also pauses the world and removes sticky storytelling.
- Reduce Transparency is honored in browsers that expose it. Because Safari does not expose that system preference, the settings dialog also provides a persistent Glass effects switch that replaces blur and translucency with solid materials.
- On short phones, the Signal card is not a nested scroller: chapter progress directly conducts its longer copy through the glass, so one continuous page gesture still advances the story.
- The story dock preserves the exact point where the visitor grabbed its puck, hands release velocity into the chapter spring, and remains interruptible while it is settling.
- The settings dialog is explicitly fixed in the top layer and contains its own short-landscape scroll without moving the chapter behind it.
- Milestone audio is gesture-unlocked and disposable. Safari interruptions, backgrounding, or a closed context retire the old graph; the next trusted gesture creates a fresh context without delaying the switch UI.
- The enhanced experience targets Safari/iOS 15.4 and newer, the first Safari release with the viewport units and native dialog behavior used by the composition. Unsupported or disabled JavaScript still receives the complete static profile.
- The production origin is a zero-dependency Node HTTP service supervised by launchd. It exposes an exact file allowlist, serves Three.js from the same origin, forbids edge HTML transformation, redirects HTTP to HTTPS, and sends HSTS plus a self-only CSP.
- `assets/banff-portrait-test.png` is the active temporary cutout, derived from `banff-1.jpg` for layout testing. The three Banff originals and `assets/portrait-placeholder.svg` remain intact; a final identity-faithful transparent portrait can replace the test asset later without changing the composition.

## QA contract

- The Playwright matrix covers desktop Chrome, mobile Chrome, and an iPhone 13 WebKit profile. It exercises keyboard, pointer, native Chromium touch scrolling, dock scrubbing, dynamic viewport heights, settings continuity, Safari-style audio interruption, Reduce Motion, blocked storage, and no-JavaScript flow.
- Deterministic visual baselines protect desktop arrival plus mobile arrival, compact Signal, Craft, Open channel, and settings states. `npm run test:visual:update` updates them; `npm run test:visual` compares them with a `0.018` maximum pixel-difference ratio and no masks.
- Canvas inspection uses a fixed seed and named states, verifies nonblank pixels, and records renderer calls, triangles, geometries, textures, and DPR for desktop and mobile.
- An automated gameplay bot is intentionally skipped: this ambient portfolio has progression and replay but no failure, score, difficulty, or fairness loop. Scripted real input and six-chapter progression are the relevant playtest.
- Residual device check: a branded iPhone Safari session should still be used once for audible confirmation after lock-screen or competing-audio interruption; Playwright WebKit cannot emulate UIKit or AVAudioSession.

## Reference ledger

- `apple-design/SKILL.md` — loaded; direct response, interruptible springs, velocity projection, materials, typography, and reduced-motion rules applied.
- `frontend-design/SKILL.md` — loaded; subject, palette, layout, and one signature element defined before implementation.
- `react-liquid-glass/SKILL.md` — loaded, then stopped because the current project is not React. Native CSS plus a Three.js physical glass object is used instead.
- `threejs-gameplay-systems/references/gameplay-workflows.md` — loaded.
- `threejs-gameplay-systems/references/game-design-level-design.md` — loaded.
- `threejs-gameplay-systems/references/game-feel.md` — loaded.
- `threejs-game-ui-designer/references/ui-patterns.md` — loaded.
- Physics-engine reference — not loaded; the experience has no collision-heavy or rigid-body mechanics.

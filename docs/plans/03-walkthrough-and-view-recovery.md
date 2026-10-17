# Plan 3: Walkthrough controls and view recovery (black screen)

One branch `feature/walk-and-recovery`, two commits:

- **E:** walkthrough controls like a game controller: two on-screen sticks on touch devices, gamepad support, collision with walls.
- **Fix:** users can sometimes "break" the view on phone and desktop browser. The 3D view stays black and they cannot get back. Make the view always recoverable, and find and fix the causes.

Do the fix first: it is smaller, more important, and the walkthrough changes touch the same code.

Read [README.md](README.md) (rules for all plans) first.

---

## Fix: black screen / unrecoverable view

### R.1 Report

"On the phone and in the browser I sometimes manage to break the view: only a black screen remains and I cannot get back." No exact steps are known yet. **Do not guess one cause and stop.** Add defences for all likely causes, plus diagnostics, so the next report contains data.

### R.2 Likely causes (check each in the code)

1. **WebGL context loss.** Mobile browsers drop the WebGL context when the tab goes to the background, when memory is low, or when the GPU resets. `Stage` (`scene.js`) has **no** `webglcontextlost` / `webglcontextrestored` handler. After a loss, three.js renders nothing and the canvas stays black until reload. In Home Assistant's app the panel is rarely reloaded, so the user is stuck.
2. **Non-finite camera.** If `persp.position` or `controls.target` becomes `NaN`/`Infinity`, every following frame is black, and OrbitControls never recover. Possible sources:
   - `frame()` / `fitSphere()` with an empty plan (bbox of zero points);
   - `walkStep()` if a level disappears while walking;
   - `enterWalk()` computing yaw with `atan2(0, 0)` (guarded, but check pitch too);
   - camera tweens (`moveCam`) with identical from/to points;
   - pinch-zoom on the ortho camera reaching zoom 0.
3. **Camera inside geometry / pointing away:** the target is far away from the house after panning (OrbitControls pans without limits), or the camera ends below the ground. The view is "empty" dark blue and looks black at night.
4. **Exception inside `tick()`:** `start()` schedules the next frame before calling `tick()`. If `tick()` throws (for example, a device builder fails on a strange HA state), it throws every frame and nothing renders. The error is only in the console.
5. **Canvas size 0:** `resize()` uses `clientWidth || 1`. When the panel is hidden (HA sidebar, `display: none`) and shown again, `ResizeObserver` should fire. Check orientation changes on iOS (the observer sometimes fires before layout settles).
6. **Composer state:** `EffectComposer` render targets at size 1 × 1 after a 0-size resize, and bloom resolution 0.5 × 0.5.
7. **Walk mode stuck:** `controls.enabled = false` stays if `exitWalk` is not called (e.g. the level is deleted during walk, or an exception occurs in `stopWalk`). The user cannot rotate any more. That is not black, but feels "broken".
8. **Memory growth.** Measured on the demo:
   - `rebuildAll()` ×10: geometry count stable (946);
   - switching level ×10: +29 geometries, because the main roof is rebuilt in `layout()` without dispose.
   - `disposeLevel()` disposes geometries but **not** materials and textures (house.js creates new materials and cloned textures per build: `glassMat()`, `slatTex.clone()`, `garageTex.clone()`, `surfaceMat()`, label canvases).

   On phones this growth can lead to context loss over a long session.

### R.3 Changes

1. **Context loss handling** (`scene.js` constructor):
   - `canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; this.stop(); app.onViewLost?.(); })`.
   - `canvas.addEventListener('webglcontextrestored', () => app.recreateStage())`. Recreating is more reliable than relying on three.js to re-upload everything.
   - `panel.js` → `recreateStage()`:
     - dispose the old stage (`stage.dispose()`) and create a new `Stage` on a **new canvas element**, replacing the old one in the DOM;
     - re-run `rebuildAll()`, `layout()`, `setSun`, the media hub and the walk state (exit walk), then `frame(levelSel, true)` and `start()`.
   - If the context is not restored within 3 s, show the recovery overlay (R.3.4) with a "Reload view" button that calls `recreateStage()`.
   - Also handle `document.visibilitychange`: when the page becomes visible and `renderer.getContext().isContextLost()` is true, call `recreateStage()`.
2. **Camera sanity check** in `tick()`, cheap:
   - If any component of `persp.position`, `controls.target`, `ortho.position` is not finite, or `persp.position.distanceTo(controls.target) < 1e-3`, call `resetView()` and log a warning once.
   - `resetView()`:
     - exit walk and top view;
     - `levelSel = 'all'`;
     - `controls.enabled = true`, `controls2.enabled = false`;
     - reset `persp.fov` / `near` / `far`, `ortho.zoom = 1`;
     - `frame('all', true)`.
   - **Clamp panning:** after `controls.update()`, keep `controls.target` within the plan bounding box + 15 m. Keep the camera above `terrainOf(plan).y + 0.3` outside the walkthrough.
   - Guard `frame()`/`fitSphere()`: with no rooms, use a 10 × 10 m box at the origin. Assert finite results.
3. **Error boundary for the render loop:**
   - Wrap the body of `tick()` in try/catch.
   - On error: count consecutive errors, store the last error (message and stack) in `stage.lastError`, and still try `composer.render()` once.
   - After 3 consecutive errors: stop the loop and show the recovery overlay.
   - A successful frame resets the counter.
   - Device update errors should be caught **per device** (`e.built.update(...)`) so one broken device does not kill the view. Log once per device id.
4. **Recovery overlay** (new, in `panel.js` markup and `styles.js`):
   - Centred card over the viewport: "The 3D view stopped." It has two buttons: "Restore view" (`recreateStage()` then `resetView()`) and "Copy details" (copies the diagnostics, R.3.6, to the clipboard). It also offers a link to the GitHub issue form.
   - It must work without WebGL (plain DOM).
   - All texts through i18n (`panel.recovery.*`).
5. **"Reset view" is always reachable:**
   - add a menu item in the view menu (where "Performance display" is) "Reset view";
   - add a keyboard shortcut `Home` (desktop);
   - support a three-finger tap on touch (optional, only if trivial).
6. **Diagnostics** (shown in the performance overlay and copied by "Copy details"):
   - version (`VERSION` from the bundle), user agent, `renderer.capabilities.maxTextureSize`;
   - GPU renderer string (`WEBGL_debug_renderer_info` when available);
   - `renderer.info.memory` (geometries, textures), `renderer.info.programs.length`;
   - context-loss count, last error;
   - camera position/target, levelSel, mode, walk on/off;
   - viewport size and devicePixelRatio.
7. **Dispose properly** (fixes the slow growth):
   - In `disposeLevel()`, also dispose materials and their `map` textures, **except** shared ones. Mark shared module-level materials (`capMat`, `blockerMat`, materials cached in `kit.js` / `surfaceMat` caches) with `userData.shared = true` and skip them.
   - Check `kit.js` caching first: if `surfaceMat()` and `mat()` already cache by key, those are shared too.
   - Stop rebuilding the roof on every `layout()` (plan 1 B.6 does this with a signature cache). If plan 1 is not merged yet, at least dispose the old roof group before building a new one.
   - Labels (`canvasTex`) on rebuild: dispose the old textures.
8. **Lower the GPU pressure on phones:**
   - On `isMobile` / coarse pointer, use a pixel ratio of at most 1.5 (today max 2);
   - use a sun shadow map of 1024 (today 2048);
   - use bloom at quarter resolution.

   These are measurable wins against context loss. Add them to the existing performance mode logic (`stage.perf`) as "auto on phones", overridable in settings.

### R.4 Tests for the fix

- `tools/test-view-recovery.mjs` (Playwright, desktop and phone):
  1. **Context loss:** `const ext = gl.getExtension('WEBGL_lose_context'); ext.loseContext();` → overlay visible within 3 s. Then `ext.restoreContext()` (or click "Restore view") → the canvas renders again. Check that the centre pixel area is not uniform: read a screenshot and compute the standard deviation of the pixels > a threshold.
  2. **NaN camera:** set `stage.persp.position.x = NaN` → next tick resets the view (finite values, house visible).
  3. **Exception in tick:** monkey-patch one device's `update` to throw → view keeps rendering. Then make `composer.render` throw 3 times → overlay shows; "Restore view" works.
  4. **Memory:** 20× `rebuildAll()` and 20× level switches → `renderer.info.memory.geometries` and `.textures` within +2 of the start value.
  5. **Panning limit:** pan far away (call `controls.target.add(…1000…)` then `tick`) → target clamped.
  6. Walk mode entered, then the active level deleted → walk exits and controls are enabled.
- Look at the screenshots of the overlay on phone width.

---

## E: Walkthrough controls like a game controller

### E.1 Today

- Desktop: WASD/arrows move, Q/E turn, Shift runs, mouse drag looks (`Stage.walkStep`, `walkLook` in `scene.js`; keys in `panel.js` ~line 438).
- Touch: one joystick bottom-left (`#joy`, moves and strafes), and dragging anywhere on the canvas looks around (`panel.js` pointermove ~line 399).
  - The look-drag uses `this._down` / `_lastXY`, which do **not** track pointer ids. With one finger on the joystick and one on the canvas, events can mix.
  - Turning by dragging is imprecise and tiring.
- No collision: you can walk through walls.
- No gamepad support.

### E.2 Target

1. **Two on-screen sticks** (touch, coarse pointer), like Xbox/PlayStation mobile games:
   - left stick moves (forward/back, strafe);
   - right stick looks (turn left/right, look up/down).
2. **Gamepad support** via the Gamepad API (Xbox, PlayStation, generic "standard" mapping) on desktop and on tablets with a connected controller.
3. **Collision** with walls (doors and passages are open, windows are not).
4. Keep keyboard and mouse. Optional desktop pointer lock for mouse look.

### E.3 Touch sticks: behaviour

- **Layout:**
  - left stick in the bottom-left zone, right stick in the bottom-right zone;
  - each zone is the lower 45 % of the viewport height and 50 % of its width, above the bottom sheet; in walk mode set the sheet to `peek` (already done) and keep the zones above it (`bottom: calc(sheet height + 16px)`).
- **Floating sticks:** the stick base appears where the thumb touches inside its zone and follows if the thumb drags beyond the radius (like most mobile shooters). At rest, show faint fixed indicators so users know where to touch. A setting "Fixed sticks" pins them to the indicator positions.
- **Size:** base radius 56 px, knob radius 26 px, max travel 48 px. Scale with `Math.min(1.2, viewportWidth / 390)`.
- **Dead zone 0.12** (radial). Apply the response curve `out = sign(x) * ((|x| − dz) / (1 − dz))²`, for finer control near the centre.
- **Left stick:** y → forward speed, x → strafe.
  - Walk speed 1.4 m/s; pushing beyond 0.95 for 0.3 s → run (2.6 m/s), with a small "run" indicator.
- **Right stick:** x → yaw rate (max 140°/s), y → pitch rate (max 90°/s, clamp pitch to [−1.2, 1.1] rad as today). Option "Invert Y".
- **Pointer handling:** use pointer ids (`setPointerCapture`) per stick, so both sticks work at the same time (multi-touch). Each stick owns one pointer. Touches outside both zones still allow look-dragging with the existing code, but fix it to track the pointer id that started on the canvas.
- **Buttons** (right side, above the right stick, 44 px touch targets):
  - "Use" (interact, see E.5);
  - "Up" / "Down" storey (these exist in the HUD as `whUp`/`whDown`; move them here on touch).
- Haptic tick (`navigator.vibrate(8)`) when a stick leaves the dead zone, if available and not disabled.
- Hide the HUD hint after the first successful move; show it again via a "?" button.

### E.4 Gamepad

- Poll `navigator.getGamepads()` in `walkStep` (only while walking; no polling otherwise). Use the first pad with `mapping === 'standard'`, else the first pad.
- **Mapping (standard layout):**

  | Control | Action |
  |---|---|
  | axes 0/1 | move / strafe |
  | axes 2/3 | look |
  | button 0 (A / Cross) | Use |
  | button 1 (B / Circle) | exit walkthrough |
  | buttons 4/5 (LB/RB) | storey down / up |
  | button 10 (left stick click) or button 6 (LT) > 0.5 | run |
  | button 9 (Start) | toggle the HUD |
  | button 12/13 (D-pad up/down) | body height ± 5 cm |

- Same dead zone and curve as touch.
- Show a toast "Controller connected" on `gamepadconnected` while walking. Show the controller hint in the HUD (`panel.walkPad`).
- Also allow **starting** the walkthrough from view mode with the controller: button 3 (Y) when no input field is focused. Optional.

### E.5 Interaction while walking ("Use")

- A small crosshair (8 px dot) in the screen centre.
- Each frame (throttled to 10 Hz) cast a ray from the camera centre (`stage.pick` with a synthetic event in the centre, or directly `ray.setFromCamera({x:0,y:0})`) up to 3 m. If it hits a device or an opening with an entity, show its name and state above the crosshair ("Living room light · on") and enable "Use".
- "Use" (touch button, gamepad A, key `F`, mouse click when pointer-locked) toggles the entity: lights `light.toggle`, covers `cover.toggle`, switches `switch.toggle`, media `media_player.media_play_pause`.
  - Reuse the existing view-mode toggle code; search `panel.js` for where a click on a device calls the HA service.
  - Long press / hold A for 0.6 s opens the HA more-info dialog (existing `moreInfo`).

### E.6 Collision

- Use `wallSegments(level)` from `walls.js` (doors and passages are already removed as gaps). Treat the walker as a circle with radius 0.22 m.
- In `walkStep`, after computing the desired move, resolve against segments with a capsule-vs-segment push-out (up to 3 iterations). This is the same idea as `resolveFurniture`, but for a circle. The segment's half thickness `ht` is included. The walker slides along walls (remove only the normal component).
- Big furniture (table, sofa, bed, kitchen) also blocks: use the furniture footprints (`footprint()` in `walls.js`; export it) for items with height > 0.4 m. Exclude rugs, `flat` items and stairs.
- Toggle "Walk through walls" in the HUD (default off). Some users want to explore freely.
- **Stairs:** when the walker enters the footprint of a `stairs` item and moves along its run direction, switch the level automatically after crossing 70 % of the run. Animate the eye height over 0.6 s instead of jumping. Optional; if skipped, keep the Up/Down buttons.

### E.7 Desktop pointer lock (optional)

- A click on the canvas while walking requests `canvas.requestPointerLock()`. `mousemove` with `movementX/Y` looks, Escape releases (the browser does that) and a second Escape exits walk.
- Show "Click to look around · Esc to release" in the HUD.

### E.8 Code structure

- New file `frontend/src/walkcontrols.js` with a class `WalkControls`. It owns:
  - the touch sticks (DOM, pointer handling);
  - gamepad polling;
  - key state;
  - the output vector `{ move: [x, y], look: [x, y], run, use, levelDelta }`.
- `Stage.walkStep(dt)` reads from `this.walkInput` (set by panel) and does the math: rates × dt, collision, camera.
- Remove the old `#joy` code from `panel.js` and the `.joy` styles. Add the new markup and styles.
- Settings stored per device in `localStorage` (try/catch): invert Y, sensitivity (0.5–2), fixed sticks, haptics, walk through walls. Add a small settings popover in the walk HUD.
- All new texts through i18n (`panel.walk*`).

### E.9 Tests for E

- `tools/test-walk-controls.mjs` (Node, CI) for the pure parts: dead zone and curve function, collision push-out (walk into a wall at 30° and check that it slides and never crosses; walk through a door gap and check it passes), gamepad mapping with a fake `getGamepads` object.
- `tools/test-walk-browser.mjs` (Playwright, phone and desktop):
  - Start the walk.
  - Simulate two touches with `page.touchscreen` or dispatch `PointerEvent`s with different `pointerId`s on both stick zones, and check that the camera moves forward and turns at the same time.
  - Walk straight into a wall for 3 s and check that the position stays inside the room.
  - Fake a gamepad (`navigator.getGamepads = () => [fakePad]`) and check move, look, LB/RB level change and B exit.
  - Look at a light and press Use; the sim state toggles.
  - Screenshots of the HUD with sticks on phone (portrait and landscape 844 × 390).
- Existing `test-object-elevation-browser.mjs` and `test-screen-interaction.mjs` must still pass.

### E.10 Pitfalls

- iOS Safari: `touch-action: none` on the stick zones and the canvas while walking. Otherwise the page scrolls or zooms.
- Do not call `preventDefault` on pointer events outside walk mode (the editor and HA gestures need them).
- The render loop runs at full rate while walking (`interactive` includes `this.walk`). Gamepad polling happens inside `walkStep`, so it costs nothing outside walk mode.
- Landscape phones: sticks must not cover the HUD. Put the HUD top-centre and make it compact (one row).

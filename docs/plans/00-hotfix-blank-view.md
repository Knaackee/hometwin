# Hotfix plan: empty view after the browser was in the background

Small, self-contained fix. Branch `fix/blank-view`, one pull request. Do this **before** the other plans.
It is a focused extract of [plan 3, part "Fix"](03-walkthrough-and-view-recovery.md#fix-black-screen--unrecoverable-view). The rest of that part (error boundary, memory, diagnostics) follows later with plan 3.

Read [README.md](README.md) (rules for all plans) first.

## Report

"When the browser was in the background and I come back to the page, the content is empty." This was seen on desktop browsers and on the phone. Sometimes the view also turns black during use, and the user cannot get back without reloading.

## Cause (most likely)

Browsers free GPU memory of background tabs. The page loses its **WebGL context**: the `webglcontextlost` event fires on the canvas.

`Stage` in `frontend/src/scene.js` creates a `THREE.WebGLRenderer` but does not listen for `webglcontextlost` / `webglcontextrestored`. Without `event.preventDefault()` in the lost handler, the browser never restores the context, and three.js draws nothing, permanently. In the Home Assistant app the panel is not reloaded when the user comes back, so it stays empty.

**Second, related cause:** the on-demand render loop. `Stage.start()` uses `requestAnimationFrame`, which pauses in background tabs. When the tab becomes visible, nothing calls `wake()`/`invalidate()`. In idle pacing the next frame may wait for `_next`, and the shadow map and composer targets may be stale. A visibility change must force a full redraw.

## Changes

### 1. `frontend/src/scene.js`: handle context loss

In the `Stage` constructor, after creating the renderer:

```js
this.lost = false;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();               // required, otherwise the browser never restores the context
  this.lost = true; this.stop();
  this.app.onViewLost?.();
}, false);
canvas.addEventListener('webglcontextrestored', () => {
  this.lost = false;
  this.app.onViewRestored?.();      // panel rebuilds everything, see step 2
}, false);
```

In `tick()`, return immediately if `this.lost` is true (no GL calls while lost).

### 2. `frontend/src/panel.js`: rebuild after restore, recover after background

Add these methods to the panel element:

- `onViewLost()`:
  - remember `this._viewLost = Date.now()`;
  - start a 3 s timer; if the context is not back by then, show the recovery card (step 3).
- `onViewRestored()`: call `this.recreateStage()`.
- `recreateStage()`. Recreating is safer than relying on three.js to re-upload all textures, render targets and shadow maps.
  1. Remember camera position, target, `levelSel` and mode.
  2. Call `this.stage.dispose()`. It already calls `forceContextLoss()`; that is fine for the old canvas.
  3. Replace the canvas element with a fresh `<canvas>` (same id and classes). Re-attach the pointer, wheel and context-menu listeners that `panel.js` adds to the canvas. Move that wiring into one method `wireCanvas(canvas)` so it can be called again.
  4. `this.stage = new Stage(canvas, this)`. Then `stage.rebuildAll()`, `updateSun()`, `stage.resize()`, restore camera and level selection (`setLevel`), and `stage.start()`.
  5. If the editor is open, re-run `editor.roofHandles()` and the selection marks (`editor.markSelection()`).
  6. Hide the recovery card.
- Listen to `document.addEventListener('visibilitychange', …)`. When `document.visibilityState === 'visible'`:
  - if `this.stage.lost` or `this.stage.renderer.getContext().isContextLost()`, call `recreateStage()`;
  - otherwise call `this.stage.resize()` and `this.stage.wake(true)` (forces a full frame and a shadow update).
- Also listen to `pageshow` with `event.persisted === true` (back/forward cache, mobile Safari) and do the same as `visibilitychange`.
- Remove the listeners in `disconnectedCallback`. Add them in `connectedCallback` if they are not there yet. Home Assistant detaches and re-attaches panels when switching sidebar entries.

### 3. Recovery card (always reachable)

- Markup in `panel.js` (inside the viewport, hidden by default): a centred card with:
  - a title (`panel.recovery.title`: "The 3D view stopped" / "Die 3D-Ansicht wurde angehalten");
  - a text (`panel.recovery.text`: "This can happen when the browser was in the background. Your plan is safe." / "Das passiert, wenn der Browser im Hintergrund war. Dein Plan ist sicher.");
  - a primary button (`panel.recovery.restore`: "Restore view" / "Ansicht wiederherstellen") that calls `recreateStage()`.
- Plain DOM and CSS, no WebGL. Styles in `styles.js` next to the other overlays; respect the dark theme variables (`--panel`, `--line`, `--fg`).
- Add a menu entry **"Reset view" / "Ansicht zurücksetzen"** where the performance display toggle is. It calls `recreateStage()` and then `stage.frame('all', true)`. Users can always get back, whatever the cause.
- All texts in `frontend/src/locales/panel.en.json` and `panel.de.json`; run `npm run test:i18n`.

### 4. Not in this hotfix

Error boundary in `tick()`, NaN camera guard, dispose of materials/textures, and lower GPU settings on phones are in plan 3. Do not mix them in here, so this fix stays small and easy to review.

## Test (`tools/test-view-recovery.mjs`, Playwright, desktop 1440 × 1000 and phone 390 × 844)

1. Load the demo, click "Explore the sample house", stop the loop (`stage.stop()`), `tick()`, screenshot. Compute the pixel standard deviation of the canvas area: it must be above a threshold (not a flat colour).
2. Force a context loss in the page:

   ```js
   const gl = panel.stage.renderer.getContext();
   const ext = gl.getExtension('WEBGL_lose_context');
   ext.loseContext();
   ```

   - Wait for `panel.stage.lost === true`.
   - Wait 3.5 s and check that the recovery card is visible.
3. Click "Restore view". Check that `panel.stage.lost` is false, the canvas is a new element, `stage.tick()` works, the screenshot has the pixel standard deviation above the threshold, and the camera target equals the remembered one (±1 cm).
4. Context loss followed by `ext.restoreContext()` (automatic path): the view comes back without clicking. (On the new stage, get the extension again from the new context to call `restoreContext`; on the old one it is gone after `recreateStage`. Test the automatic path first, then the button path.)
5. Visibility: emulate a hidden → visible change:

   ```js
   Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
   document.dispatchEvent(new Event('visibilitychange'));
   ```

   Then switch back to `'visible'`. Check that a frame is rendered (spy on `stage.composer.render`) and that no error occurs.
6. Menu "Reset view" works in view and edit mode.
7. No `pageerror` events during the test. Look at the screenshots of the recovery card on the phone.

**Manual check on a real phone** (the developer must do this once, CI cannot):

1. Open HomeTwin in the Home Assistant app.
2. Switch to another app for 5 minutes and come back: the view is there or restores itself within a second.
3. Do the same in Chrome and Safari with several other heavy tabs open.

## Acceptance

- After background/foreground, the 3D view always comes back, automatically or with one tap.
- No reload of the page is needed in any case.
- The existing browser tests still pass.

# Implementation plans

Detailed, self-contained plans for the next work packages. Each plan can be handed to a coding agent
or a human contributor. Work through them in this order; each one is a separate branch and a
separate pull request (or patch).

| # | Plan | Content | Size |
|---|---|---|---|
| 0 | [Hotfix: empty view after background](00-hotfix-blank-view.md) | Restore the 3D view after the browser was in the background (WebGL context loss), recovery card, "Reset view" | small |
| 0b | [Recognition optimisation](04-recognition-optimization.md) | International, plan-agnostic: PDF text layer, exact scale from vector PDFs, region-of-interest proposal, notation parser (m/cm/mm/ft-in) chosen by consistency, openings pass with tiles, door swing, evaluation set | medium–large |
| 1 | [Building envelope](01-building-envelope.md) | B: roofs as a list of equal parts · C: exterior photos and elevation drawings → facade, plinth, frames, roof covering | medium–large |
| 2 | [Building parts and wall editor](02-building-parts-and-wall-editor.md) | D: library parts for windows, doors (then stairs, railings) · F: wall editor (wall face as a 2D canvas for lamps, posters, frames) | large |
| 3 | [Walkthrough and view recovery](03-walkthrough-and-view-recovery.md) | E: twin-stick walkthrough with gamepad support and wall collision · fix: black screen / unrecoverable view | medium |

Already done: patch A (gap-free storeys, plinth only on the terrain, clean wall ends, storey heights in the floor-plan assistant).

## Rules that apply to every plan

Read these before you start. They are not repeated in full in each plan.

1. **Read [AGENTS.md](../../AGENTS.md) completely.** It describes the repository, build, data model and conventions.
2. **Start from the current `main`.** Create a branch `feature/<plan-name>`. Do not mix plans in one branch.
3. **Plan changes only through `applyOps` or `normalize`/`migrate` in `frontend/src/plan.js`.** Never change the saved plan format without a migration that turns every older plan into the new shape. Old backups (JSON export) must still import.
4. **All UI text through `t('area.key')`** from `frontend/src/i18n.js`. Add every new key to both `frontend/src/locales/<area>.en.json` and `<area>.de.json` (English is the source; German must be complete). Keys are stable and semantic (`editor.roof.addRoof`, not `editor.button3`). Run `npm run test:i18n`. Do not build keys dynamically unless all variants exist (the checker only sees literal keys).
5. **Units:** metres and degrees. Plan axes: x right, z down (south), y up. `site.north` is the compass angle of plan "up" (see `sun.js`).
6. **Performance is a feature.** No per-frame allocations in `Stage.tick()`. Rebuild only what changed. Dispose geometries, materials and textures you create (shared materials such as `capMat`, `blockerMat` must not be disposed; mark them `userData.shared = true` if you add a dispose pass). The render loop is on demand: call `stage.invalidate()` after state changes and `stage.wake()` for user input.
7. **Build and commit generated files:** `cd frontend && npm ci && node build.mjs`. CI fails if `custom_components/hometwin/frontend/`, `docs/demo/index.html`, `library/index.json` or `frontend/src/library.gen.js` are not up to date.
8. **Tests.** Every plan lists the tests to add. Node tests (`tools/test-*.mjs` without a browser) must be added to `.github/workflows/validate.yml` next to `test-house-geometry.mjs`. Browser tests use Playwright against `docs/demo/` served at `http://127.0.0.1:4173/demo/` (`cd docs && python3 -m http.server 4173`). Use `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, call `panel.stage.stop()` before clicking and `panel.stage.tick()` before screenshots. Check desktop (1440 × 1000) and phone (390 × 844, `isMobile: true`). **Look at the screenshots**; a passing assertion is not enough for visual work.
9. **Existing tests must stay green:** `npm run test:i18n`, all `tools/test-*.mjs`, `python -m py_compile custom_components/hometwin/*.py`, `python tools/test-language-options.py`.
10. **Python:** keep the backend thin. New websocket commands go into `custom_components/hometwin/websocket.py` with a voluptuous schema; AI calls go into `agent.py` and reuse `_post`, `_json_from`, `_repair_json` and the job mechanism (`start_detect_job`, `job_state`).
11. **Changelog:** add an entry under `## Unreleased` in `CHANGELOG.md`.
12. **Never commit** photos of real houses, third-party logos or textures. Test images must be generated (canvas drawings) in the test itself.
13. When something in a plan turns out to be wrong for the actual code, follow the code, keep the intent of the plan and write down the deviation in the pull request description.

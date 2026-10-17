# AGENTS.md: working on HomeTwin

Guide for coding agents (Claude, Codex, …) and humans who develop HomeTwin. Read it fully before changing code.

## What HomeTwin is

A Home Assistant custom integration (`custom_components/hometwin`) that registers a sidebar panel with a three.js 3D model of the user's home. It also contains:

- an AI agent (OpenAI-compatible) that edits the plan and reads floor-plan images,
- a community **object library** (`library/`) of recipes,
- a static **website** with a live demo (`docs/`).

Repository: `github.com/knaackee/hometwin` · Website: `knaackee.github.io/hometwin` · Status: public beta.

## Repository map

| Path | Content |
|---|---|
| `custom_components/hometwin/` | Python integration. `__init__.py` (panel, static files, Raumwerk takeover), `store.py` (plan in `.storage/hometwin.plan`), `websocket.py` (API), `agent.py` (chat loop and floor-plan recognition), `geometry.py` (checks and dimension fitting), `views.py` (floor-plan images under `/api/hometwin/underlay/<level>`), `config_flow.py`, `frontend/` (**built** panel bundle, committed for HACS) |
| `frontend/src/` | Panel source (ES modules, bundled with esbuild): `panel.js` (element `<hometwin-panel>`, view mode, room picker, walkthrough UI, long-press), `scene.js` (renderer, cameras, levels, roofs, rise animation, walkthrough camera, picking), `editor.js` (edit mode, inspector, tools, backup), `wizard.js` (floor-plan assistant), `house.js` (walls, floors, openings), `roof.js` (main roof, extra roofs, PV, dormers), `furniture.js` (procedural furniture and library registration), `devices.js` (entity-bound assets), `plan.js` (schema v2, migration, ops), `sim.js` (simulated HA for the demo), `treemenu.js`, `walls.js`, `kit.js`, `sun.js`, `sh3d.js`, `pdfload.js`, `styles.js`, `icons.js` |
| `frontend/src/library.gen.js` | **Generated** from `library/` by `build.mjs`. Do not edit. |
| `engine/recipe.js` | Recipe engine (safe expression parser, shapes, materials). Shared by panel, tools and website. |
| `library/` | Objects: `generic/<category>/<slug>/` and `manufacturers/<maker>/<category>/<slug>/`, each with `object.json`, `recipe.json`, `preview.webp`. `schema/`, generated `index.json`. |
| `skills/add-object/` | Agent skill for contributors (open skill format: `SKILL.md` + `references/`). |
| `tools/` | `validate.mjs`, `render-preview.mjs`, `new-object.mjs`, `build-index.mjs`, `build-pages.mjs` |
| `docs/` | GitHub Pages: `index.html` (product page with live gallery), `demo/index.html` (generated demo), `library/` (generated), `assets/` (logo, screenshots) |
| `.github/` | Workflows (validate, pages, release), issue and PR templates |

## Build and run

```bash
# panel + demo (writes custom_components/hometwin/frontend/ and docs/demo/index.html)
cd frontend && npm install && node build.mjs
# shared catalog for the Python agent (after changing devices/furniture)
cd frontend && node catalog.mjs
# library (repo root)
npm install && npx playwright install chromium
npm run validate                    # all objects
npm run preview -- <id>             # render preview.webp + .preview/<slug>-sheet.png
npm run pages                       # library/index.json + docs/library/
```

Open `docs/demo/index.html` in a browser (it loads three.js and pdf.js from jsDelivr). The demo runs the real panel against `sim.js`.

## Test before you hand over

- **Every UI change must be exercised in the demo** with Playwright (Chromium is preinstalled in most agent sandboxes; use `--use-gl=swiftshader`). Stop the render loop (`panel.stage.stop()`) before clicking, and call `stage.tick()` before screenshots, because software WebGL is slow. Look at the screenshots.
- Python: `python -m py_compile custom_components/hometwin/*.py`. Agent and geometry logic can be tested with a stubbed `hass` (no HA install needed).
- Library: `npm run validate -- --strict`.
- Check mobile (390 × 844, `isMobile`) for anything in view mode.

## Data model (short)

- Plan JSON v2 (`plan.js`): `site` (location, facade, `roof` = main roof, `roofs[]` = extra roofs, `solar[]`, `roofItems[]`, `library{}` = recipes of used library objects), `levels[]` (`rooms[]` polygons in metres `[x, z]`, `openings[]`, `furniture[]`, `devices[]`, `underlay`).
- Plan changes go through ops (`applyOps`), the same ops the AI agent emits.
- Storage: `.storage/hometwin.plan`, images in `/config/hometwin/<level>.img`. On first start, data of the former name `raumwerk` is taken over.
- Library objects in a plan: furniture type `lib:<library-id>`; the recipe is copied into `site.library` so the plan works offline.

## Websocket API

`hometwin/plan/get|save|subscribe` · `hometwin/agent/info|chat|detect|detect_start|job|job_consume`. Recognition runs as a background job; the panel polls `job`.

## Conventions

- Plain ES modules, no framework. Keep files focused; prefer extending the existing module over new layers.
- English is the default UI language; German is also supported. UI text lives in frontend/src/locales/<area>.<language>.json with stable semantic keys. Use i18n.js at render time; preserve placeholders and user-authored names. Keep both languages complete and run npm run test:i18n. Home Assistant options select ui_language independently of the HA profile language.
- Units: metres, degrees. Plan axes: x right, z down (south), y up.
- No external network calls from the panel except the optional library index (`knaackee.github.io/hometwin/library/library.json`).
- Never commit photos, textures or logos of third parties. Library objects are recipes; preview images are rendered.
- Accessibility: buttons have labels, keyboard works, `prefers-reduced-motion` is respected where it matters (not for the short rise animation).

- Translation contributions follow [CONTRIBUTING.md](CONTRIBUTING.md#translation-contributions). AI drafting is allowed; a native speaker must manually review every string and the running UI before merge. Never self-certify human review or enable unreviewed generated languages. Record the reviewer, language, checked screens and AI model in the PR.
## Versioning and release

1. Bump the version in `custom_components/hometwin/const.py` (`VERSION`), `custom_components/hometwin/manifest.json` and `CHANGELOG.md`.
2. `cd frontend && node build.mjs` and commit the built files.
3. Tag `vX.Y.Z` (pre-releases: `vX.Y.Z-beta.N`). The release workflow attaches `hometwin.zip`.

## Library pull requests (maintainers)

CI validates schema, dimensions and limits and renders previews. Review the preview sheet against the sources, check the licence (CC0-1.0 / CC-BY-4.0) and that only links (no images) were added. After merge, Pages republishes the gallery and `library.json`; panels pick up new objects without an update.

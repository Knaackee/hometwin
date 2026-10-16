---
name: hometwin-add-object
description: Adds real-world objects (furniture, lamp, appliance, radiator, sensor, instrument, garden item …) to the HomeTwin 3D library and opens one pull request for them. Use when the user names products or sends photos and wants them in HomeTwin, or asks to model, contribute or submit 3D objects for HomeTwin (github.com/knaackee/hometwin).
---

# HomeTwin: add an object to the library

You turn a product the user names or photographs into a library object for HomeTwin (3D home dashboard for Home Assistant) and submit it as a pull request. An object is a folder with:

| File | Content |
|---|---|
| `object.json` | name, category, manufacturer/model, outer dimensions, mount, Home Assistant domains, licence, sources |
| `recipe.json` | the 3D model as a declarative recipe of primitives (box, cylinder, lathe, extrude, tube …) |
| `preview.webp` | rendered thumbnail, never drawn by hand |
| `review.png` | rendered four-view review sheet (3/4, front, side, top and dimensions) |

No Blender, no image generation: you build the model from primitives, render it with the same Three.js engine the panel uses, look at the render, and correct it.

## Specific product or generic object?

Decide this right after looking at the photo or description, before any modelling:

| Situation | What you do |
|---|---|
| **Product is clear** (brand + model visible or named, e.g. the Martin guitar) | Manufacturer object with the real dimensions → `manufacturers/<maker>/…` |
| **Only the type is clear** (e.g. "a grey 3-seat sofa" – there are hundreds) | **Do not guess a product.** Reuse an existing generic object and only set its `params` (dimensions, seats, colour). Ask the user to measure W × D × H. No pull request needed if the generic object already covers it – tell the user which object and parameters to use in the panel. |
| **Type is clear but no generic shape fits** | New generic object with sensible `params` → `generic/…` |

## Batch: several objects, one pull request

Contributors are encouraged to walk through their home and add what is missing. Check the gallery first (https://knaackee.github.io/hometwin/#library or `library/index.json`) and skip objects that already exist. **Put 3–10 objects into one pull request** (ideally one room or one category). It is reviewed and merged much faster than many single PRs. Work through the objects one by one (steps 1–6), then do step 7 once.

## Checkpoints with the user

Resolve these checkpoints only when not already answered or authorized in the conversation; reuse scoped approval:
1. **Identification** is not certain → show 2–3 candidates (name, variant, link) and ask which one.
2. **Dimensions** cannot be found from a reliable source → ask the user to measure (W × D × H). Never invent measurements.
3. **Preview** is ready → show it and ask for approval or corrections.
4. **Before the pull request** → confirm the PR may be created.

## 0. Setup (once per machine)

```bash
gh repo fork knaackee/hometwin --clone   # only if no suitable checkout and no upstream write access
cd hometwin && npm install && npx playwright install chromium
gh auth status                            # must be logged in for the PR
```
Reuse the existing checkout and preserve user changes. Maintainers push a feature branch to the upstream repository; contributors without write access use a fork. Check the latest base-branch CI before editing and distinguish existing project failures from object regressions.

Work from the repository root. All commands below assume it.

## 1. Identify the product

- **From text:** search the web for the exact product. Prefer the manufacturer's page.
- **From a photo:** look at the photo carefully: shape, materials, colours, logos, labels, model plates. Describe what you see, then search with those details (brand + type + distinctive features). If the photo shows several objects, ask which one.
- Determine: manufacturer, model, variant (size, colour, finish). If it is a generic type without a clear model (e.g. "a simple 3-seat sofa"), it goes to `generic/`.

## 2. Research specifications

- Collect from the product page or datasheet: **width × depth × height** (outer), important sub-dimensions (seat height, leg height, shade diameter, door count, panel thickness), colours, materials, mounting.
- Convert to metres. Watch the convention (W × D × H vs. W × H × D; inches → × 0.0254).
- Collect 2–4 reference image URLs (front, side, detail). **Only store links** in `sources`. Never download photos, textures or logos into the repository.
- Note uncertain values in the source `note` (e.g. "leg height estimated from photo").

## 3. Place it in the library

- Path: `library/generic/<category>/<slug>` or `library/manufacturers/<maker>/<category>/<slug>`.
- Lowercase with dashes. Maker as commonly written (`ikea`, `philips-hue`, `bosch`). Slug = model (+ variant if it changes the geometry), e.g. `kallax-4x4`.
- Categories: see [references/categories.md](references/categories.md) (in the repository). Reuse existing ones; a new category is allowed when nothing fits – say so in the PR.
- Check for duplicates: `grep -ril "<model>" library --include=object.json`. If it already exists, improve it instead of adding a copy.

```bash
npm run new -- manufacturers/ikea/furniture/storage/kallax-4x4 --name "KALLAX shelf 4x4" --author <github-handle>
```

## 4. Model the recipe

Read [references/recipe-format.md](references/recipe-format.md) (format) and [references/modeling-guide.md](references/modeling-guide.md) (how to decompose) before the first recipe. These files live in the repository at `skills/add-object/references/`.

1. Write a **parts table** first (in your reasoning or to the user): every visible component with size and position, e.g. *frame side 0.035 × 1.47 × 0.39 at x = ±0.716*.
2. Translate it into `recipe.json`. Repeated elements with computed positions (frets, slats, ribs) use `repeat` plus `let` for per-copy helper values; `pow`, `floor`, ternaries etc. are available. Use `params` for what users may sensibly change (width of a sofa, colour, number of seats). For a specific product, defaults must equal the real product.
3. Fill `object.json`: `dimensions` = real outer size, `mount`, `ha.domains` (e.g. `light` for lamps, `climate` for radiators/thermostats, `media_player` for TVs/speakers, `cover` for blinds), `tags`, `sources`, `license` (`CC0-1.0` by default), `author`, `generated_by`.

## 5. Validate and look at it

```bash
npm run validate -- <id>     # schema, size vs. dimensions, centring, limits, duplicates
npm run preview -- <id>      # writes preview.webp, review.png and .preview/<slug>-sheet.png
```
- Open `.preview/<slug>-sheet.png` (3/4, front, side, top, measured size) and **compare it with the reference images**. Check proportions, part positions, missing or floating parts, colours.
- Fix and repeat. Usually 2–4 rounds. Stop improving when the object is recognisable at thumbnail size and the dimensions match within 1 cm.

## 6. Show the user

Send the sheet image and `preview.webp`, plus a short table: real dimensions vs. model, parameters, sources. Ask for approval or changes (checkpoint 3).

## 7. Pull request

After approval (checkpoint 4):
```bash
npm run validate -- --strict
npm run pages
(cd frontend && npm ci && node build.mjs)
git checkout -b codex/library-<short-topic>    # follow the active harness branch convention
git add library/<id-1> library/<id-2> …
# Also stage reviewed generated index, gallery, demo and panel changes explicitly.
git commit -m "library: add <n> objects (<topic>)" -m "Co-authored via hometwin-add-object skill"
git push -u origin HEAD
gh pr create --repo knaackee/hometwin --title "library: add <n> objects (<topic>)" --body-file <body.md>
```
Write `<body.md>` from [references/pr-body.md](references/pr-body.md), one section per object. Embed both `preview.webp` and `review.png` using raw.githubusercontent.com URLs pinned to the pushed full commit SHA; verify both URLs return images. An Actions artifact download link is not an inline image.

Watch all PR checks through completion. Diagnose and fix object regressions; report pre-existing project failures separately and address them only within authorized scope. Do not describe a PR as ready while required checks are failing or pending. CI also uploads four-view sheets as review artifacts.

After an authorized merge, wait for the Website workflow and verify the object in the published gallery, remote library JSON and demo editor. Exercise insertion and confirm the recipe is stored in the plan for offline use. Merge, release and community posting require their own authorization. Give the user the PR link and actual check/deployment results.

## Rules

- Measurements only from sources or the user. Mark estimates.
- Licence of the recipe: CC0-1.0 (default) or CC-BY-4.0. Manufacturer and model names are fine; no logos, no copied textures or photos.
- One object per folder (variants with different geometry = separate objects). Several objects per PR are welcome.
- Keep it light: ≤ 15 000 triangles, recipe ≤ 64 KB. Detail level of a good architectural visualisation, not a CAD model.
- Coordinates: metres, y up, stands on y = 0, centred on x/z, front faces +z. Wall objects: back face at z = −d/2.

# Plan 4: Floor-plan recognition optimisation (international)

Branch `feature/recognition-v2`, two commits (R1, then R2). Do this **before** plan 1. Recognition quality decides whether users get started at all.

Read [README.md](README.md) (rules for all plans) first.

## Principle: nothing tailored to one plan, one country or one model

HomeTwin is used worldwide. Plans come in many forms:

- **Sources:** vector PDFs from CAD (ArchiCAD, Revit, Vectorworks, AutoCAD …), scanned PDFs, photos of paper plans, screenshots from estate agents and builder brochures.
- **Units and notation:**
  - metric with metres and centimetres;
  - metric in millimetres only (UK, Scandinavia, Australia);
  - imperial feet and inches (US, Canada).
- **Layouts:** one storey per sheet, several storeys on one sheet, title blocks at any side, site plans, legends, sections and elevations on the same sheet.
- **Models:** the user chooses the model (Claude, Gemini, GPT, Qwen …). They differ in image size limits and output habits.

**Rules for this plan:**

1. **Every heuristic must be general.** If a rule only works for one drawing style, it is not allowed. Prefer **checks that are true for every plan**: dimension chains add up, rooms tile the footprint, printed areas match polygon areas, doors sit in walls. Use these checks to choose between interpretations, instead of hard-coding one interpretation.
2. **Never cut away or change content silently.** Automatic steps propose; the user sees the proposal and can correct it in one action. If an automatic step is unsure, it does nothing and the existing manual path stays.
3. **Every new automatic step has a fallback** that is today's behaviour.
4. **Real user plans are never committed** (names, addresses, plot numbers). Tests use generated plans (see R.8). Developers can run the evaluation against private plans in a local folder that is ignored by git.
5. Prompts must not mention any specific plan, country or architect. Notation rules are listed as a neutral catalogue ("plans may use …"), covering all common conventions.

## Findings that motivate this plan

Analysed on real CAD PDFs (A3 sheets, 1:100). The findings are typical and not specific to these plans:

- The floor plan often covers only 25–40 % of the sheet. The rest is title block, site plan, legend, north arrow and empty space. The model image (≤ 1568 px on the long side for Claude) then gives the building about 500–800 px. Opening labels end up 5–7 px high, and door arcs and window lines blur. **Effective resolution is the main reason for missed doors and windows.**
- CAD PDFs are **vector** drawings with a **text layer**. All dimension texts, room names and area labels are available as exact strings with exact positions. Today we rasterise them and ask the model to read pixels.
- CAD PDFs are usually **true to scale**. The printed scale ("1:100", "M 1:50", "Scale 1:100 @ A3", "1/4" = 1'-0"") plus the PDF unit (1 pt = 1/72 inch) gives the exact metres per pixel. Today the scale comes from the AI or from a manual measurement.
- **Dimension notation varies a lot**, and today's parser assumes "metres, 0.5–100". Examples from common conventions:
  - Central Europe: metres with comma ("3,40"), values below 1 m in centimetres ("49", "87,5"), a raised small "5" for half centimetres ("3,31⁵" = 3.315 m; the PDF text layer often merges it to "3,315" or "175" = 17.5 cm).
  - UK, Nordic, Australia: millimetres only ("3400", "875").
  - US: feet and inches ("12'-6"", "11' 4 1/2"", "2'-10"").
  - Openings are often labelled as width over height ("1,25/1,15", "1250/1150", "3'-0" x 6'-8""). Sometimes a sill height is given ("BRH 90", "SH 900", "sill 3'-0"").
- A wrong unit guess breaks everything downstream. The plan must decide units by **consistency**, not by fixed ranges.

---

## R1: Input pipeline and scale (commit 1)

### R.1 PDF text layer (`frontend/src/pdfload.js`)

Extend `openPdf()` with `text(i)`. For page `i`, return all text items via pdf.js `page.getTextContent()`:

```js
{ str, x, y, w, h, angle }   // in the coordinates of the rendered canvas (use viewport.convertToViewportPoint for both corners)
```

- Respect page rotation (`page.rotate`) and the item transform (`item.transform`). Rotated dimension texts (vertical chains) are common. `angle` is in degrees.
- Merge items that pdf.js split inside one word (same baseline, gap < 0.3 × font height).
- Keep **raised small digits** separate when the font size is < 70 % of the neighbour on the same line and positioned above the baseline: return them as `{ str: '5', sup: true, … }` attached to the preceding item (`supOf`). The notation parser (R.4) decides what it means; pdf.js does not.
- Store the text items in the wizard state (`s.pdfText`) together with the render transform. When the user rotates, crops or warps the image in the align step, transform the positions with the same matrix. The align step already has the transform; reuse it and add a tested helper `mapPoint(p, transform)`.
- Images and photos have no text layer: `s.pdfText = null`. Everything below must work without it.

### R.2 Exact scale from vector PDFs (`frontend/src/pdfscale.js`, new)

1. **Find scale candidates** in the text layer with a catalogue of patterns, case-insensitive:
   - `1:100`, `1 : 50`, `M 1:100`, `M. 1:100`, `Maßstab 1:100`, `Scale 1:100`, `Échelle 1:100`, `Escala 1:100`, `Schaal 1:100`, `Skala 1:100`;
   - `1/4" = 1'-0"`, `1/8" = 1'`, `3/16"=1'-0"` (architectural imperial);
   - `1" = 10'` (engineering imperial);
   - `Scale 1:100 @ A3`, `1:100 (A1)`: paper size hint. If the sheet size differs from the stated paper size, the PDF was scaled for printing; multiply accordingly.
2. **Compute** metres per PDF point: `0.0254 / 72 × ratio` for ratio scales; for imperial, convert `1/4" = 1'` to the ratio 48. Then convert to metres per pixel of the wizard image (render scale and align transform).
3. **Validate before use:** check the candidate against at least one of:
   - dimension chains (R.4): parsed dimension value vs. measured length of its dimension line, median relative error < 2 %;
   - room area labels: polygon area of a room vs. printed area, after the recognition (used as a post-check, see R.6).

   If validation is impossible (no dimensions yet), use the scale but show it as "read from PDF, not verified yet".
4. **Several scales on one sheet** (e.g. "1:100" plan and "1:500" site plan): pick the one that validates. If none validates, do not set a scale.
5. **UI (scale step):** if a scale was found, prefill it and show "Scale 1:100 read from the PDF ✓ checked against 6 dimensions". The user can still measure manually. Measuring overrides.
6. **No silent wrong scale:** if the candidate and the dimension check disagree by > 2 %, show both and ask the user to pick or measure.

This step is optional per plan. Raster images skip it and use today's flow: AI scale reading or manual measurement.

### R.3 Region of interest instead of the full sheet

Goal: the model gets the floor plan of one storey at the highest possible resolution, without title blocks, legends, other drawings or empty space. This must work for any sheet layout. So it is a **proposal**, never a silent crop.

1. **Propose the region (two independent signals, combined):**
   - **AI layout pass** (cheap, fast): send a small overview image (≤ 1024 px) and ask for the bounding boxes of all drawings on the sheet, each with a type: `floor_plan`, `site_plan`, `section`, `elevation`, `title_block`, `legend`, `detail`, `other`. For a `floor_plan`, also give the storey name if printed. JSON only. Works for scans and photos too.
   - **Vector/text signal** (PDF only):
     - text clusters of dimension values (R.4) and room labels mark where a plan is;
     - long straight lines forming closed rectangles at the sheet border mark frames and title blocks.

     Use the signal only to refine the AI box (snap the box to include all dimension chains that belong to it), never alone.
2. **Several floor plans on one sheet:** list them. The user picks which storey to import (chips with thumbnails). The level name comes from the label.
3. **UI (align step):** show the proposed box as an editable rectangle over the sheet, with a hint "Suggested area: floor plan with its dimensions. Adjust if needed." Buttons "Use suggestion" (default), "Whole sheet". The box keeps a margin of 3 % so dimension chains at the edge are not cut.
4. **Rendering:**
   - for vector PDFs, re-render **only the box** with pdf.js at the target resolution (`page.render` with a viewport offset), not a crop of an already rasterised image. This gives sharp lines and text at any zoom;
   - for raster images, crop the full-resolution source.
5. **Coordinates:** everything after the crop (model coordinates, text positions, scale) uses the cropped frame. Keep `x0/z0` and the crop offset so rooms land correctly over the underlay image.

### R.4 Dimension notation parser (`frontend/src/dimtext.js`, new; mirrored in Python where needed)

A pure, tested function `parseDimension(text, context) → [{ metres, unitGuess, confidence }]` that returns **all plausible interpretations**, not one:

- **Metric with comma or point:** "3,40" / "3.40" → 3.40 m (unit m); "340" → 3.40 m (cm) or 0.340 m (mm); "87,5" → 0.875 m (cm); "3400" → 3.40 m (mm).
- **Raised half centimetre:** "3,31" + sup "5" → 3.315 m; merged forms "3,315" (could also be a plain value with three decimals, which is rare but exists); "17" + sup "5" → 0.175 m.
- **Thousands separators and spaces:** "3 400", "3.400", "3,400" are ambiguous: m with three decimals vs. mm with separator. Return both.
- **Imperial:** "12'-6"", "12' 6"", "12'6", "2'-10 1/2"", "10'", "8"" → metres.
- **Width/height pairs:** "1,25/1,15", "1250/1150", "3'-0" x 6'-8"", "B 1,26 H 1,51" → `{ w, h }`.
- **Sill or head prefixes**, configurable list: "BRH", "BR", "SH", "Sill", "Allège", "BH", "OKFF", "FFL", "AFF". Returns `{ kind: 'sill', metres }`.

**Choose the unit by consistency**, not by ranges. `resolveUnits(chains)` takes dimension chains (sequences of segment texts along one line plus the overall text, when present) and picks the unit per text that makes:

- (a) **chain sums match totals** (segments add up to the overall dimension, ±1 cm);
- (b) **measured lengths agree** with one common scale (all `metres / pixelLength` within ±3 %).

This works for every convention without knowing the country. Texts that fit no interpretation are ignored.

The parser is used in three places:

- scale validation (R.2);
- the prompt context (R.5: give the model normalised metres next to the raw text);
- the backend `_detect_post`, which replaces today's `0.5 < m < 100` filter: accept a dimension if one of its interpretations fits the common scale.

### R.5 Prompt: text layer as structured context

When `s.pdfText` exists, add a block to the detection prompt (in `agent.py`, `DETECT_PROMPT`), after cleaning in the client:

```
Text labels printed on the plan (exact, from the PDF; coordinates are pixels of the attached image):
id | text | x | y | angle | interpretation
t12 | 3,31⁵ | 812 | 140 | 0 | length 3.315 m
t57 | 87,5 | 640 | 455 | 90 | length 0.875 m (likely a door width)
t80 | 1,62⁵/1,25 | 402 | 395 | 90 | opening 1.625 × 1.25 m
t91 | Kind 2 | 690 | 430 | 0 | name
t92 | BF: 15,02 m2 | 700 | 447 | 0 | area 15.02 m²
```

- Limit to 400 labels; drop title block texts outside the region of interest.
- **Interpretation** comes from R.4. Classify labels generically:
  - length;
  - width/height pair;
  - area (`m²`, `m2`, `sq ft`, `ft²`, `SF`);
  - level mark (`±0,00`, `+2,85`, `FFL +3.000`, `EL. 10'-0"`);
  - name (anything else with letters);
  - unknown.
- Prompt rules (general, no country names):
  - "Use the label list for all numbers. Do not read numbers from the pixels when a label exists."
  - "Assign every opening label (width/height pair or single width next to a door arc) to the opening it belongs to and return its id as `label`."
  - "Assign every room name and area label to its room (`name_label`, `area_label`)."
  - "Return openings with `width_m` and, when printed, `height_m` and `sill_m`."

The backend uses `label` to replace the model's measured width by the printed width: the opening is centred on the model's position, and the width is taken from the label.

Without a text layer (images), keep today's prompt but add the neutral **notation catalogue**:

```
Plans use different notations. Lengths may be in metres ("3,40" or "3.40"),
centimetres for values under 1 m ("87,5"), millimetres ("3400"), or feet and inches ("12'-6"").
A small raised digit after a number adds half a unit of the last digit ("3,31⁵" = 3.315).
Opening labels are often "width/height".
Return the printed text of every dimension you use, unchanged, in "text", in addition to your numeric value.
```

The backend then re-parses `text` with R.4 instead of trusting the model's number.

### R.6 Model-aware image size and format

- New option `image_max_px` in the integration options (`options.py`, `config_flow.py`), default "auto":
  - Claude models (`anthropic/` or `claude` in the model id): 1568 px long side; for very elongated regions also respect the total pixel budget of the provider (about 1.15 MP);
  - Gemini: 3072;
  - GPT: 2048;
  - others: 2048.

  The user can set a number (512–4096). Write the mapping in one table in `agent.py` and send the effective size to the panel with `agent/info`.
- Send line drawings as **PNG, greyscale** (`toDataURL('image/png')` after a greyscale pass). They compress well and keep thin lines and small text intact. Keep JPEG for photos (detected by colour variance > threshold).
- Never upscale beyond the source resolution for raster images. For vector PDFs, render the region of interest at exactly the target size.

### R.7 Scale fallbacks (no abort when rooms exist)

Order of scale sources, first that validates wins:

1. user measurement;
2. PDF scale (R.2);
3. dimension chains via R.4 (consistency-checked);
4. **printed room areas**: median of `sqrt(printed m² / polygon px²)` over rooms with an area label, at least 3 rooms, spread < 5 %;
5. printed clear room dimensions (`clear_w` / `clear_d`).

If none works but rooms were recognised, **do not abort**. Return the rooms with `scale_source: 'unknown'`. The wizard jumps to the scale step with the rooms already kept: "Rooms recognised. Please measure one known length to set the scale". After measuring, the rooms are rescaled without a new AI call.

### R1 tests

- `tools/test-dimtext.mjs` (Node, CI):
  - parser cases for every notation above, including ambiguous ones (several interpretations returned);
  - `resolveUnits` on synthetic chains: metric cm/m mix with raised halves, mm only, imperial, and a chain with one wrong segment (must be ignored, not break the others).
- `tools/test-pdfscale.mjs` (Node, CI) with generated PDFs (R.8):
  - scale text variants;
  - rotated page;
  - a sheet with two scales;
  - a PDF scaled to another paper size;
  - no scale text.
- `tools/test-detect-parsing.py`: add cases for `text`-based dimensions, label-based opening widths, scale from areas, and `scale_source: 'unknown'` with rooms kept.
- Browser test `tools/test-recognition-pipeline.mjs`:
  - load a generated vector PDF;
  - check the proposed region box, the scale prefilled and verified, the text labels sent in the request (inspect the mocked `detect_start` payload) and the PNG format;
  - load a generated photo-like raster plan: region proposal works with a mocked layout pass, and there is no text layer.

---

## R2: Openings in detail (commit 2)

### R.8 Generated test plans (`tools/plangen.mjs`, new; needed for R1 too)

Write a generator that produces floor plans with **known ground truth** in different drawing conventions, as vector PDF (via a minimal PDF writer or `pdf-lib`, MIT) and as PNG raster (same drawing rendered with canvas, optionally with blur and noise like a scan). Each plan comes with `truth.json`:

- rooms (polygons in metres), openings (type, from/to, width, height, sill, hinge side, swing room), stairs, scale.

Variations, randomised by seed:

- **Conventions:**
  - metric m/cm with raised halves;
  - metric mm;
  - imperial ft-in.
- **Window symbols:** two or three lines.
- **Door symbols:** arc + leaf, leaf only, sliding door.
- **Sheet layouts:**
  - title block right, bottom or none;
  - site plan around the house;
  - two floor plans on one sheet;
  - legend.
- **Sheet sizes:** A4, A3, A1, US Letter, ANSI D.
- **Rotation:** 0/90°, and slight skew for raster.

Commit only the generator and the seeds, not the generated files (generate them in the test run). **No real plans in the repository.**

### R.9 Openings pass with high-resolution tiles

After the rooms pass (and before the self-check pass), run a dedicated openings pass:

1. Split the region of interest into tiles that fit the model's image size at **at least 120 px per metre**. That is usually 2–6 tiles, with 15 % overlap.
2. Per tile (in parallel, max 4 at a time):
   - send the tile image and the rooms (polygons transformed into tile pixels, as text);
   - send the text labels that fall into the tile (R.5);
   - send the known walls of that tile as segment list `[x1, y1, x2, y2, exterior|interior]`.
   - Ask: "List every door, window, glazed door, sliding door, garage door and opening without door that lies on these walls. For each give the wall segment index, the start and end along the wall, type, printed label id if any, hinge side (`start|end`), the room the door swings into, and for windows sill/height if printed."
3. **Merge:**
   - transform back to plan metres;
   - snap to the wall segment;
   - deduplicate across tile overlaps: same wall and > 50 % overlap → keep the one with a label, else the wider one;
   - drop openings that are not on any wall.
4. **Merge with the rooms pass:** the openings pass wins where both found an opening. Openings only in the rooms pass are kept but marked `uncertain`; the review step shows them dashed.
5. Option in the recognition step: "Detailed doors and windows (slower)" (default on for PDFs and images larger than the model size; off otherwise). Shows the extra time and cost estimate in the hint.

### R.10 Door swing and window heights in the data model

- `opening.hinge: 'from' | 'to'`: which end of `from`/`to` the hinge is at. Default today's behaviour: `from`.
- `opening.swing: 1 | -1`: the side of the wall (relative to the wall normal `l.nx/l.nz` as used in `house.js`) the leaf opens into. Default today's `-s.side`.

  Recognition returns the room the door swings into; the client converts it to the side.
- `opening.sill`, `opening.head` exist already; fill them from labels (width/height pairs: `head = sill + height`). Use the sill default from the level when only height is known: 0.9 m for windows narrower than 2 m; 0 for glazed doors (height ≥ 1.9 m with a door symbol).
- `house.js`:
  - use `hinge` for the hinge position (`s.a` vs. `s.b`) and `swing` for the rotation direction;
  - draw the plan symbol (door arc in the top view) accordingly.
- Editor: opening inspector gets "Hinge: left/right" and "Opens into: <room A>/<room B>" toggles.
- The wizard review step shows door arcs with the recognised swing. Clicking an arc flips the swing; Alt-click flips the hinge.

### R.11 Completeness checks in the review step

Generic checks (no country rules), shown as hints like today's "room without door":

- An indoor room with an exterior wall longer than 2 m and no window: "No window found in X. Add one or confirm it has none." (one tap: "has none").
- Opening labels from the text layer (R.5) that no opening references: "Label 1,25/1,15 near Kind 2 has no window". Tap → the wizard proposes a window at the nearest wall.
- A door narrower than 0.6 m or wider than 2.5 m without a garage type; a window wider than 6 m.
- Printed room area vs. polygon area (exists today).

### R2 tests

- **Evaluation script `tools/eval-recognition.mjs`.** It is not part of CI because it needs an API key; run it manually and before releases.
  - It runs the full pipeline against the generated plans, optionally against a local folder of private plans (`HOMETWIN_EVAL_DIR`, ignored by git; each plan has a hand-made `truth.json`), with the configured model.
  - Metrics per plan:
    - **rooms:** IoU ≥ 0.9 share, area error;
    - **openings:** precision and recall matched on wall position ±0.3 m; width error; swing correct;
    - **scale:** error, plus time and cost.
  - Writes a Markdown table to stdout. Use it to compare models (Claude, Gemini, GPT) and prompt changes. Commit the results for generated plans to `docs/eval/` (no private data).
- Unit tests (CI): tile layout, back-transform, deduplication, hinge/swing conversion, completeness checks, `house.js` door orientation for all four hinge/swing combinations (raycast the leaf position).
- Browser test: review step shows uncertain openings dashed, click flips swing, hints appear and resolve.

---

## Acceptance

- Vector PDFs with a printed scale: the scale is set without AI and without measuring, and verified against dimensions.
- Recognition never ends in an error when rooms were recognised. A missing scale leads to a measurement step that keeps the rooms.
- On the generated evaluation set:
  - opening recall ≥ 95 %, width error ≤ 5 cm with labels, swing correct ≥ 90 %;
  - room IoU ≥ 0.9 for ≥ 95 % of rooms;
  - this holds for all conventions (m/cm, mm, ft-in) and layouts.
- Raster images and photos still work at least as well as today (same evaluation, raster variants).
- No real plan, name or address in the repository.

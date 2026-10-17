# Plan 1: Building envelope (roofs as parts · exterior photos and elevations)

Two parts, one branch `feature/building-envelope`, two commits (B, then C). B can ship alone; C depends on B only for the roof suggestions.

Read [README.md](README.md) (rules for all plans) first.

---

## Part B: Roofs as a list of equal parts

### B.1 Problem today

- There is one **main roof** in `plan.site.roof` and a separate list of **extra roofs** in `plan.site.roofs[]` (garage, carport, garden house).
- They behave differently:
  - The main roof is always built on the **top storey** (`Stage.topLevel()` in `scene.js`). Its rectangle comes from all indoor rooms of that storey unless `site.roof.rect` is set (`roofRect()` in `roof.js`).
  - Extra roofs are built in `Stage.extraRoofs()` (`scene.js`) via `buildExtraRoof()` (`roof.js`). They have `levelId`, `height`, `rect` and `posts`.
  - Solar arrays (`site.solar[]`) and roof windows/dormers (`site.roofItems[]`) only work on the main roof. They reference a plane by index (`plane`).
  - The editor has two different inspectors (`s.type === 'roof'` and `s.type === 'xroof'` in `editor.js`). Corner handles exist only for the main roof (`roofHandles()`, `drag.roofCorner`). Extra roofs are created with the tool `roofrect` and edited with number fields only.
  - The assistant's roof step (`roofStep()` in `wizard.js`) writes the main roof and optionally adds flat extra roofs for garages and carports.
  - `normalize()` in `plan.js` creates extra roofs for older plans (`garageFlat`).
- Users find the extra roofs hard to configure. A house with an extension, a garage and a carport needs several roofs of the same quality.

### B.2 Target

- `plan.site.roofs[]` is the **only** roof list. Every roof is a full roof: any type (`flat`, `shed`, `gable`, `hip`, `pyramid`), pitch, overhang, cover, colour, details and style. Any roof can carry solar arrays and roof windows.
- There is no "main roof" any more in the data. For defaults and UI order, the first roof in the list is the "primary" roof.
- In the editor: **"+ Roof"** creates a roof over the selected rooms, or lets the user draw a rectangle. Every roof has the same inspector and the same corner handles in 2D and 3D.
- The assistant still proposes roofs: one per building part (main house, garage, carport, extension). The user can untick each proposal.
- The AI agent can create and change roofs via ops.

### B.3 Data model (plan version 3)

Bump `PLAN_VERSION` in `plan.js` from 2 to 3.

```js
// plan.site
{
  roofs: [Roof, ...],      // the only roof list; order = display order, roofs[0] = primary
  solar: [{ ..., roofId }],      // NEW field roofId (required after migration)
  roofItems: [{ ..., roofId }],  // NEW field roofId (required after migration)
  // site.roof is REMOVED after migration
}

// Roof
{
  id: 'rf...',              // newId('rf'); migrated extra roofs keep their 'xr...' ids
  name: 'House',            // user-visible
  levelId: 'l...',          // storey whose floor the roof height is measured from
  base: 2.6,                // eave base above that floor in metres. Default: level.height (roof sits on the walls)
  rect: { cx, cz, length, width, rot } | null,  // null = automatic from `rooms`
  rooms: ['r1', 'r2'] | null, // rooms the automatic rect is computed from (bbox). null + rect null = all indoor rooms of the level
  type: 'gable', pitch: 35, overhang: 0.4, overhangGable: 0.4, knee: 0, ridge: 'x' | 'z' | undefined,
  ridgeOffset: 0, cover: 'pfanne', color: '#7d3a2c', details: { ...DEFAULT_DETAILS }, style: 'classic' | undefined,
  posts: false,             // carport posts (existing behaviour of extra roofs)
}
```

Rules:

- `rect` wins over `rooms`. When the user drags a corner, the roof gets an explicit `rect` and `rooms` is kept only as information.
- The "automatic" rectangle is the bounding box of the given rooms, aligned like today's `roofRect()` (ridge along the longer side unless `ridge` is set). Keep the existing behaviour that garages are excluded from the automatic main roof when they get their own roof.

### B.4 Migration (in `plan.js`)

Write a pure function `migrateRoofsV3(plan)` and call it from `migrate()` for `version === 2` (and after v1 → v2). Then set `version = 3`. Export it for tests.

1. Start with `roofs = []`.
2. If `site.roof` exists and `site.roof.type` is set and not `'none'`:
   - Create the primary roof from `site.roof` (copy every field). Use `id: 'rfmain'`, the name `t('data.defaults.roofMain')` (new key: "House" / "Haus"), and `levelId` = id of the top storey with indoor rooms (same rule as `Stage.topLevel()`).
   - Set `base` = that level's `height`. Set `rect` = `site.roof.rect || null` and `rooms = null`.
   - If `site.roof.garageFlat !== false`, the automatic rect must still exclude garages. Store that as `rooms` = ids of the non-garage indoor rooms of the top level, only when `rect` is null.
3. Append every entry of the old `site.roofs[]` (extra roofs). Map `height` → `base` and keep all other fields.
4. Set `roofId` on every `site.solar[i]` and `site.roofItems[i]` without one: the primary roof id, or drop the item if no roof exists.
5. `delete site.roof`, set `site.roofs = roofs`.
6. The old "garages without storey above get a flat roof" block in `normalize()` must run **before** this migration (it fills the old `site.roofs` from `garageFlat`). Afterwards `normalize()` only ensures `site.roofs` is an array.

`DEFAULT_SITE()` must no longer contain `roof`. `emptyPlan()` gets `roofs: []`. `demoPlan()` must be rewritten to the new shape (one gable roof for the house plus the existing garage roof, with `roofId` on the PV array and the roof window).

**Do not break old backups:** `tools/test-roofs.mjs` (see B.10) must migrate a stored v2 demo plan and a v2 plan with garages and carport.

### B.5 Helper module `frontend/src/roofs.js` (new)

Keep all roof bookkeeping in one place so the other modules do not touch `site.roofs` directly:

```js
export function roofLevel(plan, roof)            // level object or the top indoor level as fallback
export function roofRectOf(plan, roof, isIndoor) // explicit rect, or computed from rooms / level (moves today's roofRect logic here)
export function addRoof(plan, init)              // creates with defaults, returns the roof
export function roofOverRooms(plan, levelId, roomIds, opts) // used by "+ Roof over selection" and by the assistant
export function removeRoof(plan, id)             // also removes solar/roofItems with that roofId
export function primaryRoof(plan)                // roofs[0] or null
export function hasRoof(plan)                    // replaces panel.hasRoof()
```

Defaults for a new roof:

- `type`: `'gable'` over living rooms; `'flat'` for garages and carports (`posts: true` for carports).
- Pitch 35 (flat: 3), overhang 0.4 (flat: 0.15).
- Cover `'pfanne'` (flat: `'kies'`, carport: `'blech'`); colour from `ROOF_COVERS`.
- `base` = level height (carport: 2.3).
- Name from the room names ("Garage"), else `t('data.defaults.roofNumber', { number })`.

### B.6 Rendering (`roof.js`, `scene.js`)

1. Change `buildRoof(level, site, isIndoor)` to `buildRoof(roof, ctx)` with `ctx = { site, rect, base, solar, items, isIndoor }`.
   - `rect` comes from `roofRectOf`. `solar` and `items` are the entries filtered by `roofId`.
   - Inside, replace `site.roof` with `roof` and `level.height` with `base`.
   - Merge the carport posts code from `buildExtraRoof` into `buildRoof` (when `roof.posts`). Delete `buildExtraRoof` and `newExtraRoof`.
2. In `scene.js`, replace the two code paths (`o.roof` on the top level in `layout()` and `extraRoofs()`) with one: `this.roofs = new Map(roofId → { group, built })`.
   - Each roof group is added to the **group of its level** (`this.levels.get(roof.levelId).group`), so it moves with explode, rise animation and level visibility.
   - Tag every mesh with `userData.roof = roof.id` (replaces `userData.xroof`) and `userData.roofPlane = index`.
3. **Rebuild only when needed.** Today `layout()` rebuilds the main roof on every call, which happens on every level switch, and leaks a few geometries each time (measured: +29 geometries for 10 level switches).
   - Keep a signature per roof: `JSON.stringify(roof) + rect + base + facade + solar/items of that roof`. Rebuild only if it changed.
   - In `layout()`, only toggle visibility.
   - Dispose geometries and non-shared materials of a replaced roof.
4. Visibility rules (from today's `layout()`): roofs are shown when `app.roofOn` and not in exploded view and not in top view. In the scope `'roof'`, the level under each roof is ghosted (today only the top level).
   - Generalise: a level is ghosted if any visible roof stands on it.
5. `roof.update(states, t)` must be called for every built roof (today `o.roof?.update`). It animates the PV values and roof window covers.
6. `Stage.frame('roof')` frames the bounding box of all roofs.
7. Picking (`Stage.pick`): `userData.roof` returns `{ type: 'roof', id }`, and solar/roof items keep their own types.

### B.7 Editor (`editor.js`)

1. **Tree (left panel):** under the house, one row per roof (`type: 'roof', id`), each with its solar arrays and roof items as children. Remove the `xroof` type everywhere: select, delete, inspector, `_pendingPick`, tooltips in `panel.js`.
2. **"+ Roof" button** in the toolbar of the roof scope and in the house inspector. Behaviour:
   - If one or more rooms are selected (multi-select exists for rooms? If not, use the single selected room): create a roof over these rooms with `roofOverRooms`.
   - Otherwise switch to the existing draw tool `roofrect` (rename the hint to "Draw a rectangle for the new roof"). On release, create a roof with an explicit `rect` on the active level.
   - Select the new roof and open its inspector.
3. **One inspector** for every roof, based on today's main-roof inspector (`s.type === 'roof'`, around `editor.js` line 394). Add:
   - Name, storey (`levelId` select), base height (`base`, number, hint "eaves above the floor of the storey"), and "Fit to rooms" (sets `rect = null` and offers a room multi-checkbox list for `rooms`).
   - Carport posts checkbox.
   - Duplicate, rotate 90°, delete (from today's `xrDup` / `xrRot90`).
   - The style presets (`ROOF_STYLES`, `applyStyle`) apply to the selected roof. `applyStyle(site, key)` becomes `applyStyle(site, roof, key)`; the facade part of a style still changes `site.facade`.
4. **Corner handles for every roof:** generalise `roofHandles()` / `drag.roofCorner` (editor lines ~88, ~792, ~842, ~888) to work on the selected roof (`app.sel.type === 'roof'`) instead of `site.roof`.
   - Also add an edge handle per side (drag one side, the opposite side stays).
   - Add a centre handle (move) and a rotation handle (snap 15°, Shift = free).
   - Snap edges to wall outer faces (±0.12 m from room edges) within 0.15 m. This makes roofs fit the house exactly.
5. Solar and roof item inspectors: add a roof select (`roofId`). The plane list comes from the built roof of that id (today it searches `stage.levels` for `o.roof`, lines ~460 and ~478).
6. The dimension overlay (`setDim` around line 981) works on the selected roof.

### B.8 Assistant roof step (`wizard.js`, `roofStep()`)

Replace the single main-roof form with a list of proposals:

1. Build the proposals:
   - **Main house:** one proposal over all `kind: 'room'` rooms of the top storey, with type, pitch and ridge from `this.st.result.roof` (AI hint) or defaults.
   - **Garage / outdoor room named carport, Überdachung or Vordach** (reuse today's `extras` filter): one proposal per room, unless a roof already covers it.
   - **Extension:** if a room cluster of the top storey is far from the main bbox (rooms not touching the main cluster), propose its own roof. Clusters = connected components of rooms sharing an edge (use `edges()` from `geometry.js`).
2. Show one card per proposal with a checkbox (default on), type select, pitch, ridge direction and a small top-view thumbnail (canvas 120 × 90: room polygons grey, roof rect outline).
3. **"Apply"** creates the ticked roofs with `roofOverRooms`. If the plan already has roofs, ask with two radio buttons: "Replace existing roofs" (default) or "Add".
4. Keep the existing i18n keys where the meaning is unchanged. Add new keys for card labels.

### B.9 AI agent (`custom_components/hometwin/agent.py` and `plan.js` ops)

New ops in `applyOps` and as tools in `_tools()`:

- `add_roof { level_id, rooms?: [room ids], rect?: {cx,cz,length,width,rot}, type, pitch?, overhang?, cover?, color?, base?, posts?, name? }` → returns `{ ok, id }`
- `update_roof { roof_id, ...same fields }`
- `delete_roof { roof_id }`

Also:

- Add roofs to `_plan_summary()`: id, name, level, type, pitch, rect.
- Add one rule to `CORE_PROMPT`: "Roofs are parts: one roof per building part; a garage or carport gets its own flat roof."
- Python validates numbers and ranges: pitch 0–70, overhang 0–1.5, base 1.8–6.

### B.10 Tests for B

- **`tools/test-roofs.mjs`** (Node, add to CI):
  - Migration v2 → v3: demo plan, plan with `garageFlat`, plan without roof, plan with roof `none`, plan with an explicit `rect`.
  - Check `roofId` on solar and roof items, and that no `site.roof` remains.
  - `roofRectOf` for rooms vs explicit rect.
  - `add_roof` / `update_roof` / `delete_roof` ops, including that `delete_roof` removes its solar arrays.
  - Building each roof type: mesh count > 0, bounding box inside rect + overhang.
  - Building twice with the same signature does not create new geometries.
- **`tools/test-roofs-browser.mjs`** (Playwright, desktop and phone):
  - Demo shows two roofs.
  - Select a room → "+ Roof" → a third roof appears.
  - Drag a corner handle in top view → rect changes and stays after reload (`hass` sim keeps the plan).
  - PV array on the garage roof renders.
  - Delete roof → its PV array is gone.
  - Undo restores it.
  - Screenshots: whole house, roof scope, inspector.
- `test-localization-editor.mjs` and `test-localization-wizard.mjs` must still pass. Update their selectors if the roof inspector changed.

### B.11 Pitfalls

- `site.roof` is read in many places (`grep -n "site.roof" frontend/src/*.js`). Replace every one; the build must not contain `site.roof` afterwards (add an assertion to `test-roofs.mjs` that greps the bundle).
- `panel.hasRoof()` and `levelSel === 'roof'` logic use the top level; switch to `hasRoof(plan)`.
- Rise animation (`scene.js` ~line 486) has a special item `__xroofs`. With roofs inside level groups, remove it.
- The sun shadow frustum (`fitSunShadow`) must include all roofs.
- `sh3d.js` import may create a roof; check it.

---

## Part C: Exterior photos and elevation drawings ("Exterior & materials")

### C.1 Goal

Users can optionally upload **any number of images** of the outside of their house: photos and architect elevation drawings ("Ansicht Nord"). The AI:

1. classifies each image (photo / elevation drawing / other) and suggests the compass side (N, E, S, W);
2. reads the facade material and colour, plinth colour and height, window frame colour, roof covering and colour;
3. from elevation drawings it can also read: roof pitch, eave and ridge height, knee wall, storey heights, sill and head heights of windows.

The user confirms or corrects the side per image (one tap on a chip) and accepts each suggestion individually (before/after). Nothing changes without confirmation. Users without such images are not affected; the feature is optional.

### C.2 Where it lives in the UI

- **New modal "Exterior & materials"**, a separate class `ExteriorAssistant` in a new file `frontend/src/exterior.js`. Reuse the wizard styles (`.wz-*` classes in `styles.js`); do not put more code into `wizard.js` (already 900 lines).
- **Entry points:**
  1. On the assistant's final screen ("Next steps") a button "Exterior & materials (optional)".
  2. In the house inspector, Facade section: button "From photos or elevations…".
  3. Edit menu (`treemenu.js`): "Exterior & materials…".
- Without a configured AI (`agent/info` → `configured: false`), the modal still opens. It shows the manual pickers (facade material/colour, plinth, frames, roof cover/colour) and a hint that AI can fill them from images.

### C.3 Steps of the modal

1. **Images:** drop zone and file picker (multiple, `image/*` and PDF via `pdfload.js`, first page or a page picker as in the floor-plan wizard).
   - Shows thumbnails in a grid. Remove button per image.
   - Limit 12 images. Downscale on the client to max 1600 px on the long side, JPEG quality 0.85 (use `limit()` from `wizard.js` → move it to a shared helper `frontend/src/imageutil.js`).
2. **Analyse:** one background job for all images (see C.5). Progress text per image ("2 / 5 analysed"). Cancel button.
3. **Assign sides:** per image a card with thumbnail, type chip (Photo / Elevation / Other) and side chips **N · E · S · W · ?**, with the AI's suggestion preselected and a confidence badge ("sure" / "guess"). The user taps to correct.
   - A small compass of the floor plan (outline of the ground floor, north arrow from `site.north`) helps the user. Tapping a chip highlights that facade in the compass.
4. **Suggestions:** a table grouped into Facade, Plinth, Windows, Roof (per roof, from part B) and Heights. Each row shows:
   - property name;
   - current value (swatch or number);
   - suggested value (swatch or number);
   - source (thumbnail and side);
   - a checkbox (default on for colours/materials with confidence ≥ 0.5, **off** for heights);
   - an edit field (colour input / number input) to tweak the suggested value.

   Conflicts (two images disagree): show both values as radio options. Default: drawing wins for geometry; photo wins for colours; higher confidence wins otherwise.
5. **Apply:** one undo step (`app.pushUndo()`), apply ticked values, rebuild, close. Toast "n changes applied". Show a live 3D preview behind the modal while toggling checkboxes? Optional: only if cheap. Apply on a cloned plan and call `stage.rebuildAll()` with a debounce of 300 ms; revert on cancel.

### C.4 How the AI knows the side (important)

The AI cannot know the compass direction from a photo alone. Give it a **facade signature** of the plan for each side, computed on the client:

- For each compass side, take the exterior wall segments of the **ground storey** whose outward normal is within ±45° of that side. Use `wallSegments` logic from `house.js` (export a light helper `exteriorFacades(level, north)` from `house.js` that returns `[{ side: 'S', length, openings: [{ type, width, sill, head, offset }] }]`).
- Convert to a short text, e.g. `S: length 11.5 m; from left: window 1.2, door 1.0, window 2.4 (terrace door), garage door 2.5`. "Left" is the left side when looking at that facade from outside.
- The prompt asks the model to match each image to the side whose opening sequence fits best, and to say how sure it is (0–1).
- Elevation drawings usually have a title ("Ansicht Süd", "Südansicht", "South elevation"). The model should read it and give it priority.

`site.north` is the compass angle of plan "up". Convert a wall's outward normal (nx, nz in plan space) to a compass bearing with the same formula as in `sun.js`. Write it as a tested helper `bearingOfNormal(nx, nz, north)` in `geometry.js`.

### C.5 Backend (`agent.py`, `websocket.py`)

New websocket command `hometwin/agent/exterior_start` with schema:

- `images: [{ id: str, data: str (base64 JPEG), width: int, height: int }]` (max 12; reject more)
- `signature: str` (facade signature text, max 4000 chars)
- `north: number`
- `levels: [{ name, elevation, height }]`
- `roofs: [{ id, name, type, pitch }]`
- `language: 'en' | 'de'`

It starts a job like `start_detect_job` and returns `{ job_id }`. Progress and result come through the existing `hometwin/agent/job` and `job_consume` commands. Store the job kind so `job_state` returns the right result shape.

`run_exterior(hass, cfg, req, progress)`:

1. **One model call per image** (more robust than one call with 12 images, and gives progress). The system prompt is `EXTERIOR_PROMPT` and the user content is the signature plus the image. Ask for JSON only:

```json
{
  "kind": "photo | elevation | other",
  "side": "N | E | S | W | null",
  "side_confidence": 0.0,
  "side_reason": "short text",
  "facade": { "material": "plaster | brick | wood | stone | panel | null", "color": "#rrggbb | null", "confidence": 0.0 },
  "plinth": { "color": "#rrggbb | null", "height_m": null, "confidence": 0.0 },
  "window_frame": { "color": "#rrggbb | null", "confidence": 0.0 },
  "roof": { "cover": "pfanne | biber | schiefer | blech | kies | gruen | null", "color": "#rrggbb | null", "pitch_deg": null, "eave_height_m": null, "ridge_height_m": null, "knee_m": null, "confidence": 0.0 },
  "storeys": [{ "name": "EG", "floor_level_m": 0.0 }],
  "windows": [{ "sill_m": 0.9, "head_m": 2.2 }],
  "notes": "short"
}
```

2. **Prompt rules** (write them carefully; they decide the quality):
   - Colours: describe the paint colour under neutral daylight, compensating for shadow, sky tint and white balance. Return the colour of a sunlit, unshaded part. Never return pure white or black unless clearly painted so.
   - Heights only from dimension chains or level marks in drawings (`±0,00`, `+2,85`, `OKFF`, `Traufe`, `First`), relative to ±0.00. Never estimate heights from photos (return null).
   - Map German terms: Putz → plaster, Klinker/Verblender → brick, Holzschalung → wood, Dachziegel/Pfanne → pfanne, Biberschwanz → biber, Schiefer → schiefer, Blech/Stehfalz → blech, Kies → kies, Gründach → gruen.
   - Use the cover list from `roof.js` `ROOF_COVERS`; read it at runtime from the catalog (`catalog.mjs` → `catalog.json`) so the lists stay in sync.
3. Validate and clean in Python:
   - Hex colours with regex.
   - Clamp numbers: pitch 0–70, heights −5–20.
   - Drop unknown enum values. Missing fields → null.
4. Progress: `progress({ done: i, total: n })` after each image.
5. Errors per image do not fail the whole job: return `{ id, error }` for that image.

Model requirements: the configured model must support images (same as floor-plan detection). Reuse the same config and reasoning options.

### C.6 Merge logic (client, `exterior.js`, pure functions, unit-tested)

- `mergeFindings(results, sides)` → suggestions per property.
  - Colours: weighted average in **Lab** colour space (write `hexToLab`/`labToHex` helpers; do not average in RGB), weighted by confidence.
  - If two colour clusters differ by ΔE > 15, return a conflict with both values.
- Heights: only from `kind === 'elevation'`.
  - **Eave and ridge heights** are measured from ±0.00. Convert them to the roof's `base` relative to its level: `base = eave − level.elevation`.
  - **Pitch from heights:** if the drawing gives both eave and ridge height plus the gable width of that side, then `pitch = atan((ridge − eave) / (width / 2))`. Only for gable roofs whose gable faces that side.
  - **Storey floor levels:** suggest `elevation` / `height` / `slab` changes using `fitNewLevel` logic from patch A (`plan.js`), never breaking the gap-free stack.
- Window sill and head heights: suggest per facade side, applying to all windows on that side that have default values (sill 0.9 / head 2.2). Show the count ("applies to 4 windows on the south side").
- Map facade material `stone` and `panel` to the nearest existing `FACADES` key until such materials exist (`stone` → `brick` with grey colour, `panel` → `plaster`), and note it in the row.

### C.7 Data stored in the plan

- **Do not store the images** (privacy, size). The user can choose "keep images" (checkbox, default off). If on, store them like underlays via a new endpoint `/api/hometwin/exterior/<id>` in `views.py` (same pattern and size limit as underlays), referenced in `site.exteriorImages = [{ id, side, kind, w, h }]`.
- Always store a small record `site.exteriorSource = { appliedAt, sides: { N: 'photo', S: 'elevation' } }` so the UI can say "Colours from photos (N, S)".

### C.8 New plan fields used by C

- `site.facade.plinthHeight` (exists since patch A).
- Roof `color`, `cover`, `pitch`, `knee`, `base` (part B).
- Optional `site.facade.material` gets two new values `stone` and `panel` **only if** you also add textures for them in `roof.js` (`facadeTexture`). Otherwise use the mapping in C.6.

### C.9 Tests for C

- **`tools/test-exterior.mjs`** (Node, CI):
  - `bearingOfNormal` for all four sides and `north` 0/90/−45.
  - `exteriorFacades` on the demo plan: four sides, opening order from left as seen from outside.
  - Lab conversion round trip (ΔE < 0.5).
  - `mergeFindings`: weighted average, conflict detection, drawing beats photo for heights, photo heights ignored.
  - Eave → base conversion and pitch from heights.
- **Python:** a test with a stubbed `_post` returning fixed JSON (valid, partially invalid, garbage) → cleaned result. No HA needed (see existing `tools/test-language-options.py` for the stub style).
- **`tools/test-exterior-browser.mjs`** (Playwright, desktop and phone, English and German):
  - Mock the job (like `test-localization-wizard.mjs` mocks `runJob`).
  - Generate two canvas images in the test: a coloured house photo-like drawing and a line elevation with "Ansicht Süd" text.
  - Check side chips and change one side.
  - Check that heights are unticked by default.
  - Apply and check that facade colour and roof cover changed and that one undo restores everything.
  - Check that no AI configuration shows the manual pickers.
- Screenshots of every step; look at them on phone width (390 px). The table must not scroll horizontally.

### C.10 Pitfalls

- Big base64 payloads: HA websocket messages have a size limit (default 4 MB on some setups). Send **one image per message**: `exterior_start` creates the job with metadata only, then `exterior_add_image { job_id, image }` per image, then `exterior_run { job_id }`. Implement this split from the start.
- HEIC photos from iPhones: browsers on iOS convert to JPEG on upload with `accept="image/*"`; desktop Chrome cannot decode HEIC. Show a clear error ("HEIC is not supported; export as JPEG").
- EXIF orientation: use `createImageBitmap(file, { imageOrientation: 'from-image' })`.
- Do not send the floor-plan underlay images again; only the signature text.

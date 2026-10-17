# Plan 2: Building parts library and wall editor

One branch `feature/parts-and-walls`, two parts with separate commits:

- **D:** windows, doors, garage doors (then stairs and railings) become **library parts** that the community can contribute, like furniture today.
- **F:** a **wall editor**. The user picks a wall face (inside or outside), the wall appears flat in front of them as a canvas, and they arrange lamps, posters, picture frames and other wall objects on it.

D and F share the library and placement code. Do D first.

Read [README.md](README.md) (rules for all plans) and `skills/add-object/SKILL.md` (how library objects work) first.

---

## Part D: Building parts as library objects

### D.1 Today

- `frontend/src/house.js` builds every opening procedurally inside `buildLevel()`:
  - Windows: glass pane, frame bars, a middle mullion when wider than 1.3 m, roller shutter.
  - Doors: one leaf on a hinge group.
  - Garage doors: a textured panel that slides up.
- Openings in the plan (`level.openings[]`) are `{ id, type: 'door'|'window'|'garage'|'open', from, to, sill?, head?, cover?, contact? }`.
- Animation state lives in `house.windows[id] = { glassMat, shutter, cur }`, `house.doors[id] = { hinge, base, swing, cur, ext }`, `house.garages[id] = { panel, cur }` and is driven in `Stage.tick()` (`scene.js`) from HA states.
- Library objects (`library/`) are recipes (`recipe.json`) built by `engine/recipe.js` → `buildRecipe(recipe, overrides)`.
  - Recipes have `params` (numbers, with `default`/`min`/`max`), parts (`box`, `cylinder`, `extrude`, `lathe`, `screen`, …) and materials.
  - Parts with a `role` are kept as separate meshes (today only `role: 'screen'`).
  - Library objects become furniture types `lib:<id>` (`registerLibrary()` in `furniture.js`).

### D.2 Target

- An opening can reference a library part: `opening.part = 'generic/building/window/two-sash'`. Without `part`, the built-in default part of that type is used.
- The **built-in defaults are themselves recipes** in `library/generic/building/...`. So the code path is the same for all, and the community can copy them.
- Parts are **parametric**. The panel passes the opening size and wall thickness; the part fills it exactly.
- Animated pieces are found by **roles**. The panel animates them exactly like today.

### D.3 Role contract (extend `library/schema/recipe.schema.json`)

Add these values to the `role` enum. Document each in the schema description and in `skills/add-object/references/` (new file `building-parts.md`).

| Role | Used by | Meaning and pivot rule |
|---|---|---|
| `frame` | window, door, garage | Static frame. Merged with other static parts. (The role only documents intent; it may be omitted.) |
| `glass` | window, door | Glass. The panel replaces its material with the live glass material (emissive when the contact sensor is open). Keep it a single part. |
| `leaf` | door | Door leaf. **Must be a `group` whose origin is the hinge axis** at local x = 0, y = 0. The leaf extends towards +x. The panel rotates this group around y. |
| `sash` | window (optional) | Opening window sash, same pivot rule as `leaf` (hinge at x = 0). If present and a contact sensor is set, it opens 15°. |
| `shutter` | window | Roller shutter or blind curtain. **Origin at its top edge**, hanging down (−y). The panel scales it in y from 0.02 (open) to 1 (closed). |
| `panel` | garage | Garage door panel. **Origin at its top edge**; the panel scales/moves it in y like today's garage door. |
| `handle` | window, door | Small static part, never merged (allows a different material). |

Injected params (the panel always passes these; the recipe must declare them with defaults):

- `w`: clear opening width (m) = `|to − from|`
- `h`: clear opening height (m): window = `head − sill`; door/garage = `head`
- `t`: wall thickness (m): `EXT_T` (0.24) or `INT_T` (0.11)
- `side`: +1 or −1, the side the leaf opens towards (`-s.side` today); recipes can ignore it

Coordinate frame of a building part (write this into the schema and the reference doc):

- Origin at the **bottom-left corner of the opening, on the wall centre plane**, seen from the side the opening is placed from. For windows, "bottom" is the sill.
- +x runs along the wall (0 … w), +y up (0 … h), +z is the wall normal towards the outside (−t/2 … +t/2 is the wall).

`object.json` for parts: `category: "building/window" | "building/door" | "building/garage-door" | "building/stairs" | "building/railing" | "building/roof-window"`, `mount: "wall"` (stairs: `"floor"`).

Add `"building"` to `cat`/category labels in `furniture.js` and the locale files.

### D.4 Validator (`tools/validate.mjs`)

- Building parts get their own triangle budget: window/door ≤ 3000 triangles, ≤ 8 draw calls after merge, at default params **and** at the maximum params (w = 3, h = 2.6).
- Check the role rules:
  - a `leaf`/`sash` must be a `group`;
  - a `shutter`/`panel` bounding box top must be at y ≈ 0 (±1 mm) in the part's local frame;
  - a door needs exactly one `leaf`;
  - a window needs exactly one `glass`.
- Check that the part fills the opening: bounding box x within [−0.002, w + 0.002] and y within [−0.002, h + 0.002] for three test sizes.

### D.5 Built-in default parts (new library objects)

Create with `npm run new` and fill `recipe.json` by hand. Each needs `preview.webp` (`npm run preview -- <id>`).

1. `generic/building/window/standard`: reproduces today's window exactly (frame 5 cm, mullion above 1.3 m, glass, shutter). Params `w`, `h`, `t`, plus `frameWidth` 0.05, `mullion` "auto" as number threshold 1.3, and `shutter` boolean default true.
2. `generic/building/door/interior`: today's interior door leaf (4 cm, light colour) plus a simple frame (Zarge) and handle.
3. `generic/building/door/exterior`: today's exterior door (dark leaf) plus frame and handle.
4. `generic/building/garage-door/sectional`: today's garage panel. The slat texture comes from the panel (role `panel` gets the existing `garageTex` material, like `glass` gets the glass material).

Then 2–3 additional examples so the community sees variety:

5. `generic/building/window/two-sash`: two sashes with roles `sash`.
6. `generic/building/door/glass-panel`: door with a glass insert.
7. `generic/building/window/floor-to-ceiling`: no sill bar, slim frame (sill 0).

Colours: frame material colour comes from `site.facade.frame` for exterior parts. Use a recipe param `frameColor` (string) with default `#2c3142` and let the panel pass `site.facade.frame`.

### D.6 Panel code (`house.js`)

1. Add `buildPart(opening, kind, dims, site)` in a new file `frontend/src/parts.js`:
   - Pick the recipe: `opening.part` → library entry (`site.library[opening.part]` or bundled `BUNDLED_LIBRARY`), else the default id for the type (`window` → `generic/building/window/standard`, door ext/int, garage).
   - Call `buildRecipe(recipe, { w, h, t, side, frameColor })`.
   - **Cache** built geometry per `(recipe id, rounded w/h/t to mm, frameColor)` and clone meshes (geometry shared, materials shared except glass/shutter/panel which need per-opening instances for animation). Openings of the same size are common (10 identical windows), so this saves memory and build time.
   - Return `{ root, roles: { glass, leaf, sash, shutter, panel } }`.
2. In `buildLevel()`, replace the procedural blocks for door, window and garage with `buildPart`. Position `root` with the existing `at()` / `wallRot` helpers so that its origin sits at the opening's bottom-left on the wall centre line. The wall pieces around the opening (lintel, parapet, plinth, slab band, blockers) stay as they are.
   - Map roles to the existing animation objects so that `Stage.tick()` does not change:
     - `doors[id] = { hinge: roles.leaf, base: wallRot, swing, cur, ext }`
     - `windows[id] = { glassMat: roles.glass.material, shutter: roles.shutter, cur }`
     - `garages[id] = { panel: roles.panel, cur }`
   - Keep `openingHits` (invisible pick boxes) as they are.
3. **Pixel-identical check:** before deleting the old code, render the demo with old and new code from 4 fixed cameras and compare screenshots (allow a small pixel difference, e.g. < 0.5 % pixels with ΔE > 10). Commit the comparison script as `tools/test-parts-visual.mjs` (local only, not CI).
4. The library index already loads remote objects (`loadRemoteLibrary`). Parts placed in a plan are copied to `site.library` like furniture recipes (see `plan.js` `normalize`, `registerLibrary`), so plans work offline.

### D.7 Editor

- Opening inspector (`editor.js`, search for the opening inspector, `s.type === 'opening'`): add a **"Model"** field.
  - It shows a thumbnail grid of library parts for that opening type (filter by category `building/window` for windows, …) and "Standard".
  - Selecting one sets `opening.part`; on the first use, the recipe is copied into `site.library`.
  - Show only parts whose `params` allow the opening size (`min`/`max` of `w`/`h`); others are greyed out with a tooltip.
- In "Insert → Library" (furniture library), building parts are **not** listed (they are not free-standing objects).
- "Apply to all similar windows" button: sets the same `part` on all windows of the same facade side or the same size (two buttons). Users ask for this often.

### D.8 Stairs and railings (second step of D, only if time allows)

- Stairs today are a procedural furniture type `stairs` (`furniture.js` line ~119) with width/depth/height. Make `generic/building/stairs/straight` the reference recipe with params `w`, `d`, `h`, `steps` (default `round(h / 0.18)`), `stringer` boolean, `railing` "none|left|right|both".
- Keep the furniture type `stairs` but let it reference a library part via `item.part` the same way as openings.
- Railings: `generic/building/railing/bars` with param `length`, used for stair voids (today void edges are left open) and balconies (outdoor rooms with `raise`). Add `railing: true|false` per void edge later; not in this plan.

### D.9 Tests for D

- `tools/test-parts.mjs` (Node, CI):
  - Every default part builds at 3 sizes.
  - Roles exist and pivot rules hold (leaf origin at hinge, shutter top at y = 0).
  - `buildLevel` on the demo plan produces the same number of `windows`/`doors`/`garages` entries as before.
  - The cache returns shared geometry for equal sizes.
- `npm run validate -- --strict` passes with the new objects.
- Browser: `test-localization-editor.mjs` still passes. Add `tools/test-parts-browser.mjs`:
  - Pick a window, choose "two-sash", reload, and check it persists.
  - Toggle the window contact in the sim; the sash opens.
  - Screenshots desktop/phone.

---

## Part F: Wall editor

### F.1 Idea

The user selects a wall and sees it straight on, like a canvas. On that canvas they place, move and align wall objects (lamps, picture frames, posters, TVs, thermostats, sockets, shelves and future decorations). This works for the **inside** face of a wall (per room) and the **outside** face (facade: outdoor lights, cameras, house number, mailbox).

The main deliverable is the **capability** (editor mode, placement, snapping). Ship only one or two assets; the community adds more.

### F.2 No new data model needed for placement

Wall objects are already devices or furniture with `pos [x, z]`, `rot` and a height:

- devices: `y` / `elevation`;
- furniture: `elevation` / `lift`;
- library objects with `mount: 'wall'`.

`walls.js` already snaps wall-mounted devices flush to the nearest wall face (`snapToWall`, `isWallMounted`).

The wall editor is a different **view and interaction** on the same data. Conversion between wall-canvas coordinates `(u, v)` and plan coordinates:

```
face = { levelId, a: [x, z], b: [x, z], n: [nx, nz] (unit outward normal of the face, pointing into the room for inside faces), ht (half wall thickness) }
dir = (b − a) / |b − a|
plan pos = a + dir * u + n * (ht + depth/2 of the object if it is furniture; devices snap to ht)
rot = atan2(n.x, n.z) in degrees (same formula as snapToWall)
v = height above the level floor of the object's CENTRE (convert to y / elevation per object type: write one function `wallHeightToItem(item, v)` and its inverse)
```

Write these as pure functions in a new module `frontend/src/wallface.js` and test them.

### F.3 Choosing the wall face

`wallSegments(level)` in `walls.js` gives wall segments with door gaps removed. For the editor, a face must be the **whole wall between two corners**, including openings. Write `wallFaces(level)` in `wallface.js`:

- Use the same segment derivation as `house.js` `wallSegments` (export it from `house.js` as `wallRuns(level)` instead of copying it).
- Merge collinear runs between corners.
- For each run, produce:
  - an **inside face** per adjacent room;
  - an **outside face** for exterior walls.
- Each face lists its openings (for drawing and for collision) as `[{ u0, u1, v0, v1, type }]`.
- Face id (stable for a session, not stored): `${levelId}:${round(a)}:${round(b)}:${side}`.

Ways to open the wall editor:

1. Edit mode, select tool: **double-click / double-tap a wall** in 3D or 2D. The face is the side the camera (3D) or pointer (2D) is on. Use `Stage.pick` and add wall picking: today walls are not pickable. Add invisible thin pick boxes per face, built only in edit mode, like `openingHits`.
2. Context menu (right-click / long-press in edit mode) on a wall: "Design this wall".
3. Room inspector: a list of the room's walls ("North wall 4.2 m", "East wall 3.6 m", using `bearingOfNormal` from plan 1) with a "Design" button each.
4. Selecting a wall-mounted object and pressing "Open wall" in its inspector.

### F.4 The wall view (rendering)

- Use the existing orthographic camera `stage.ortho`. Position it on the face normal at distance 5 m, looking at the face centre, `up = (0, 1, 0)`. Set the frustum to fit `face length × level height` plus 0.3 m margin, keeping aspect ratio. Store and restore the previous camera state (like `enterWalk` / `exitWalk`).
- **Hide what is in front of the wall:**
  - add a clipping plane (`renderer.localClippingEnabled = true`; global `renderer.clippingPlanes = [plane]`) parallel to the face at `n · ht + 0.6 m` (keeps objects up to 60 cm in front of the wall, e.g. shelves and lamps, but cuts away furniture in the room);
  - hide other levels, the roof and outside furniture for inside faces;
  - for outside faces, hide the ground plane's grid only.
- Draw a 2D overlay on a canvas element on top of the WebGL canvas (same pattern as the wizard's `PlanView`):
  - wall outline;
  - openings (hatched; no placement allowed there);
  - grid every 10 cm (major every 50 cm);
  - rulers along the bottom and left edge (cm);
  - floor line and ceiling line;
  - for the selected object: its bounding rectangle, distance lines to neighbours and to the wall ends (cm), and its height of centre above the floor ("145 cm").
- The rendering stays on demand: call `stage.invalidate()` on every change.

### F.5 Interaction

- **Library sidebar** (bottom sheet on phones), filtered to wall objects:
  - devices where `isWallMounted` is true (wall light, frame, TV wall, thermostat, temperature sensor, camera, plug, AC, radiator);
  - library objects with `mount: 'wall'`.
  - Drag onto the wall, or tap to place in the centre.
- **Drag** to move in (u, v). Snap guides (pink lines, 6 px tolerance):
  - **Grid:** 5 cm. Hold Alt (desktop) or use a "snap" toggle to disable.
  - **Centres:** wall centre, centre between two openings, centre above an opening (picture above a door).
  - **Alignment:** top/centre/bottom edges and vertical centre lines of other objects on the same face.
  - **Standard heights**, shown as faint dashed lines with labels:
    - light switch 105 cm;
    - socket 30 cm;
    - picture centre 145–155 cm (`v = 1.5 m` default for frames);
    - wall lamp 180 cm;
    - TV centre at seated eye height 110 cm;
    - thermostat 150 cm.
    Use them as default heights when placing.
- **Resize** frames and posters with corner handles (changes `fw`/`fh`, snaps to `FRAME_SIZES` in `devices.js`).
- **Multi-select** (Shift-click or a rectangle drag on empty space) → align left/centre/right/top/middle/bottom and **distribute evenly** horizontally (gallery wall).
- Keyboard: arrows move 1 cm (Shift: 10 cm), Delete, Ctrl/Cmd+D duplicate, Escape leaves the wall view.
- **Collision:** objects must not overlap openings. Show a red outline and refuse the drop, or snap to the nearest free position.
- **Undo:** one `pushUndo()` per completed drag, like the 3D editor.
- **Phone:** full-screen; one finger drags objects, two fingers pan/zoom the canvas; long-press on an object opens its menu (duplicate, delete, properties).
- Header bar: wall name ("Living room · north wall · 4.20 m"), buttons "Previous wall", "Next wall" (walk around the room, in clockwise order) and "Done".

### F.6 Inside vs outside

- Outside faces use the level of the wall. Exterior objects (outdoor wall light style `outdoorWall`, camera) are listed first.
- The face normal decides the side: `snapToWall` today chooses the side from the pointer position. In the wall editor, pass the face normal explicitly (extend `snapToWall` with an optional `side` argument) so objects never flip to the other side of the wall.

### F.7 Assets to ship (1–2, the rest is community)

1. **`generic/decor/poster-hometwin`**: a framed poster of the HomeTwin logo (isometric cube house from `docs/assets/logo.svg`).
   - Built with recipe shapes only (no image textures, see library rules): a thin `box` frame plus three `extrude` faces of the cube house in the logo colours, on a light background `box`.
   - Params `w` (0.5) and `h` (0.7).
   - `mount: 'wall'`, category `decor/poster`. Under 1500 triangles.
2. **`generic/decor/wall-shelf`**: a simple floating shelf (params `w` 0.8, `d` 0.22), `mount: 'wall'`, category `decor/shelf`. It shows that furniture-like wall objects work and gives other objects something to stand on (automatic placement on surfaces exists since 0.6.0).

If time allows, add a `generic/lighting/wall/sconce` wall lamp recipe bound to a `light` entity (look at how lights are bound for library objects first; if library lights cannot emit light yet, skip it and note it).

### F.8 Later (do not build now; write it into ROADMAP.md)

- Decoration per wall face: paint colour, wallpaper pattern, tiles (bathroom), wood panelling. This needs a stored face model, e.g. `level.faces[faceKey] = { finish, color }`, where the face key is derived from room id and edge index so it survives small edits.
- Wall-mounted shelves with items on them; gallery wall templates; skirting boards.

### F.9 Tests for F

- `tools/test-wallface.mjs` (Node, CI):
  - `wallFaces` on the demo plan: number of faces, openings per face, inside/outside.
  - `(u, v)` ↔ `pos/rot/y` round trip for a frame, a wall light and a library wall object.
  - Snapping function (pure): grid, centre, alignment, standard heights, opening collision.
- `tools/test-wall-editor-browser.mjs` (Playwright, desktop and phone, en/de):
  - Open the editor on the living-room north wall via the room inspector.
  - Drag the HomeTwin poster onto the wall and check that it snaps to 150 cm centre.
  - Place three frames, select them, distribute evenly and check equal gaps (±1 cm).
  - Try to drop onto a window and check that it is refused.
  - Leave the editor and check that the 3D view shows the objects flush on the wall (screenshot) and the camera is restored.
  - Do the same on an outside face with an outdoor light.
  - Undo, then redo.

### F.10 Pitfalls

- `renderer.clippingPlanes` affects shadow rendering and the composer. Clear it when leaving the wall view, and mark the shadow map dirty.
- The existing cutaway logic (`full`/`curb` wall groups in `Stage.tick()`) hides exterior walls facing the camera. In the wall view, force the selected face's wall to `full` and walls in front to hidden.
- Long walls (12 m) on phones: start zoomed so that height fits, and let the user pan.
- Keep `editor.js` from growing further: put the wall editor into `frontend/src/walleditor.js` with a small API (`open(face)`, `close()`), and only wire it from `editor.js`.

# Modelling guide

Goal: an object that is **dimensionally exact** and **recognisable at thumbnail size**, built from as few primitives as needed. Think "good architectural visualisation", not CAD.

## Method

1. **Outer box first.** Start with one box of the real W × H × D. Validate. Now the size is right and stays right.
2. **Split into main components.** Replace the box by the 3–8 parts that define the silhouette (frame, legs, seat, back, doors, shade, base).
3. **Add characteristic details.** Only what you would notice from 2 m away: handles, gaps between doors, piping on cushions, a display, ribs on a radiator, a cable for a pendant.
4. **Look at the sheet** after every step. Compare front/side/top with the reference images.

Write a parts table before writing JSON:

| part | shape | size (w × h × d) | position | material |
|---|---|---|---|---|
| side panel ×2 | box | 0.035 × 1.40 × 0.39 | x = ±0.71, y = 0.035 | board |

## Choosing shapes

| real thing | shape |
|---|---|
| panels, boards, cushions, appliances, screens | `box` with `round` (cushions 0.04–0.07, furniture 0.002–0.01, appliances 0.01–0.03) |
| legs, poles, knobs, pots, cans | `cylinder` (tapered with `rTop`/`rBottom`) |
| lamp shades, vases, bowls, bottles, pots with a curved outline | `lathe` with a profile from bottom to top |
| L/U profiles, armrests with a curved outline, brackets, chair backs | `extrude` |
| bent tubes, cables, arc lamps, towel rails | `tube` |
| rings, handles, round mirrors' frames | `torus` |
| globes, bulbs | `sphere`; half spheres `dome` |
| repeated elements (slats, ribs, shelves, drawers) | `repeat` with the index in expressions |
| symmetric pairs/quads (legs, sides, armrests) | `mirror` |

## Typical structure per category

- **Seating:** legs, base/frame, seat cushions (repeat), back cushions (repeat, tilted 8–12°), armrests (mirror, `when`).
- **Tables:** top, legs or frame/skirt, optional shelf.
- **Storage:** carcass (bottom, top, sides via mirror), dividers/shelves (repeat), doors/drawers with 3 mm gaps, handles, plinth or legs.
- **Beds:** frame, headboard, mattress (rounded box), pillows, duvet (slightly rounded box).
- **Lamps:** base, stem/arm (`tube`), shade (`lathe`, `double: true`), bulb (`led` material, `glow`). Every lamp needs a `glow` surface.
- **Appliances & media:** body box with rounding, front panel/door, display (`screen`), feet, logos never.
- **Radiators:** panels, ribs (repeat), top grille, side covers, brackets at the back; `mount: wall`.
- **Sensors, switches, thermostats:** small rounded box, front details 1–2 mm proud, `mount: wall` or `ceiling`.
- **Plants:** pot (`lathe`), soil, foliage from a few spheres/cones in `plant` material.
- **Outdoor:** use weather-plausible materials (steel, concrete, wood_walnut, rubber).

## Materials

- Pick the closest preset and set the real colour via a `color` param, so users can change it.
- Wood → `wood_*`, painted/laminated furniture → `laminate_*`, powder-coated metal → `metal_black/metal_white`, brushed → `steel`, polished → `chrome/brass`.
- Glass → `glass`; glow surfaces → `led` (or own material with `glow: true` and `emissive`).
- Darker variants of the same colour with `shade` (−0.05 … −0.2) separate parts visually.

## Pitfalls

- **Origin:** box/cylinder origin is the bottom centre. A shelf at height y means `pos: [0, y, 0]`, not y − h/2.
- **Rotation order** is Y, X, Z. Tilt a back cushion with `[-10, 0, 0]`.
- **Lathe profile** is `[radius, y]`; radius first. A closed shape needs radius 0 at the ends or `double: true`.
- **Extrude** is in the x/y plane and extruded along z; rotate `[0, 90, 0]` to extrude along x.
- **Overlaps are fine**, gaps are not: let parts overlap by a few millimetres so nothing floats.
- **Mirror** copies the part including its rotation; set `pos` for the +x/+z instance.
- **Centring:** if the validator reports an off-centre object (e.g. arc lamp), shift all parts; do not change dimensions.
- **Dimensions:** the validator compares the model's bounding box with `object.json`. Small proud details (knobs, feet) count; real datasheets usually include them.

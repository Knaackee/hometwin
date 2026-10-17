# Recipe format (`recipe.json`, schema 1)

A recipe is data, not code. The HomeTwin panel, the preview renderer and the validator all build it with the same engine (`engine/recipe.js`).

## Conventions

- Units: metres and degrees.
- Axes: x = width (right), y = height (up), z = depth (front = +z).
- The finished object stands on y = 0 and is centred on x and z.
- Wall-mounted objects: the back face lies at z = −d/2.
- Ceiling objects: also modelled standing on y = 0; the panel hangs them so the top touches the ceiling.

## Top level

```json
{
  "schema": 1,
  "params":    { "w": { "default": 2.2, "min": 1.4, "max": 3.2, "label": { "en": "Width", "de": "Breite" } } },
  "derived":   { "inner": "w - 0.36" },
  "materials": { "fabric": { "base": "fabric", "color": "$color" } },
  "parts":     [ { "shape": "box", "size": ["w", 0.2, "d"], "mat": "fabric" } ]
}
```

### params

User-adjustable values. Either a plain number or an object:

| key | meaning |
|---|---|
| `default` | value used for the library object (must equal the real product) |
| `type` | `number` (default), `int`, `color` (`#rrggbb`), `bool` |
| `min`, `max`, `step` | range for the editor; the validator also builds at min and max |
| `label` | `{ "en": …, "de": … }` |

### derived

Named helper values computed in order from params and earlier derived values: `"cw": "inner / seats"`.

### Expressions

Any number in a part may be a string expression:
- operators `+ - * / %`, parentheses, comparisons `< > <= >= == !=`, `&& || !`, ternary `a ? b : c`
- functions `min max abs sqrt pow exp log round floor ceil clamp(v,a,b)`, `sin cos tan` (degrees), constant `pi`
- names: params, derived values, repeat variables

### materials

Recipe-local materials. Each may start from a preset (`base`) and override:
`color` (`#rrggbb` or `$param`), `shade` (−1…1, darker/lighter), `rough`, `metal`, `opacity`, `emissive`, `emissiveIntensity`, `glow` (light-emitting surface, switched by the entity state in the panel), `double` (render both sides, for thin shells like lamp shades).

A part may also use a preset name directly as `mat`.

Presets: `wood_oak wood_light wood_walnut wood_white laminate_white laminate_black metal_black metal_white steel chrome brass copper plastic_white plastic_grey plastic_black rubber fabric leather glass glass_frosted ceramic marble concrete stone paper screen led plant soil`.

## Parts

Common keys for every part:

| key | meaning |
|---|---|
| `shape` | see below |
| `name` | free label, helps reviews |
| `mat` | material name |
| `pos` | `[x, y, z]` placement of the shape's origin |
| `rot` | `[x, y, z]` degrees, applied in the order Y, X, Z around the origin |
| `mirror` | `"x"`, `"z"` or `"xz"`: adds mirrored copies (2 or 4 legs from one part) |
| `repeat` | `{ "n": "seats", "var": "i" }`: n copies, `i` = 0 … n−1 usable in expressions |
| `let` | helper values computed per copy, e.g. `{ "fy": "nut - scale*(1 - pow(2, -(k+1)/12))" }`; usable in this part |
| `when` | expression; the part is skipped when it is 0 (e.g. `"arms"`) |

### Shapes and their origin

| shape | keys | origin |
|---|---|---|
| `box` | `size: [w, h, d]`, `round` (edge radius) | centre of the bottom face |
| `cylinder` | `r` or `rTop`/`rBottom`, `h`, `seg`, `open` | centre of the bottom face, axis = y |
| `cone` | `r`, `h`, `seg` | centre of the bottom face |
| `sphere` | `r`, `seg` | centre |
| `dome` | `r` | centre of the flat face (half sphere upwards) |
| `torus` | `r`, `tube`, `arc` (deg) | centre, ring lies in the x/y plane (rotate `[90,0,0]` to lay it flat) |
| `lathe` | `profile: [[radius, y], …]`, `seg` | revolved around the y axis; profile y is relative to `pos` |
| `extrude` | `profile: [[x, y], …]`, `depth`, `bevel` | profile in the x/y plane, extruded along z, centred on z |
| `tube` | `path: [[x, y, z], …]`, `r`, `smooth` (default true) | path points are relative to `pos` |
| `group` | `parts: […]` | children inherit the group's `pos`/`rot`/`mirror`/`repeat` |

Cylinders lying down: `"rot": [0, 0, 90]` (axis along x) or `"rot": [90, 0, 0]` (axis along z); remember the origin is the bottom face centre, so the cylinder then extends from `pos` in −x or +z.


Display surfaces use `"shape": "screen"` with `w`, `h` and optional `radius` (metres, 0 = flat). The bottom centre is the origin; the front faces +z. The engine assigns `role: "screen"` automatically. A custom display mesh may also use `"role": "screen"`. Display parts stay separate when static geometry is merged so the editor can bind the object to a media-player, camera or image entity. Use a dark material; never embed third-party artwork in recipes.

The engine merges static meshes per material and reduces tessellation for tiny parts. Keep interactive or display parts separate using their role. Validate the resulting object, not an estimated primitive count.
## Example: 4-leg table

```json
{
  "schema": 1,
  "params": {
    "w": { "default": 1.6, "min": 0.8, "max": 2.4, "label": { "en": "Length", "de": "Länge" } },
    "d": { "default": 0.9, "min": 0.6, "max": 1.1, "label": { "en": "Depth", "de": "Tiefe" } },
    "h": { "default": 0.75, "label": { "en": "Height", "de": "Höhe" } },
    "color": { "default": "#b48d63", "type": "color", "label": { "en": "Wood", "de": "Holz" } }
  },
  "derived": { "top": 0.03 },
  "materials": { "wood": { "base": "wood_oak", "color": "$color" } },
  "parts": [
    { "name": "top", "shape": "box", "size": ["w", "top", "d"], "pos": [0, "h - top", 0], "round": 0.004, "mat": "wood" },
    { "name": "leg", "shape": "box", "size": [0.06, "h - top", 0.06], "pos": ["w/2 - 0.08", 0, "d/2 - 0.08"], "mirror": "xz", "mat": "wood" }
  ]
}
```

## Limits
400 parts in the file, 2000 built parts after repeat/mirror, 64 KB per recipe. Strict triangle budgets by largest dimension: under 0.3 m: 4,000; under 1 m: 8,000; otherwise 15,000 (absolute limit 20,000). At most 12 draw calls after merging static parts by material. Display surfaces remain separate.

# Floor material presets

Floor materials are declarative, procedural presets stored as individual JSON files under `surfaces/`. They are bundled into HomeTwin and arrive with an integration update. The remote community object-library feed does not discover or update them.

## Contract

Each file contains exactly these fields:

| Field | Requirement |
|---|---|
| `id` | Stable identifier matching the file name: start with a lowercase letter, then use letters, numbers, `_` or `-`; maximum 64 characters. |
| `name` | Object with complete `en` and `de` display names; each trimmed name must contain 1–120 characters. |
| `pattern` | One of `planks`, `tiles` or `noise`. |
| `color` | Primary colour as a six-digit CSS hex value such as `#b98b5f`. |
| `secondaryColor` | Secondary colour as a six-digit CSS hex value. It provides procedural variation or joints; it is not a texture URL. |
| `width` | Pattern element width in metres, from `0.02` through `10`. |
| `length` | Pattern element length in metres, from `0.02` through `10`. |
| `roughness` | Number from `0` through `1`. |
| `license` | `CC0-1.0` or `CC-BY-4.0`. |
| `author` | Trimmed contributor name or GitHub handle, 1–120 characters. |

Unknown fields are rejected. Colours use the exact `#rrggbb` form. Dimensions and roughness must be finite numbers.

Example:

```json
{
  "id": "oak-natural-planks",
  "name": { "en": "Natural oak planks", "de": "Eiche natur, Dielen" },
  "pattern": "planks",
  "color": "#b98b5f",
  "secondaryColor": "#8f6744",
  "width": 0.18,
  "length": 1.8,
  "roughness": 0.72,
  "license": "CC0-1.0",
  "author": "github-handle"
}
```

Use measured product dimensions when the preset represents a specific material. For a generic preset, choose plausible dimensions and say in the pull request that they are design defaults. Keep colours descriptive rather than copying a protected texture, photograph or manufacturer artwork.

## Add and verify a preset

1. Check `surfaces/` for the same material or a confusingly similar name. Reuse a suitable preset instead of adding a duplicate.
2. Add `surfaces/<id>.json` with the exact contract above. Keep both English and German names complete.
3. Run `node tools/build-surfaces.mjs`, then `node tools/build-surfaces.mjs --check` and `node tools/test-surfaces.mjs`. Fix schema, identifier, colour, range and duplicate failures before visual review. The build discovers every flat `surfaces/*.json` file and writes the offline static import list in `frontend/src/surfaces.gen.js`; do not edit that generated file.
4. Build the panel and demo using the repository instructions. The shared contract lives in `engine/surface.js`, and the frontend catalogue and renderer live in `frontend/src/surfaces.js`.
5. In the demo, choose the new material for a room and inspect the actual rendered floor at room scale and close range. Check pattern direction, repetition, joint or variation colour, element width and length, lighting response and roughness.
6. Repeat the selection and inspector check with the HomeTwin UI set to English and German. Capture review images of the rendered room in both languages; swatches alone are insufficient.
7. Change `color`, rotation, `width` and `length` through the surface controls. Save and reload, then confirm the room keeps the selected values. Rotation is finite and normalized to `[0, 360)`; overridden dimensions retain the `0.02`–`10` metre bounds. Unknown override fields are rejected.
8. Use **Reset adjustments** and confirm the selected snapshot defaults return. Open a legacy plan, confirm its existing surface does not change before selection, choose a preset, then use **Use original surface** and confirm the legacy appearance returns.
9. After selection, confirm the room stores a `surfaceSpec` snapshot and only the user's overrides in `surfaceOptions` (`color`, `rotation`, `width`, `length`).

The snapshot makes an existing plan stable when bundled preset defaults change later. Do not add migration code that assigns a new preset to legacy rooms, and do not rewrite saved snapshots during catalogue load.

## Pull request evidence

Include the preset id, English and German names, pattern and dimensions, licence and author, the `tools/test-surfaces.mjs` result, and the English/German demo images showing the actual rendered floor. State that the material is procedural and bundled with the integration.

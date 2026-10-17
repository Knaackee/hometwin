# Roadmap

Detailed implementation plans are in [docs/plans/](docs/plans/README.md).

## Done

- **0.6.0 (unreleased):** gap-free storeys, plinth only on the terrain, clean wall ends, storey heights in the floor-plan assistant (from the plan, or defaults flagged for review).

## Next

0. **Hotfix: empty view after the browser was in the background** ([plan](docs/plans/00-hotfix-blank-view.md))
1. **Building envelope** ([plan](docs/plans/01-building-envelope.md))
   - Roofs as a list of equal parts. "+ Roof" over selected rooms or a drawn rectangle, corner/edge/rotate handles for every roof, PV and roof windows on any roof. The assistant proposes one roof per building part.
   - "Exterior & materials": upload photos and elevation drawings. The AI suggests the side (N/E/S/W) and reads facade, plinth, window frame and roof colours/materials. From drawings it also reads heights and pitch. The user confirms each suggestion.
2. **Building parts and wall editor** ([plan](docs/plans/02-building-parts-and-wall-editor.md))
   - Windows, doors and garage doors as parametric library parts with a role contract, so the community can contribute models. Then stairs and railings.
   - Wall editor: pick a wall face (inside or outside), arrange lamps, posters, frames and other wall objects on a flat canvas with snapping and alignment. Ships with a HomeTwin logo poster and a wall shelf.
3. **Walkthrough and view recovery** ([plan](docs/plans/03-walkthrough-and-view-recovery.md))
   - Fix: the view can end up black and unrecoverable (phone and browser). Handle WebGL context loss, sanitise the camera, add an error boundary, a "Reset view" action and diagnostics.
   - Twin-stick touch controls, gamepad support, wall collision, "Use" to operate devices while walking.

## Later

- Wall finishes per face: paint, wallpaper, tiles, panelling (data model in plan 2, F.8).
- Railings on stair voids and balconies.
- Terrain height setting (`site.terrain`) in the editor, for raised ground floors with a terrace on the same storey.
- Refactor `editor.js` and `wizard.js` into smaller modules.

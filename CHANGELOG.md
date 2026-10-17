# Changelog

## Unreleased

- Storeys join cleanly: the plinth is only built on the storey standing on the terrain, interior walls end inside the exterior wall instead of poking through the facade, and plinth corners close flush.
- Raised ground floors stand on the terrain: the plinth reaches down to the ground. The plinth height is adjustable (House → Facade).
- Floor-plan assistant: new storeys are stacked without gaps. Room height and slab thickness come from the plan when stated, otherwise from defaults that are marked for review and can be corrected before applying. Basements keep the floor level of the storey above.
- Floor-plan recognition: failed recognitions now show their error instead of an empty result. Answers wrapped in prose or code fences, points as objects, decimal commas, normalised coordinates and nested answers are read correctly (e.g. Claude models). "Copy model answer" helps to report problems. The image sent to the model is at most 1568 px, the size Claude reads without resampling.
- Recognition reads the slab thickness when the plan dimensions it and treats storey levels as relative to ±0.00.

## 0.6.0b1 (2026-10-17)

- Default to English with complete German support, local welcome-language flags and independent Home Assistant UI-language options.
- Document native-speaker review requirements for AI-assisted translation contributions.
- Link media screens to Home Assistant entities and fix screen selection and long-press controls.
- Confine media effects to room boundaries and make demo solar output follow the displayed sun.
- Split independently placeable accessories from furniture while migrating saved arrangements.
- Automatically place movable objects on supporting surfaces or the floor, with persistent manual height overrides and an on/off switch.
- Keep selection boxes aligned with moved objects and improve slab, terrain and shadow geometry.

## 0.5.1 (2026-10-16)

- Include the Xbox Wireless Controller in the generated offline catalogue, website gallery and editor.
- Fix Home Assistant translation validation and provide local HomeTwin brand assets.
- Publish four-view object review sheets and fail CI when expected preview artifacts are missing.
- Refresh the library index during panel builds and check all generated panel files in CI.


## 0.5.0 (beta): first public release as HomeTwin (2026-10-16)

- 🏷️ **New name:** Raumwerk is now **HomeTwin** (`hometwin`). Plan, floor-plan images and AI settings of an existing Raumwerk installation are taken over automatically on first start.
- 💾 **Backup:** export and import the complete configuration as one JSON file. It holds the plan, floor-plan images and view settings; AI keys are not included.
- 🚶 **Walkthrough:** first-person view at your body height.
  - Desktop: WASD/arrow keys, drag to look.
  - Touch: joystick and swipe.
  - Switch storeys, jump to rooms, operate devices.
  - In edit mode, move objects.
- 🧩 **Object library in the panel:**
  - Recipes from `library/` are bundled under *Insert → Library*.
  - Newly merged objects load live from GitHub Pages.
  - Placed objects are stored with the plan, so they work offline.
- 🎨 **Logo** (isometric cube house), product website with live gallery and demo.
- 📱 Phones: the whole house now fits on screen above the bottom sheet.

## Preview versions (as Raumwerk)

- **0.4.1**: walls rise on every open; room picker shows only the room's storey and frames the room.
- **0.4.0**:
  - walls-rise effect after the floor-plan assistant
  - room picker in the top bar
  - long-press / right-click opens Home Assistant's detail dialog
  - bottom sheet on phones
  - performance mode
- **0.3.9**:
  - several roofs (garage, carport, garden house)
  - doors and windows editable in the review step
  - stair helper (straight, L, U)
- **0.3.7–0.3.8**:
  - house assistant (storeys, stairs, roof step)
  - self-check pass of the AI
  - floor plan only in 2D
- **0.3.0–0.3.6**:
  - floor-plan assistant with PDF, scale from dimension chains, background jobs with live progress
  - dimension fitting
  - context menu, onboarding, blinds with invert/tilt
- **0.1–0.2**: 3D panel, editor, roofs and styles, PV, devices, AI agent.

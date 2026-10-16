# Changelog

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

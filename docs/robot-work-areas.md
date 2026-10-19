# Robots & work areas (local test)



Open **Edit → Robots → Configure work areas**. At least one floor with a room is required. This section uses the existing house; no floor-plan image upload is needed.



- Rooms are named and selectable by click, keyboard or the room list. Walls, door swings, open passages and windows reuse the 3D house geometry; door symbols do not indicate live open/closed state.

- Click a room to replace the selection. Shift/Ctrl/Meta-click toggles rooms; Multiple selection provides the same behavior on touch screens. Draw rectangles or polygons to add space, including space outside rooms. Draw exclusion subtracts from the selection. Name it and choose Add as one area, then Save areas & assignments.

- Reopen an area with Edit area outline to add shapes or exclusions. Saved composite areas move as a whole, including their holes; legacy polygon vertices remain draggable. Arrow keys move by 5 cm, Shift by 50 cm and Ctrl by 1 cm. Lines remain separate boundary markings.

- Save work areas, exclusions and device/map assignments per floor. Outdoor/property drawings have a separate scope.

- Each device/floor assignment keeps its own map reference and calibration. HomeTwin does not switch the device's active map or move a robot between floors.

- Existing rooms, furniture and entities remain unchanged. These settings live in `site.robotAreas`; older plans need no migration. Saving participates in the editor's undo history.



## Guided setup

Start with **New → New work area**. Select rooms and edit surfaces. Choose **Continue**, name the work area, select its device and **Save work area**. The list then shows each saved area with Edit, Clean and More → Delete. Each area retains its own device/profile reference. Existing unassigned areas keep their data; a single legacy floor profile is reused, while ambiguous assignments require selecting the intended device.

Map alignment is only requested when opening Clean for an area that needs it. Existing profiles and manual coordinates remain under Advanced map settings in that cleaning screen. Saving an area never starts the robot. Cancel discards the current draft without altering stored geometry.

For visual alignment, load a robot map with calibration_points metadata, select three matching non-collinear corners in both views, and check the overlaid floor outline. Confirm the robot and floor before applying. Image pixels are converted using source metadata, never treated as robot coordinates. Failed loads and cancelled alignment retain the previous calibration. If metadata is absent, enable it in the map integration or use manual coordinates under Advanced map settings.

Repeat alignment after remapping. No live cleaning run has yet been confirmed for our Wall-E (rockrobo.vacuum.v1).

## First supported action: Xiaomi zone cleaning



An enabled `xiaomi_miio` vacuum with the `vacuum_clean_zone` service can receive up to five calibrated rectangular work zones representing one composite work area. Enter three non-collinear matching points from HomeTwin (metres) and the robot map (millimetres, not camera pixels). The transform allows rotation/reflection and checks scale consistency. Recalibrate after a device remap or a changed floor coordinate system.



Save, preview the exact coordinates, check the robot's actual floor and active map, then explicitly start. Merely saving, selecting or previewing never sends a command. Preview refuses nonrectangular shapes, rectangles not aligned with the robot map axes, overlapping exclusions/lines and coordinates outside the conservative 0–51200 mm range. It does not substitute a larger bounding rectangle. Check the preview against the robot map before starting.



The backend rechecks administrator access, device platform, availability, service and coordinate types before calling Home Assistant. A service acknowledgement is not proof of completed cleaning; a failed acknowledgement is not automatically retried.



## Deliberate limits



This is not a navigation-map upload or replacement. Drawn holes are omitted from the requested cleaning zones. Separate exclusion areas and boundary lines block overlapping commands. Neither is a device-enforced no-go zone: a robot may still cross omitted space on its way to a cleaning zone. Navigation and obstacle avoidance remain the robot’s responsibility. Outdoor polygons, property boundaries, mower assignments and lines are local planning data. They do not alter physical mower boundaries. Mopping modes, map switching, Roborock segment commands and vendor work-area transfer require separate capability-specific support.



References: [Xiaomi Miio](https://www.home-assistant.io/integrations/xiaomi_miio/), [Roborock](https://www.home-assistant.io/integrations/roborock/), [Husqvarna Automower](https://www.home-assistant.io/integrations/husqvarna_automower/).



Verification: `node tools/test-robot-geometry.mjs`, `node tools/test-robot-composite.mjs`, `python tools/test-robot-control.py`, `node tools/test-robot-areas.mjs`, `node tools/test-robot-floor-view.mjs` (demo on port 4185), and `npm run test:i18n`. Browser tests mock device commands; no robot is moved by the tests.


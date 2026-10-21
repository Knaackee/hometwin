# Release notes

`frontend/src/releases.json` is the source for the in-panel English and German
release notes. Keep the newest published version first and match its version to
both `custom_components/hometwin/const.py` and `manifest.json`.

Validate the data and version alignment:

```bash
node tools/releases.mjs --check
node tools/test-release-notes.mjs
```

Generate the matching English section when preparing `CHANGELOG.md`:

```bash
node tools/releases.mjs --changelog
# or: node tools/releases.mjs --changelog 0.6.0
```

Update the release data before copying the generated section so the panel and
changelog use the same user-facing changes. German text still requires the
native-speaker review described in `CONTRIBUTING.md`.

The panel creates the dialog with `createReleaseNotes(shadowRoot, options)`.
Call `maybeShow({ enabled })` only after onboarding has finished and pass
`enabled: false` for the demo. Use `open(button)` from the permanent View-menu
entry so focus returns to that button. `onOpen` should clear active walkthrough
keys and joystick input before the modal opens.

# Contributing to HomeTwin 🧩

Thanks for helping! There are three easy ways to contribute.

## 1. Add objects to the library (no 3D skills needed)

The library grows with the things in your home. The fastest way is your coding agent.

1. **Look around your home** and compare with the [gallery](https://knaackee.github.io/hometwin/#library). What's missing? Your sofa, lamp, fridge, radiator, wallbox, guitar…
2. Fork and clone the repo, then run `npm install && npx playwright install chromium`.
3. Give your agent (Claude, Codex or any agent that supports skills) the skill **[`skills/add-object/SKILL.md`](skills/add-object/SKILL.md)**, plus product names or photos. Example prompt:
   > Use the HomeTwin add-object skill. Add these objects from my living room: (photo 1), (photo 2), "IKEA KALLAX 2×4 white".
4. The agent identifies each product, researches the dimensions, models it, renders a preview and asks you to confirm. Then it opens **one pull request** for all of them.

**Please bundle several objects per pull request** (3–10, ideally one room or one category). That makes reviewing and merging much faster.

**Specific or generic?** If the exact product can't be identified (there are hundreds of grey sofas), the skill uses a generic object with your measurements instead of guessing a product.

**Rules in short:**
- Dimensions come from sources or your own measurement.
- Only **links** to product pages and images, never the images themselves.
- No logos or textures.
- Licence CC0-1.0 (default) or CC-BY-4.0.
- At most 15 000 triangles per object.

You can also work by hand:

```bash
npm run new -- generic/furniture/tables/dining-table --name "Dining table" --author <you>
npm run preview -- generic/furniture/tables/dining-table
npm run validate -- generic/furniture/tables/dining-table --strict
```

The format is described in [`skills/add-object/references/recipe-format.md`](skills/add-object/references/recipe-format.md).

## 2. Report bugs and ideas

Use the [issue templates](https://github.com/knaackee/hometwin/issues/new/choose). For bugs, include:
- the HomeTwin version,
- your Home Assistant version,
- browser or device,
- steps to reproduce.

If possible, also add a backup file (*Edit → House → Backup*) and remove anything private first.

## 3. Code and translations
Code contributions follow [AGENTS.md](AGENTS.md). English is the default UI language and German is supported.

### Translation contributions

Translations may be drafted with AI, but a native speaker of the target language must manually review every translated string and check it in the running application before merge. Do not submit bulk unreviewed machine translations or claim native review on someone else's behalf.

- Frontend strings: `frontend/src/locales/<area>.<language>.json`; English files define the semantic keys. Keep all areas complete, preserve placeholders and never translate user-authored room/device names or entity IDs.
- Integration strings: `custom_components/hometwin/translations/<language>.json`; runtime backend text: `custom_components/hometwin/locales/<language>.json`. Follow each existing file's format.
- New languages also require explicit registration in the frontend language list and Home Assistant options, a repository-owned flag asset, and validation updates. Ask maintainers to coordinate this; adding JSON alone does not enable a language.
- Run `npm run test:i18n`, `python tools/test-language-options.py` and `npm run build`. Check welcome, editor, device controls, wizard and integration options, including mobile layouts.
- In the PR, state the target language, native reviewer, manual review status, tested screens and any AI tool/model used. Missing native review means the translation stays a draft and is not enabled for users.

Agents must preserve these review gates and report missing human review honestly. English and German remain the supported languages until another complete, reviewed translation is accepted.
## Code of conduct

Be kind and constructive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

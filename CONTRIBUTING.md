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

Read **[AGENTS.md](AGENTS.md)** first (architecture, build, tests). Then:
- Keep pull requests focused.
- Test in the demo, desktop and mobile.
- Describe what you checked.

Translations will be welcome as soon as the i18n groundwork lands. Watch the roadmap.

## Code of conduct

Be kind and constructive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

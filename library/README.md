# HomeTwin object library

Every folder with an `object.json` is one object: `object.json` (metadata), `recipe.json` (model from primitives) and `preview.webp` (rendered).

- `generic/<category>/<slug>` – generic objects without a brand
- `manufacturers/<maker>/<category>/<slug>` – real products
- `schema/` – JSON schemas, `index.json` – catalogue built by `npm run index`

Add objects with the agent skill in `skills/add-object/` or by hand:

```bash
npm install && npx playwright install chromium
npm run new -- generic/furniture/tables/dining-table --author <you>
npm run preview -- generic/furniture/tables/dining-table
npm run validate -- generic/furniture/tables/dining-table --strict
```
Format: `skills/add-object/references/recipe-format.md`. Licence of contributed objects: CC0-1.0 or CC-BY-4.0.

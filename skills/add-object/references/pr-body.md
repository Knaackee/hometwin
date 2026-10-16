## Library: <n> new objects (<topic, e.g. living room>)

Repeat the block below for every object.

---

### <Manufacturer Model (Variant)>

**Folder:** `library/<id>`
**Category:** `<category>` · **Mount:** `<floor|wall|ceiling|…>` · **HA domains:** `<light, climate …>`

### Dimensions

| | real (source) | model |
|---|---|---|
| width | 0.000 m | 0.000 m |
| depth | 0.000 m | 0.000 m |
| height | 0.000 m | 0.000 m |

### Parameters
- `<param>`: default …, range … – what it changes

### Sources
- <product page / datasheet URL>
- <reference image URL> – used for <proportions / colours / details>

Estimated values: <none | list>

### Preview

![Object preview](https://raw.githubusercontent.com/<owner>/<repo>/<full-commit-sha>/library/<id>/preview.webp)
![Four-view review sheet](https://raw.githubusercontent.com/<owner>/<repo>/<full-commit-sha>/library/<id>/review.png)

### Checklist
- [ ] `npm run validate -- <id> --strict` passes
- [ ] preview.webp and review.png rendered, inspected and embedded above; both image links verified
- [ ] Generated index, gallery, demo and panel are current
- [ ] All required PR checks completed successfully (record failures explicitly)
- [ ] Dimensions from the sources above (or measured by me)
- [ ] No photos, textures or logos committed
- [ ] Licence: CC0-1.0 / CC-BY-4.0

Created with the `hometwin-add-object` skill.

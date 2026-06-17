---
type: recipe
name: bread
output: bread
output_count: 1
inputs:
  - { item: flour, count: 1 }
  - { item: salt, count: 1 }
  - { item: water, count: 1 }
  - { item: bowl, count: 1 }
  - { item: bakeware, count: 1 }
station: bakeware
confirmed: true
---

# Bread

Modded two-stage baking pipeline. Bread is **not** made from wheat — wheat goes to plant balls / the hopper instead.

## Pipeline (two stages)

**Stage 1 — dough:** flour + salt + water + bowl → dough
**Stage 2 — bread:** dough + bakeware → bread

Driven by `runBake('dough' | 'bread' | 'both')`. Inputs are pulled from chest slots:

| Item | Chest slot |
|---|---|
| bread | 24 |
| dough | 25 |
| water | 16 |
| salt | 7 |
| flour | 26 |
| bowl | 17 |
| bakeware | 8 |
| iron | 18 |

## Notes
- Wheat is never an input to bread — it feeds plant balls / the hopper.
- `runBake('both')` runs Stage 1 then Stage 2 end to end.

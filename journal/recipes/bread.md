---
type: recipe
name: bread
output: bread
output_count: 1
inputs:
  - { item: wheat, count: 3 }
station: crafting_table
confirmed: true
---

# Bread

Vanilla 1.12.2 recipe. The first food we learned to make ourselves.

## Pattern (3×3 crafting grid)

```
[ ] [ ] [ ]
[W] [W] [W]
[ ] [ ] [ ]
```

Three [[../items/wheat]] in any single horizontal row → 1 [[../items/bread]].

## Station
- [[../places/house-crafting-table]] at (-270, 65, 569)

## Source of wheat
- [[../places/wheat-field]] → [[../procedures/right-click-harvest]] → [[../chests/house-kitchen-chest]] (deposit) → withdraw 3 → craft

## Notes
- The crafting table is a vanilla block; no mod-specific quirks observed yet.
- Bot can craft via mineflayer's `craft` API (not yet exposed in `bot-ctl` — see [[../observations/_log]]).

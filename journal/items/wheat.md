---
type: item
name: wheat
source: wheat_field
crop_block: wheat
seed_drop: wheat_seeds
confirmed: true
---

# Wheat

Harvested from the [[../places/wheat-field]]. Each broken wheat block drops:
- 1 wheat
- 0–3 [[wheat-seeds]]

## Lifecycle
1. Crop block exists at y=64 above farmland at y=63.
2. `activate_block` (right-click) harvests and replants in one action.
3. Drops usually go straight to inventory; stragglers collected during the post-harvest sweep of the harvested half.

## Storage
- Deposit in [[../chests/house-kitchen-chest]].

## Used in
- [[../recipes/bread]]

## Related
- [[wheat-seeds]]
- [[../procedures/right-click-harvest]]

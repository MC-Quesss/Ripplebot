---
type: place
name: house_center
coords: [-268, 65, 572]
role: orientation_block
confirmed: true
---

# house_center

Inside [[orientation-blocks|orientation block]]. The canonical pad inside [[house]], required before facing west to exit. Pathfinder typically lands at (-267.3, 65, 572.5).

- **Coords:** (-268, 65, 572)
- **Pressure plate:** yes (inside) — auto-opens [[house-door]] on approach
- **Used by:** [[../procedures/exit-house]]

## Verification

Before any exit routine, confirm:
- y ≈ 65.0 (not 65.5+, which means standing on a chest)
- xz within 1.5 of (-268, 572)

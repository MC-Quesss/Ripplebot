---
type: place
name: outside_orientation
coords: [-275, 64, 572]
role: orientation_block
confirmed: true
---

# outside_orientation

Outside [[orientation-blocks|orientation block]]. The canonical pad outside [[house]], required before facing east to enter. No pressure plate — the bot must `activate_block` [[house-door]] before pushing forward.

- **Coords:** (-275, 64, 572)
- **Pressure plate:** none
- **Used by:** [[../procedures/enter-house]], [[../procedures/exit-house]]

## Verification

Before any entry routine, confirm:
- y ≈ 64
- xz within 1.5 of (-275, 572)

Activating the door from off-pad misses, and the forward-push then walks past the door slot.

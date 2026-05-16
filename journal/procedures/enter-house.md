---
type: procedure
name: enter_house
start: outside_orientation
end: house_center
confirmed: true
---

# Enter House

From [[../places/outside-orientation]] to [[../places/house-center]]. No pressure plate outside — the bot must `activate_block` [[../places/house-door]] before pushing forward.

## Steps

1. **Suppress `look_at`** for the duration.
2. Pathfind to `outside_orientation` (-275, 64, 572), `range=0`.
3. Verify on the pad: xz within 1.5 of (-275, 572), y ≈ 64. Activating the door from off-pad misses, and the forward-push walks past the door slot.
4. **Z-alignment:** if z > 572.3, face north and `walk_until z ≤ 572.1`. The corridor past the door is flanked by chests at z=571/573 and a modded block at (-271, 65, 572) with an extended hitbox. Pathfinder consistently lands at z≈572.5 which clips these obstacles.
5. `look yaw=-1.5708 pitch=0` (east). Wait for yaw convergence. Abort on failure.
6. `activate_block` on (-272, 65, 572) — [[../places/house-door]]. Pause ~300ms for the open packet.
7. `walk_until axis=x target=-268 direction=gte max_ms=8000`. Unstick strafe = **left** (north, away from chests). Momentum lands at ≈ -267.3. Bail on HP drop or death.
8. Verify: x ≈ -268, z ≈ 572–573, deaths unchanged. Standing on `house_center`.

## Corridor geometry (discovered 2026-05-14)

```
y=65 along entry line z=572:
  -274(air) → -273(air) → -272(DOOR) → -271(modded block, extended hitbox) → -270(air) → -268(air)
  z=571: chests at x=-271
  z=573: chests at x=-271
```

The passable band is narrow: z must be ≈572.0–572.1 to clear both the modded block and the flanking chests. The z-alignment step (step 4) centers Roz in this band.

## Related
- [[exit-house]]
- [[../places/orientation-blocks]]

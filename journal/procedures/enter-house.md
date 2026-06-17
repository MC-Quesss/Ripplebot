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

1. Pathfind to `outside_orientation` (-275, 64, 572), `range=0`.
2. Verify on the pad: xz within 1.5 of (-275, 572), y ≈ 64. Activating the door from off-pad misses, and the forward-push walks past the door slot.
3. **Z-alignment:** target z = **572.5** (center), safe band **572.3–572.7**. Nudge **north only if z > 572.7**; nudge **south if z < 572.3**. The corridor past the door is flanked by chests at z=571/573. Pathfinder consistently lands at z≈572.5 which is in-band; only correct if it lands outside the band.
4. `look yaw=-1.5708 pitch=0` (east). Wait for yaw convergence. Abort on failure.
5. `activate_block` on (-272, 65, 572) — [[../places/house-door]]. Pause ~300ms for the open packet.
6. `walk_until axis=x target=-268 direction=gte max_ms=8000`. **No unstick strafe on entry:** `ENTER_STRAFE = null` ("corridor too narrow for either") — it's a single forward push, no strafe. (Runtime-overridable via the strafe ctl, but the default is no strafe.) Momentum lands at ≈ -267.3. Bail on HP drop or death.
8. Verify: x ≈ -268, z ≈ 572–573, deaths unchanged. Standing on `house_center`.

## Corridor geometry (discovered 2026-05-14, updated 2026-06-01)

```
y=65 along entry line z=572:
  -274(air) → -273(air) → -272(DOOR) → -271(modded block, collision zeroed) → -270(air) → -268(air)
  z=571: chests at x=-271
  z=573: chests at x=-271
```

The modded block at (-271, 65, 572) is type 2959 (empty-name). Its collision shapes are permanently zeroed at spawn (fix applied 2026-06-01 in `bot.js`), so it no longer blocks walking or pathfinding. The z-alignment step (step 4) remains as a safety margin against the flanking chests.

## Related
- [[exit-house]]
- [[../places/orientation-blocks]]

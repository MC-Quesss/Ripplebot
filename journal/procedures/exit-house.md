---
type: procedure
name: exit_house
start: house_center
end: outside_orientation
confirmed: true
---

# Exit House

From [[../places/house-center]] to [[../places/outside-orientation]]. Pressure plate auto-opens [[../places/house-door]] on approach. **Do NOT** `activate_block` on exit — it toggles the door closed.

## Steps

1. **Suppress `look_at`** — a background yaw change during step 4 sends the bot east into [[../places/house-furnace]].
2. Pathfind to `house_center` (-268, 65, 572), `range=0`.
3. Verify on the orientation block:
   - `y ≈ 65.0` (≥65.5 means the bot is on a chest — re-route via bedside (-268, 65, 570) range=1, then to center)
   - xz within 1.5 of (-268, 572)
4. `look yaw=1.5708 pitch=0` (west). **Wait for `rawState.yaw` to converge within 0.25 rad.** Abort if not.
5. `walk_until axis=x target=-275 direction=lte max_ms=8000`. Bail on HP drop or death.
6. Verify: x ≈ -275, y=64, deaths unchanged. On `outside_orientation`.

## Failure modes (history)
- Yaw didn't take → walked east into furnace. **Mitigation: yaw convergence check.**
- Stood on chest → walked off into wall. **Mitigation: y check.**
- Used `control forward` with duration → wildly variable; sometimes died from suffocation in door. **Mitigation: never duration-based control through doors.**

## Related
- [[../places/orientation-blocks]]
- [[../places/yaw-convention]]
- [[enter-house]]

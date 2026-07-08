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

1. Pathfind to `house_center` (-268, 65, 572), `range=0`.
2. Verify on the orientation block:
   - `y ≈ 65.0` (≥65.5 means the bot is on a chest — re-route via bedside (-268, 65, 570) range=1, then to center)
   - xz within 1.5 of (-268, 572)
3. `look yaw=1.5708 pitch=0` (west). **Wait for `rawState.yaw` to converge within 0.25 rad.** Abort if not.
4. `walk_until axis=x target=-275 direction=lte max_ms=8000`. Bail on HP drop or death.
6. Verify: x ≈ -275, y=64, deaths unchanged. On `outside_orientation`.

## Failure modes (history)
- Yaw didn't take → walked east into furnace. **Mitigation: yaw convergence check.**
- Stood on chest → walked off into wall. **Mitigation: y check.**
- Used `control forward` with duration → wildly variable; sometimes died from suffocation in door. **Mitigation: never duration-based control through doors.**

## Update 2026-07-07 — proactive threshold strafe (user fix, verified 3/3)

User insight: most first-attempt exit hangups were the **north-jamb catch at
x≈-270.8** — the reactive right-strafe pulses rescued poorly (observed same
evening: 3 pulses, still "didn't clear door", full retry needed). Fix: a
**proactive one-shot 150ms LEFT (south, +z) strafe fired as x crosses -270.3**,
steering around the jamb before it catches. `walkUntilAxis` gained a
`thresholdStrafe: { at, strafe, ms }` option; the exit walk passes
`{ at: -270.3, strafe: 'left', ms: 150 }`. Reactive right-pulse kept as fallback.

Verified with 3 consecutive enter→exit drills: every exit logged
`threshold strafe left 150ms at x≈-270.3..-270.5` then `arrived (-275, 64, 573)
onPad=true` ~1.2s later — zero snags, zero retries, first attempt every time.

## Related
- [[../places/orientation-blocks]]
- [[../places/yaw-convention]]
- [[enter-house]]

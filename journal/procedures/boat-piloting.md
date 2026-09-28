---
type: procedure
name: boat-piloting
confirmed: true
---

# Boat piloting

Roz pilots a boat by **heading and feel**, not by snapping at coordinates.
Rebuilt 2026-09-26 after a review of the old routines found three faults:

1. **No piloting.** Every 50ms the old code aimed straight at the next coordinate, snapped the
   heading there instantly and moved the boat 0.15 blocks. No turning, no momentum.
2. **Heading sign flipped.** `vehicle_move` was sent with the yaw negated. North/south legs looked
   fine; every east/west leg faced backwards and diagonals ran sideways. This was the
   "boat goes backwards" failure of 2026-09-21 (see [[boat-route-new-home]]).
3. **Blind dead-reckoning.** It never read where the boat actually was.

## The pilot model (bot.js "Boat piloting")

- A **heading** that turns at most `rate` degrees per tick (default 3°/tick ≈ 60°/s). Turning
  right = left paddle only, left = right paddle only, forward = both.
- A **speed** that builds while paddling (max ~4 blocks/s) and decays while coasting
  (~2.7 blocks to stop from full). Roz only paddles forward once the bow is within 35° of
  the goal heading, so a sharp turn is made nearly in place instead of orbiting.
- **True position:** the server answers any rejected move (shore, block) with a clientbound
  `vehicle_move`; Roz adopts it. Six corrections at one spot = **aground**, and she stops.
- Every command ends by **easing off** (coasting to a stop) unless `hold: true`.

## Controls

Compass degrees: 0 = N, 90 = E, 180 = S, 270 = W (or words: `north`, `sw`, …). See [[yaw-convention]].

| Intent | JSON |
|---|---|
| Turn to a heading in place | `{"action":"boat_pilot","args":{"heading":"east"}}` |
| Turn relative (+right/-left) | `{"action":"boat_pilot","args":{"turn":-30}}` |
| Paddle on a heading for a while | `{"action":"boat_pilot","args":{"heading":90,"ms":5000}}` |
| Sweeping turn while under way | `{"action":"boat_pilot","args":{"turn":90,"ms":6000,"rate":1}}` |
| Keep momentum into the next command | add `"hold":true` |
| Ease off | `{"action":"boat_coast"}` |
| Correct my belief of the bow's direction | `{"action":"boat_pilot","args":{"assume_heading":"north"}}` |
| Get out and step onto dry land | `{"action":"exit_boat"}` (optional `to`, `land:false`) |
| Where am I / which way am I pointed | `{"action":"boat_status"}` → `heading`, `speed` (b/s), `pos`, `piloting` |
| Pilot to a point (eases in) | `{"action":"steer_boat_to","args":{"x":-200,"z":400}}` |
| Pilot a waypoint chain | `{"action":"steer_boat_route","args":{"waypoints":[{"x":..,"z":..}]}}` |

`stop` halts the boat at once. The pond idle routine uses the same pilot at half throttle.

## Status

**Untested live.** First lesson planned on the **open ocean**, not the pond (the pond is too
confined, shores too close): try a heading, get feedback on what the boat really did, adjust with
`assume_heading` / `rate`, and practise long sweeping turns.

## Update — 2026-09-27: first live trip passed

Farm port → ocean cabin dock along [[boat-route-new-home]], one `steer_boat_to` per checkpoint
(throttle 0.6–0.8, 0.4 for the final dock approach). Every leg arrived, 0 server corrections, never aground, ~2.5 min total.

**Disembarking is the weak point.** At the dock `exit_boat` reported "dismount may have failed" and `bot.vehicle`
stayed set, yet players saw Roz standing on top of the boat. Walking east off it slid her into the water
beside the dock; `pathfind` to (-127, 63, 347) climbed her out. `exit_boat` only clears a stale ref when the
bot drifts > 2 blocks from the boat — needs a better check.

**Fixed same day.** `exit_boat` is now a full disembark: send the dismount, and if the server
never echoes it (it usually doesn't here) clear `bot.vehicle` anyway; then pathfind onto the nearest
dry standing block within 4 (never an empty-name modded block), swimming out if the step lands in
water. `{"action":"exit_boat"}` → `{dismounted, confirmed, landed, landing, pos}`. Options:
`"to":{x,y,z}` picks the landing block; `"land":false` just gets out. Verified at the cabin dock:
one call, landed on (-127, 63, 347); Dad called it much smoother.

## Update — 2026-09-27: one-command voyages

`{"action":"sail_home"}` — ocean cabin → farm: leaves the bedroom via the corridor if needed, boards the
nearest boat at the dock, sails the 12 legs of [[boat-route-new-home]], `exit_boat` at the farm port, then
walks to the **wheat field center (-283, 64, 562)** (Dad: don't wait at the port).
`{"action":"sail_to_cabin"}` — the reverse, ending on the cabin dock.
Both are an `activeTask` ("voyage"), stop on `stop`, abort on a death, and refuse to start at night or after
tick 9500 (the trip is ~3000 ticks; river mobs) unless `"force":true`. Per-leg throttles are the ones
sailed by hand on 2026-09-27. **Not yet run end-to-end as one command.**

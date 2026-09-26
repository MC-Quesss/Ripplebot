---
type: procedure
name: boat-piloting
confirmed: false
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
| Where am I / which way am I pointed | `{"action":"boat_status"}` → `heading`, `speed` (b/s), `pos`, `piloting` |
| Pilot to a point (eases in) | `{"action":"steer_boat_to","args":{"x":-200,"z":400}}` |
| Pilot a waypoint chain | `{"action":"steer_boat_route","args":{"waypoints":[{"x":..,"z":..}]}}` |

`stop` halts the boat at once. The pond idle routine uses the same pilot at half throttle.

## Status

**Untested live.** First lesson planned on the **open ocean**, not the pond (the pond is too
confined, shores too close): try a heading, get feedback on what the boat really did, adjust with
`assume_heading` / `rate`, and practise long sweeping turns.

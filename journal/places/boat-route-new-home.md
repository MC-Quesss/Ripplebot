---
type: route
name: boat-route-new-home
confirmed: true
---

# Boat Route: Ocean Cabin (New Home) ↔ Farm

Water route between the ocean cabin harbor dock and the farm port. Cannot go in a straight line — land masses block the direct path. Y=62 for all water checkpoints.

## Checkpoints (ocean cabin → farm)

1. **Ocean cabin dock** — (-127, 63, 348) — harbor dock, start of route
2. **Away from dock** — (-133, 62, 349) — clear of the dock
3. **Harbor mouth** — (-140, 62, 342) — exiting the harbor
4. **Open water** — (-154, 62, 337) — open sea
5. **River mouth** — (-175, 62, 361) — entering the river
6. **Mid river** — (-189, 62, 393) — partway up the river
7. **River halfway** — (-199, 62, 408) — river halfway point
8. **Upper river** — (-216, 62, 428) — continuing upriver
9. **River branch** — (-231, 62, 444) — fork in the river
10. **Bridge north** — (-241, 62, 472) — approaching bridge
11. **Under the bridge** — (-239, 62, 499) — straight shot from bridge north
12. **Bridge south** — (-245, 62, 517) — past the bridge
13. **Farm port** — (-255, 62, 521) — final destination, farm side

## Return route (farm → ocean cabin)

Reverse the checkpoints above (13 → 1).

## Notes

- The bot CAN steer between checkpoints solo using `steer_boat` — position tracking works when the bot is driving, only stale as passenger.
- Use steer_boat left/right to change heading (strafe keys), not look — setting yaw directly causes sideways drift.
- Don't stop at every waypoint — waypoints are course-correction guides, not mandatory stops.
- Direct southwest heading from the dock hits land — must follow the charted waypoints.
- Hostile mobs on riverbanks are a threat — creeper killed the bot mid-river on the first attempt. Travel during daytime only.
- World spawn is at ~(222, 65, 258) — far from both homes; modded blocks near world spawn (types 1059, 1069) have real collision and cause suffocation.
- The rail line connects world spawn to the ocean cabin area — the bot can ride a minecart (activate the entity to mount). See [[spawn-station]].
- See also: [[house]] for the farm.

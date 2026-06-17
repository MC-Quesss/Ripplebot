---
type: place
name: house
bounds_x: -271..-264
bounds_z: 568..575
bounds_y: 65
confirmed: true
---

# House

The safe space. Auto-sleep is enabled inside this bounding box at `timeOfDay >= 12500`. Pressure plate inside the door auto-opens on exit. Re-entry requires manual `activate_block` on the door.

## Bounding box
- x: -271 to -264
- z: 568 to 575
- y: 65

## Interior waypoints
- [[house-center]] — exit origin
- [[house-bed]] — sleep
- [[house-kitchen-chest]] — wheat deposit
- [[house-crafting-chest]] — non-wheat storage
- **Project Bench** at (-270, 65, 569) — replaced the vanilla crafting table 2026-06-01. The only bot-drivable 3×3 craft block here; see [[../procedures/project-bench-crafting]]. (Bread is still mixed in the 2×2 inventory grid, not on a table.)
- [[house-furnace]] — east wall, hazard during west-facing missteps
- [[house-door]] — spruce door, west wall

## Exit & entry
- [[../procedures/exit-house]]
- [[../procedures/enter-house]]

## Hazards
- Furnace at (-265, 65, 571) is directly east of `house_center`. A west-facing yaw error during exit sends the bot into it.
- Pathfinder occasionally lands the bot on top of a chest (y ≈ 65.5 instead of 65.0). Verify `y ≈ 65.0` before any door procedure.

## See also
- [[yaw-convention]]
- [[orientation-blocks]]

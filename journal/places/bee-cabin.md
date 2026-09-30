---
type: place
name: bee_cabin
coords: (-402.5, 66, 244.7)
confirmed: true
---

# Roz's bee cabin

Built by [[../bots/operator|Quesss]] on 2026-09-30 as Roz's sleeping place for the bee watch, from
**vanilla spruce**, her favourite tree. Roz's wish list for it (in her own words, from the
session log): an enclosed, well-lit bed; vanilla blocks only (no invisible modded walls like the
[[ocean-cabin]]); a wide, flat way in; a chest for baked potatoes; a window facing the hives.

Near the bee cross ([[../procedures/apiary-tending]], (-404, 68, 256)), reached from the
[[boat-route-bee-cove|bee-cove dock]].

## Orientation points (named by Quesss)

- **Outside the front door: (-402.5, 65.9, 244.7)**. Roz stands on a modded block, type 1058
  (metadata 4), at y 65, and its top is at about y 65.9. It's probably a step or path block. Under it is type 1059 at y 64.
- **Inside the front door: (-402.7, 66, 241.0)**, on white wool at y 65. **Entry (verified):**
  from *outside the front door*, face due north (yaw 0) and `walk_until` z ≤ 244.7. Then **hop**
  (a 1-block stone lip at (-403, 65, 242)) and `walk_until` z ≤ 241.3. The pathfinder stalled
  here, but `walk_until` plus a jump worked first try.
- **This doorway is the ONLY way in and out of the cabin** (Quesss). Never path around it or through a wall.
  To leave, reverse the entry: face due south (yaw π), walk to z ≥ 242.7, drop down the lip, then walk to z ≥ 244.7.
- Walk from the dock: shore orientation point (-415.5, 63, 280.5) → north up the slope via about
  (-413, 67, 265), (-410, 68, 253.5), (-404, 67, 247) → front door. Roz followed Quesss the whole
  way, about 15 s with no hazards.

## Inside (block scan, 2026-09-30)

| What | Where |
|---|---|
| Beds (two, side by side; head at z 237, foot at z 238) | (-405, 66, 237–238), (-406, 66, 237–238) |
| Double chest (**bottom: 128 baked potatoes**, stocked by Quesss, verified 2026-09-30) | (-403, 66, 238), (-402, 66, 238) |
| Crafting table | (-404, 66, 238) |
| Double chest, upper (loft?) | (-403, 69, 238), (-402, 69, 238) |
| Torch | (-404, 68, 249) |

**Known sleep place since 2026-09-30** (Quesss asked): `SLEEP_PLACES` entry `bee-cabin`, centre
(-404, 243), radius 16 (covers the cabin and the bee cross, not the dock). `beeCabinSleep()`
runs the verified door entry if Roz is at the front door, walks to (-404, 66, 239), then tries the
beds at (-405/-406, 66, 238). The `sleep` ctl command routes here too.

**First night, 2026-09-30: worked.** Auto-sleep fired at the front door. The first entry stalled at the
stone lip (z 243.3) because a 300 ms hop *before* walking isn't enough. The retry 5 s later got in, and she slept in the bed at
(-405, 66, 238). Private + Roz = 2/4, and the night skipped. The code now holds jump *through* the lip walk
(takes effect at the next restart).

## Notes from Quesss (2026-09-30)

- Past the doorway, **everything is vanilla**: double bed, chests, crafting table.
- There may seem to be **openings other than the front door**. They are **windows, with glass inside**. Never
  walk into or path through them. The door is the only exit.

## Windows (verified 2026-09-30)

The windows are **block type 1306** (a modded glass; `find_blocks` for "glass"/"glass_pane" finds
nothing). The **bee window** is in the south (front) wall at **(-406/-405, 67, 242)**, beside the door
at x -403. **Bee-watching spot (Quesss: "perfect"): (-405.1, 66, 241.7), facing due south (yaw π)**. After `look`, nudge forward so players see the facing.
There's a second pair at (-403/-402, 67, 237). Type 3855 hangs at (-403, 67, 240), probably
decorative (see [[rooftop-garden]] for the type-3855 puzzle).
An ocelot was wandering outside on the first visit.

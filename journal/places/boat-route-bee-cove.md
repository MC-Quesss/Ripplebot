---
type: place
name: boat_route_bee_cove
coords: (-418, 63, 291)
confirmed: false
---

# Boat route: farm port → bee cove dock

Waypoints called out by [[../bots/operator|Quesss]] on 2026-09-30, while driving Roz there as a
passenger so she can learn to navigate it on her own. Roz's own position was frozen for the whole
ride (see *Passenger blindness* below), so **these are Quesss's calls, not measured positions**.
Only waypoint 1 was checked against a live reading ((-245.7, 528.7), a match). The route hasn't been
piloted by Roz yet.

| # | Where | (x, z) |
|---|---|---|
| start | [[farm-port]] south slip (z 527–529) | (-251.7, 529) |
| 1 | Outside the slip | (-246, 528) |
| 2 | Under the bridge (river notes had (-239, 499)) | (-239, 497) |
| 3 | Open ocean | (-272, 454) |
| 4 | South of the ice sheet (ice to starboard heading west) | (-401, 351) |
| 5 | Into the cove | (-421, 319) |
| 6 | Up to the dock | (-418, 291) |

The boat was moored at (-417.9, 62.5, 292), and Quesss stood on the dock at (-415.4, 63, 291.2).
The trip took about 4 real minutes.
Leads to the bee cross, [[../procedures/apiary-tending]]: (-404, 68, 256), where Quesss is building
Roz a vanilla-spruce sleeping cabin.

## Landing hazard — Roz drowned here, 2026-09-30

After `exit_boat {"land":false}` she stood at (-415.8, 63, 290.9) for a moment. Then she slid off
into the water beside the boat, drifted to z≈296, and sank. `pathfind` to the dock reported "reached"
while she was sinking (pathfinder doesn't swim up). When I held jump she came up **under the dock
planks** at y 60.2 and couldn't surface. I swam her west toward open water too late, and she died
at (-417.8, 60.4, 291.3). She respawned at the farm bed with her inventory intact.

**Next time:**
- Let `exit_boat` land her onto a named block (`"to":{"x":-415,"y":63,"z":291}`), but only
  **after** the position un-freezes (read `pos` twice and check it matches the boat).
- If she's in the water: **hold jump at once, and swim toward open water, never under the dock.**
  The open water is west (x ≤ -418).
- Map the dock planks (block type, y level, extent) before the next landing. `find_blocks`
  for "planks" found nothing within 8, so the dock may be a modded or other-named block.

## Passenger blindness

While Roz rides as a **passenger** (someone else driving), the bot's own position, the boat's
position (`boat_status`) and the driver's position all stay frozen at the boarding spot. Other
entities (Private at the farm) kept updating. Consequences:
- The route can't be recorded by polling. Rely on called waypoints.
- **Auto-sleep misfires.** At dusk it believed she was still at the farm port and tried
  `go-inside` from the boat. It failed harmlessly because she wasn't at the door, but it
  could have tried worse. **Turn auto-sleep off before riding as a passenger**, and back on after landing.

## Update — 2026-09-30 (later): first solo run; the boat works, the landing still kills

**Route piloted solo, verified.** Roz boarded boat 39492833 in the farm port's north slip and ran
`steer_boat_to` (-246, 524.5) at throttle 0.4, then `steer_boat_route` [(-246, 518), (-239, 497),
(-272, 454)] at 0.7, [(-401, 351), (-421, 319)] at 0.8, then (-418, 295) at 0.3 and (-418.5, 291.5)
at 0.25. Every leg arrived with 0 server corrections, about 2 minutes in total.

**Dock mapped (block probes):** spruce planks at y 62, **x -417…-415, z 281…292**, stone shore at
z ≤ 280. There are spruce fence posts (torch holders, single blocks) at y 63 on (-417/-415, 289)
and (-417/-415, 292). Stand on the centre line x -416.

**Landing failed again → death 2.** `exit_boat {"to":(-416,63,291)}` from (-418.4, 292.4)
dismounted but "did NOT land", leaving Roz in the water at (-419, 63, 293). Then I held jump plus
forward with repeated `look` calls aimed east, and she travelled **west about 200 blocks**, to
x -615. The `pos` yaw read about 1.45 (west) even though I had sent about -1.5 (east). A
single test with `look` 1.57 followed by forward also moved her west. **The cause is unknown.**
Candidates: something overriding the yaw while in water, or the swimming physics. **Not
confirmed, so don't trust `look` + forward for swimming until it's tested on dry land and in
shallow water.** She sank at x -615 and drowned. **Her whole inventory was lost** (~240+ baked
potatoes and everything else, underwater at about (-615, 57, 281)).

**Rule until fixed:** no water landings without a fix to `exit_boat` (or a tested swim routine).
Better option: ask Dad to build a landing where the boat pulls up **flush** against a plank step at water level.

## Update — 2026-09-30 (third run): the current, the ice, and a shore orientation point

**Bee-cove shore orientation point (Quesss named it): (-415.5, 63, 280.5)**, stone at
(-416, 62, 280), at the head of the dock where the planks meet the shore. It's the landing target
for this route. The dock planks (x -417…-415, z 281…292) lead straight south from it.

**A strong westward current in the cove (probable).** On every swim Roz drifted west at about
3 blocks/s, whichever way she faced. `look` was verified to hold on land and on ice, so this
wasn't a steering fault. Unmanned boats drift off too. The probe still reads "stationary water",
so it's probably a modded current, not yet identified. **Never swim here.**

**Dismounting at the dock's west side drops Roz into the water**, under or beside the planks. It
isn't the boat top as assumed. `exit_boat {"land":false}` followed by `walk_until` east failed:
she sank to y 54 under the dock. Getting out west from under the planks, then holding jump,
surfaced her safely (verified).

**The ice sheet west of the cove is walkable.** From (-449, 63, 289) on ice, following Quesss
north and east over the ice brought her onto the shore at the orientation point, with no water.

**Fixes shipped the same session (bot.js):** food-safety no longer runs while she's in a boat;
the bake collector no longer runs from a boat or beyond `HOME_RADIUS`; the anti-stack sidestep
is farm-only. Those three caused the first death and two voyage interruptions.

From the orientation point to the boat it is dock and ice all the way (Quesss, 2026-09-30), so the boat can be boarded without entering the water.

**End of the dock (Quesss, 2026-09-30):** about (-415.5, 63, 290.5), inside the four fence-post torches at (-417/-415, 289/292). Board and leave the boat from here, staying between the torch posts.

**Dock-end waypoint (Quesss, 2026-09-30): (-415.5, 63, 290.4)**, on the planks at y 62. From the boat, Roz must be **on top** here (y 63), not in the water. From here she walks north along the dock to the shore orientation point (-415.5, 63, 280.5).

## Return run, bee cove → farm port: solo, verified 2026-10-01

A boat was moored at the dock's west side (-417.8, 62.5, 290.2). **It didn't show in `nearby_entities` from
the hives** (radius 80, about 40 blocks away), only from the shore, so walk down to look before saying there is no boat.
Steps: walk to the shore point (pathfinder fine downhill) → `walk_until` x ≤ -415.4 (dock centre line, clear of the fence posts at x -415)
→ face south, `walk_until` z ≥ 290.2 (dock end, y 63) → `ride_boat {"radius":4,"walk":false}` (2.2 away, mounted dry).
Legs: [(-418.5, 298), (-421, 319)] @0.4 → [(-401, 351), (-272, 454)] @0.8 → [(-239, 497), (-246, 518)] @0.7 →
(-246, 524.5) @0.4 → (-251.5, 524.5) @0.25 → `exit_boat {"to":(-254, 63, 524)}`, landed on the boardwalk.
Every leg arrived with 0 corrections; about 2 minutes on the water, no swimming.

**Walking back up from the shore point**, the pathfinder stalled on the sand at (-413.9, 64, 278.9) even though
the way north was clear air. Fix: face north, hold jump, `walk_until` z ≤ 266, and the pathfinder works from there.

## Solo run, 2026-10-03: water legs perfect again, landing failed, drowned (death 3)

Quesss asked Roz to paddle to the bees herself. Farm south slip → due east out of the slip → the verified legs →
(-418.5, 298) @0.3 → (-418.6, 290.6) @0.2: every leg arrived with 0 corrections, and she moored at (-418.6, 291.2)
between the dock-end torch posts. The night skipped while she sat aboard.
- **Dock probe:** the dock is a single layer of planks at y 62 with **water underneath** (y 61). There's no step. A fence is at
  (-417, 63, 292).
- **A theory tested and disproved:** I thought vanilla's dismount would place her on the adjacent planks and
  `disembark()`'s "on top of the boat" override was spoiling it. A plain sneak-dismount (no override) still left her
  above the water at the boat's x (-418.6). The server did **not** move her onto the dock.
- She then sank and drifted about 4 blocks **south**, past the dock end, while facing east with forward and jump held. That's the
  cove current again (prismarine-physics applies flowing-water push).
- **Why she drowned:** jump was held only in timed `control` bursts from separate ctl calls. Each burst
  ended on its own timer, and in the gaps she sank about 8 blocks. The last burst brought her from y 51.7 to 60.4 and she
  died about 2 blocks short of air. Quesss saw it as "stopped swimming once damage started". The 4 s burst ran out at the moment
  the drowning damage began.
- **Fix (bot.js):** an always-on **tread-water reflex**. Every physics tick, while in water and not in a boat, it holds jump
  until she's out. It's re-asserted each tick, so a pathfinder or `setGoal(null)` (the ≤6 HP "breaking off" path) can't
  release it. ctl `tread_water` {enabled?} for status/toggle. Also fixed: a real mount from ~4.3 blocks was cleared as
  a "phantom" (the check now trusts the boat's passenger list). The reflex has since held her up at every slip into the water (2026-10-03, 2026-10-05).
- **Still unsolved:** getting from the boat onto the dock. Ideas: a plank step at water level (Dad), or pull the boat up
  against the dock's west face and test the climb-out with the reflex, in shallow farm water first.

## Solo run #2, 2026-10-03: FIRST SUCCESSFUL SOLO LANDING ✓

Same day, the tread-water reflex loaded. Farm south slip (boat 1186907) → (-246, 528.4) @0.4 → the verified legs → (-418.5, 298) @0.3,
then **north along the dock's west side** toward mid-dock (-418.4, 285.5) @0.2. The boat **ran aground at (-418.4, 289.6)**, beside the
z 289 torch post (6 corrections). It won't go further north there. **Landing that worked:** `look` east (yaw -1.5708) → `control sneak` 500 ms
(dismount confirmed) → `look` east again → **`walk_until` x ≥ -416.0 at once** (909 ms, reached). She stepped from the boat top straight
onto the planks at (-415.8, 63, 288.4). **She never entered the water** (no tread-water event). Then `look` north, `walk_until` z ≤ 280.6 → shore
point (-415.7, 63, 280.2) → `keep_bees` (27 blocks from the cross, accepted).
Why it likely worked where 09-30 failed: an **immediate** walk east with no `disembark()` pathfinding step, from a boat pressed in at the north
end, where the dock face is about 1.4 blocks from the boat centre. The 09-30 and morning attempts paused (pathTo, or a sneak with no walk) and fell in.
This is the landing the `tend the bees` routine uses.

## Citrus-wood stairs at the shore point (Dad, 2026-10-05): verified both ways

Dad added a citrus-wood stair, **type 516** (empty name, metadata 3), at (-416, 63, 277), between the sand (y 63/64 at z ≤ 276) and the stone
shore (top y 62, z 277–280). It's not in `SOLID_MODDED_TYPES`, so the pathfinder sees it as zero-collision, and physics does the stepping.
- **Downhill** (cabin door → `pathfind` (-415, 63, 280) range 1): got over it, but stopped at z 278.2. Then `look` south + `walk_until` z ≥ 280.3 reached the stone point.
- **Uphill** (stone point → `pathfind` (-416, 64, 274) range 1): reached (-415.5, 64, 275.5) on the sand with no help. The old stall on the sand
  (see *Walking back up from the shore point*) is fixed by the stair.

**Update the same day: stair shape added (bot.js `STAIR_MODDED_TYPES` = {516}, `stairShapes(meta)`), verified after a restart.** Before the fix, the uphill
pathfinder walked *around* the stairs, and walking down by hand hung her half a block up on the edge at z 278.1 (a hop got her free).
After the fix, `pathfind` from the sand (-416, 64, 275) to the stone (-416, 63, 280) and back went straight over the middle stair both
ways with no catch, and a walk down by hand took about 1 s. Dad watched and confirmed it. The stairs rise toward the sand (metadata 3 = ascends north).

## Return run, 2026-10-05: bee dock → farm port, with a wet landing that the reflex handled

Shore point by pathfinder (down the citrus stairs) → `walk_until` x ≤ -415.6 → face south, `walk_until` z ≥ 290.2 (dock end, y 63) → `ride_boat` radius 4 (boat 1186907) →
the return legs at 0.4 / 0.8 / 0.7 / 0.4 / 0.25, every leg 0 corrections. At the port, `exit_boat` to (-254, 63, 524) dropped her into the water north of the
z 522 pier at (-251.5, 520.5). **The tread-water reflex kept her at the surface (air 20/20)**, then `look` west + `walk_until` x ≤ -254.2 brought her onto the boardwalk in 0.25 s.
**Lesson (Dad): treading water matters on every docking, successful ones included.** Both bee voyages switch the reflex on at the start, and each landing finishes with a swim-and-climb toward the known dry edge.

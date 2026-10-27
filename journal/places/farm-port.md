---
type: place
name: farm_port
coords: (-254, 63, 524)
confirmed: true
---

# Farm Port (the dock)

The farm end of the river boat route ([[boat-route-new-home]]), on the west bank ~50 blocks north
of the [[house]]. **Rebuilt by Dad on 2026-09-28** as a proper wooden dock (surveyed by block probe
that day; supersedes the older "farm port (-255, 62, 521)" bank).

## Layout (y=62 planks, stand at y=63)
- **Boardwalk** — spruce planks, 2 wide, **x -255…-254**, running z 517 → 532+ along the shore.
- **Finger piers** — planks at **z 522, 526, 530**, reaching east from the boardwalk to **x -251**.
- **Slips** (open water between piers): **z 523–525** (middle slip) and **z 527–529**; open water also
  north of the z=522 pier and south of the z=530 pier. River water from x -250 eastward.
- Modded blocks on top (empty name): **type 3855** at (-255, 63, 517) on the boardwalk and at
  (-251, 63, 520), (-250, 63, 528), (-257, 63, 528) — posts/markers of some kind, not yet identified;
  **type 1171** at (-256, 63, 516). Treat as unknown — don't route through them.

## Waypoints used by the code
- **Boat target: middle slip (-251.5, 524.5)**, approached from **(-247.5, 524.5)** east of the pier
  ends — `RIVER_ROUTE` and `BLEU_TO_PORT_LEGS` both end this way.
- **Landing: boardwalk (-254, 63, 524)** beside the middle slip (`FARM_PORT_LANDING`).
- **Idle-wander stand: (-255, 63, 524)** on the boardwalk, facing east across the river to the
  [[bleu-de-paris]].

## Boats moored here (2026-09-28)
- 35940271 — in the middle slip (-251.4, 524).
- 35940270 — Roz's paddle boat, south of the z=530 pier (-251.6, 532.8).

## Update — 2026-10-27: a fourth pier, a north slip
Dad added a finger pier at **z 518** (planks x -255…-251, y 62; water starts at x -250), which makes a
**north slip at z 519–521** between it and the z=522 pier. The dock now has four piers (518/522/526/530)
and three enclosed slips: north z 519–521, middle z 523–525, south z 527–529. Survey by block probe,
standing at the landing. **Dad: keep using the slip the boat is in, second from the north**,
the middle slip (-251.5, 524.5). The code's targets are unchanged; the new slip only needs to be known.

**Landscaping west of the path:** Dad's new work sits on the land west of the grass path (path at
x -256…-257), roughly x -257…-266 and z 519–530: a solid field of modded blocks (types 2963, 3855,
1171, empty names) one block above the grass. Dad stood in it at (-258.5, 63, 523.5) to show Roz.
**Stay on the path**, and never route through it.

Boats seen that morning: 13155360 in the middle slip (-250.9, 523.7); 13155762 and 13155761 south of
the z=530 pier (-252.3, 531.7 / 533.3).

Related: [[boat-piloting]], [[gangplank-bleu-de-paris]]

## Update — 2026-09-28: entering the slip
Come in **on the centre line z=524.5** from (-246, 524.5), slow (throttle 0.25). Arriving a block north
(z≈523.4) grounds the boat on the z=522 pier. `exit_boat` tends to stop short here — walk the last
blocks to the boardwalk (-254/-255, 63, 524).

## Update — 2026-10-24: the walking path from the port to the front door (Quesss)

Quesss: from the port, **stay on the vanilla grass path**. Cutting corners gets Roz stuck. Walked and verified the same day:

1. From the boardwalk, go south along the path column **x -257/-256** to **(-256, 63, 546)**. That's the corner waypoint Quesss marked: she must pass through it.
2. North a step onto the path row **z 545**, then **west** along z 544–545 to **x -276.5**.
3. **South** down the path column x -277/-276. At **(-277, 63, 548)** there's a **birch-stair step** (an upside-down stair at y 62 under it). Hold **jump** while walking south, or `walk_until` stalls at z 547.7.
4. Keep going south to **z 571.5**, which is the [[outside-orientation]] point (-275, 64, 572). `go_inside` works from here.

Always `look` first: `walk_until` keeps whatever yaw she already has. On 2026-10-24 that sent her the wrong way twice: off the bee dock into the cove, and 13 blocks up the boardwalk.
Unrelated to the path: the MTAC mock-up sits just west of the port. See [[mtac]].

**Code (2026-10-24, uncommitted; verified live the same day: house → port in 18 s on the bee voyage, no stalls):** `walkFarmPath(toPort)` in bot.js walks this path through corner waypoints (`FARM_PATH_DOOR_TO_PORT`), including Dad's corner (-256, 546). The bee voyage out and home, the Bleu paddle-over, and the river voyage now use it between the front door and the port, instead of a free `pathTo`.

**Idle wander, 2026-10-24 evening (Quesss: "update the idle wander routine to STAY ON THE PATH"):** the farm-port visit (`runIdleWanderToPort`) used a free `pathTo` to the stand, and Muse didn't know about the corner. It now walks `walkFarmPath` both ways: out along the path, 20–40 s at the stand, then back along the path to the front door, so the next wander pick doesn't path home freely from the port. A task, follow or stop drops the walk at once. Bedtime ends the visit, but the walk home still uses the path. Not live-tested yet. Muse and Private need a restart onto the new bot.js.

**All routes near the port, 2026-10-24 night (Quesss: "update the stay on path for all routes near the farm port"):** Quesss saw Private stuck on the corner for a minute. Two gaps were closed:
- **Leaving the port area by any route.** `leaveFarmPortByPath()` walks the path home first whenever the bot is near the port (x -279 to -249, z 518 to 548, which takes in the port, the MTAC side and the path's corner). Two routes call it: `runGoInside`, which covers come-inside, auto-sleep and bedtime, and the wheat harvest's walk to the field. The Bleu paddle-home ends at the port, so whatever comes next goes home by the path too.
- **The birch stair step at (-277, 63, 548).** When the pathfinder stalls on a straight leg of the path, `walkFarmPath` now hops it: it holds jump and runs `walk_until` along that leg's axis, then lets the pathfinder finish the waypoint. This step is the likely corner snag.
Not live-tested yet. All bots need a restart onto the new bot.js.

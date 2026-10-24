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

**Code (2026-10-24, uncommitted, not yet tested live):** `walkFarmPath(toPort)` in bot.js walks this path through corner waypoints (`FARM_PATH_DOOR_TO_PORT`), including Dad's corner (-256, 546). The bee voyage out and home, the Bleu paddle-over, and the river voyage now use it between the front door and the port, instead of a free `pathTo`.

---
type: procedure
name: gangplank_bleu_de_paris
confirmed: true
---

# Gangplank — boarding and leaving the Bleu de Paris

A **fixed corridor**, like the bedroom corridor at the [[ocean-cabin]] (Dad, 2026-09-28): the only
safe way on or off [[bleu-de-paris]] is straight along the gangplank. Do not improvise a route.

## Why
The gangplank is **modded plank slabs (type 1744)** over open water (nothing under x=-226). The bot
only stands on it because 1744 is in `SLAB_MODDED_TYPES` (half-block collision). Step off the line and
the next block may be modded, unverified, or water. x=-230 (lever floor + type 2924) is unverified.

## Board (shore → boat)
1. Reach the **gangplank pad** (-222, 64, 537) — `pathfind` range 0. From the farm: pathfinder
   swims the river to the grass landing (-226, 63, 548), then onto the mud bricks (type 1079, solid).
2. `pathfind` range 0 → (-228, 64, 537) — straight west along z=537, at y≈64.5.
3. `pathfind` range 0 → **on-boat pad** (-229, 64, 537).

## Leave (boat → shore)
Reverse: (-229, 64, 537) → (-228, 64, 537) → gangplank pad (-222, 64, 537), straight east along z=537.
(Not yet run in this direction.)

## Guard
Poll `pos` while crossing; if y drops below 63.5, `pathfind_stop` — she has fallen off the line.

## Routine (bot.js, 2026-09-28)
- `{"action":"board_bleu"}` / `{"action":"leave_bleu"}` — `gangplankCross()`: walk to the start pad,
  refuse if not on it, `faceYaw` west/east, `walkUntilAxis` along x with `maintainYaw`, throw if y < 63.5.
- `pathTo` corridor rule: on the boat with a target ashore → leave by the gangplank first; ashore with a
  target on the boat → board first (like the cabin exit-first rule).
- Auto-sleep: aboard at bedtime → **stay aboard**, never walk home (Dad).

## Going home — bring the paddle boat back (Dad, 2026-09-28)
When leaving the Bleu, **paddle the boat you came in back to the farm port** — don't strand it on the
east bank. `{"action":"bleu_paddle_home"}` (optional `boat_id`): gangplank off → grass landing
(-226, 63, 548) → board *that* boat (`lastBoardedBoatId`, recorded on every mount; lost on restart —
pass `boat_id` then) → legs (-233.5, 548) → (-236.5, 543) → (-237, 534) → (-253, 526) → `exit_boat` to
(-255, 63, 524), finishing the walk to the bank if the landing stops short.
Boat 35940144 is moored on the east side for good — not ours to move.

## History
- 2026-09-28: first boarding, Roz, clean (y 64.5 throughout). Needed two code fixes first: mud bricks
  1079 → `SOLID_MODDED_TYPES`, gangplank 1744 → `SLAB_MODDED_TYPES`.

Related: [[orientation-blocks]], [[boat-route-new-home]]
- 2026-09-28 (later): `board_bleu` live from the shore pad — gangplank in 1.7 s, z held at 537.50,
  0 snags. From the farm it first failed safely: `pathTo` quit 6 blocks out (pathfinder paused between
  segments) and the pad check refused to cross. Approach now retries until on the pad (untested live).
- 2026-09-28 (dawn): first `bleu_paddle_home` **failed twice over**: (1) `onBleu()` edge was x ≤ -228.6
  but the pad reads x≈-228.54, so it skipped the gangplank and walked off the side (Dad saw it);
  (2) the leg to (-234.5, 541) grounded on the stern hull (8 corrections). Finished by hand over new
  legs — 4/4 arrived, 0 corrections — and walked the last blocks to the bank (`exit_boat` stopped short).
  Fixed: edge x < -228, the proven legs, a landing retry. Boat 35940270 returned to the port. Re-test pending.
- 2026-09-28 (day 53833): Dad reworked the east bank — **bridge at z≈550** (modded 2147/4029, don't route under it) and the old landing grass is gone. **Getting there is by paddle boat, not swimming** (Dad). Proven course, both ways, 0 corrections:
  port slip (-251.5, 524.5) ↔ (-247.5, 524.5) ↔ (-237, 534) ↔ (-236.5, 543) ↔ (-233.5, 547) ↔ landing water (-229.5, 547.5);
  **land on (-229, 63, 549)** (new grass row, north of the bridge), then `pathfind` to the gangplank pad. `leave_bleu` verified.
  Coded (loads next restart): `board_bleu` from afar → `bleuPaddleOver()` (port → boat → legs → landing → gangplank); `bleu_paddle_home` uses the same legs reversed and the new landing.
- 2026-09-28 (day 53834, 02:00): **`board_bleu` from the farm door pad — end to end, one command, PASSED.** Walk to port → boat → 5/5 legs, 0 corrections → `exit_boat` landed (-229, 64, 549) → gangplank → aboard, ~80 s total.
- 2026-09-28 (02:02): **`bleu_paddle_home` end to end — PASSED.** Gangplank off → boat 35940271 (the one it came in) → 5/5 legs, 0 corrections → `exit_boat` stopped short at (-252, 62, 521) again, and the landing retry walked her onto the boardwalk (-253.5, 63, 524.5). ~60 s. Both directions now proven as one command each.
- 2026-10-03 (day 54214): **`board_bleu` from the farm failed on leg 1**, aground at (-250, 63, 528). The boat Roz took was not in the slip. It sat ~3 blocks south, and its heading (41°, NE) ran it into the **pier planks** just north of it (6 corrections in 3.5 s). **Dad's rule: every boat leaving the farm port goes due east for ~2 paddles first, to get clear of the pier.** Not coded yet: leg 1 should become a due-east clear-out from wherever the boat actually is, not a fixed slip coordinate. Finished by hand: legs 2–5 via `steer_boat_route`, 4/4 arrived, 0 corrections; `exit_boat` landed dry at (-227.3, 63, 548.7).
- Same day: **citrus wood fence + mailbox** on the shore approach (empty-name modded blocks at about x -225…-224, z 537–538 and (-224, 541)). Modded empty-name blocks have zero collision, so the pathfinder walks straight into them and stalls at about (-223.3, 64, 542.2), and `board_bleu`'s approach then refuses ("not at the shore end"). **The stalled pathfinder stays active** (`isMoving:true`) and overrides `look`/`walk_until`, so `pathfind_stop` first. Working approach: face east, `walk_until` x ≥ -221.7, face north, `walk_until` z ≤ 537.6 (the pad), then `board_bleu`. Candidate fix: add the fence's type to `SOLID_MODDED_TYPES` (type id not read yet).

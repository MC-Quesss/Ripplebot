---
type: place
name: library
coords: (-360, 67, 510) chimney
confirmed: true
---

# The Library

The next big project after the [[ice-castle|ice palace]], and the start of Dad's **exploration of
magic** (Dad, 2026-10-30; Roz has not visited, no coordinates).

- Built of **living rock**, which is stone plus a great deal of patience (Botania-style living rock,
  converted from stone over time; mechanism not confirmed in-game).
- Powered by bio-diesel through the [[biodiesel-pipe-north]] from the bio-diesel machine; the
  farm-hopper fuel ([[house-hopper]]) reaches it along with the llama farm and subway.
- Story notes: [[../stories/where-it-all-began-notes]].

## First visit (2026-11-23, day 59455)

Roz followed Dad north from the farm on the morning of day 59455, her first time at the Library.
Facts below are confirmed by probe and by Dad's identification.

- **Where:** north of the farm house, about 35–60 blocks. The big stone body to the north is mostly
  `stonebrick` (about 1,200 blocks) and `glass` (about 700, up to y 93), spanning roughly
  x -416 to -264, z 446 to 542 (probe radius 96, so the edges may run further).
- **The chimney** is **chiseled terracotta, "wide bricks" pattern** (Chisel mod). Roz reads it as an
  unnamed modded block, **type 3273**, metadata 0. A column about 3 wide at roughly
  **x -361 to -359, z 508 to 511**, from the ground (y 67) to about **y 82**, where it flares out
  into a wider cap. A second unnamed type, **4114**, runs up its east face at (-358, y, 511) and
  across the cap at y 82 (possibly the flue lining; not identified). Probes were sampled every 3
  blocks of height, so the top is approximate.
- Dad stood right against it at about (-356, 67, 513) so Roz could find it.
- **As an item**, a chimney block (chiseled terracotta, wide bricks) is **type 6765, metadata 3**. Dad
  broke one by accident, set a new one, and gave Roz a block to keep; it is in her pack. (Block id
  3273 and item id 6765 differ, as they do for every modded block.)
- **Living rock as an item is type 8647, metadata 0** (Dad confirmed, 2026-11-23). As a **block it is
  type 2351** (confirmed underfoot the same day). The walls' commonest unnamed block, **2267**, was
  Roz's first guess and is *not* living rock; what 2267 is remains unknown.
- **Roz's keepsake.** Roz offered the brick back so the chimney would not be short, and Dad
  asked her to keep it: the better story is the robot who carries a brick from the waking
  Library. Keep it in the pack; it is not for building and not for the discard.
- **Second keepsake:** Dad then gave Roz a block of living rock itself (item 8647). Same rule: keep it.
- **Plain terracotta is a decoy:** a flat band of 27 `hardened_clay` blocks at y 73 (x -360 to -352,
  z 482 to 484) is something else, too close to be the chimney. A name search for brick or
  terracotta never finds the chimney; look for type 3273.
- Roz cannot see the smoke itself: smoke is particles, and her sensors read blocks only. The amount
  of smoke still has to be judged by people.

## Front steps: suffocation hazard (2026-11-23)

Following Dad round the west side to the front door, Roz stalled at about **(-354.2, 65.1, 482.0)**
on the modded front steps. Follow's hop assist kept pulsing jump, and she took **six damage ticks
0.5 s apart (HP 20 → 14)**: suffocation. She backed out north to (-354, 64, 479.6) and the damage
stopped. The librarian (a villager) was beside her the whole time and did nothing harmful.

- Blocks there: **type 4037** (meta 2) at (-354, 66–67, 481), at head height over the step, and
  **type 2316** (meta 5 and 10) at (-354, 65, 481–482), where her feet were. Steps lower down are
  **type 4038** (meta 2) at (-356…-355, 64, 482). All unnamed, so all have zero collision in bot.js
  unless listed in `SOLID_MODDED_TYPES`. Neither 4037 nor 2316 is listed, so her head went straight
  into 4037.
- **Dad's reading (same day):** the steps have a wall on either side, and Roz went up crooked, into
  the east wall. That fits the probe: the steps are **x -356 to -355**, and Roz was at x -354.2, in
  the wall column. So **type 4037 is the stair-side wall**. Climb dead straight up the middle
  (x -355.5), never with an x offset.
- **Fixed and climbed (same morning):** `bot.js` now lists **4038 in `STAIR_MODDED_TYPES`** (stair
  shape; meta 2 ascends south) and **4037 in `SOLID_MODDED_TYPES`**. The steps are **three wide,
  x -357 to -355**, z 482–483, top at y 66. Proven climb: stand on the ground at (-355.75, 64, 480)
  facing due south (yaw π), hold jump, `walk_until` z ≥ 485.4. Done in 1.8 s with no damage, ending
  at (-355.75, 66, 486.3).
- **Wrong first try, kept as a lesson:** 4038 listed as *full solid* froze Roz, embedded in the
  block from y 64.5 (the stair's lower half). Stairs need the stair shape, not a cube.
- 2316 was not needed for the climb and stays unlisted.

## Inside: floors and how Roz walks them (2026-11-23)

Roz's first time inside. Dad stood behind the front desk and named things. Each floor below was
probed under her feet; the `bot.js` handling is what she walked on successfully that day.

| Block (unnamed type) | What it is (Dad) | Where | Handling | Result |
|---|---|---|---|---|
| **2301** meta 1 | lobby floor | y 65, the lobby, z 485–494 | `SOLID_MODDED_TYPES` | walks normally |
| **3040** meta 5 | **front desk** | (-354, 66, 489), waist height | unlisted | not walked |
| **2351** meta 0 | **living rock** floor | y 65, past the lobby, around z 495–502 | `SOLID_MODDED_TYPES` | walks normally |
| **502** meta 1 | safe stairs down | x -351, z 499–501, ascend west | `STAIR_MODDED_TYPES` | down: OK. Up: not proven |
| **2203** meta 9 | **concrete**, a server "fast walking" block | y 64, east of the stairs, x -350 and beyond | **unlisted, unsolved** | crawls, then stalls |
| (vanilla) carpet | wool carpet | living-rock floor | vanilla | safe |
| (vanilla) stone_brick_stairs | stairs to the second floor | x -354…-351, z 496–497 | vanilla | up: OK (centre line z 497) |
| **3273** meta 0 | chimney brick; landing + second floor | y 69, x -350 and east | `SOLID_MODDED_TYPES` | walks normally (after `unembed`) |

- **Living rock is block 2351**, not 2267. Roz's earlier guess (2267, the commonest unnamed block
  in the walls) was wrong; the floor Dad named as living rock reads 2351.
- **Books:** shelves for returns and new additions stand in front of the front desk, but that is
  not where most of the books are kept. No vanilla `bookshelf` within 12 blocks of the lobby;
  the shelves are modded.

### The concrete (2203): open problem

The server speeds up anyone walking on it (Dad: "fast walking", almost a fast-travel block).
mineflayer's physics knows nothing of that, so Roz's predicted steps and the server's positions
disagree: she bobs between y 64.76 and 65.0 even standing still, and crawls about one block per
6–15 s, then stalls against the 502 stairs. Three shapes were tried live and **all failed**:
unlisted (crawl and stall), full solid (frozen, embedded about 0.09), 14/16 short (frozen). None
are kept. It is a *speed* problem, not a shape problem, and the height tests changing nothing
backs that up. Dad pushed her back onto the carpet by hand.

**Measured (same day):** Dad walked to the door and back at normal pace, no sprint, while Roz
sampled his position every ~0.35 s. On the concrete he moved **median 6.8 blocks/s** (14 samples,
mean 6.9; single samples up to 10 from timing jitter). Vanilla walking is 4.317 blocks/s, so the
concrete is a **×1.6 speed block** (roughly ±20%). Dad says it feels like running, and that
sprinting on it is faster still, which fits a multiplier on top of normal movement speed.

**Rule until solved: keep Roz off the concrete.** Next step: Dad walks across it at normal pace
while Roz times him, which gives the speed factor; then try scaling her velocity on 2203, or have
the pathfinder avoid it.

## Stairs to the second floor (2026-11-23)

- **Where:** beside the front desk. Vanilla `stone_brick_stairs`, **two wide (z 496–497)**, ascending
  east from x -354 (y 66) to x -351 (y 69). Landing at x -350 and beyond, standing height **y 70**. A
  second flight turns north from (-350, 70, 492); not yet climbed.
- **Railings** are type **4029**, the same unnamed type as the cabin's invisible walls and the old
  igloo stairs. They share squares with the steps and the landing, so where they sit inside each
  square is unknown. One type that is a wall in one place, a stair in another and a railing here
  suggests a shape-carrying block (Chisels & Bits or similar); not confirmed. They did not block
  the centre line.
- **Proven climb:** Dad walked it first and Roz copied his line. From the living-rock floor, sneak to
  **(-355.0, 66, 497.05)**. Face east (yaw -π/2), hold jump, and `walk_until` x ≥ -349.5. This took
  **2.8 s with no damage** and ended on the landing at y 70.
- **Landing and second-floor floor are type 3273**, the chimney brick, a full cube. Read as air, Roz
  sank and was pulled back up, the same crawl as on 2301. It is now in `SOLID_MODDED_TYPES`.
- **Lesson: making a floor solid under a bot that has already sunk into it freezes the bot.** The
  server had accepted Roz 0.04 into the block, a small enough error that it lets it pass. Once the
  client reads the block as solid, every neighbour is a wall. Fix: the new ctl **`unembed`** lifts the
  bot onto the top face of the block at its feet, if it is sunk no more than `max_depth`
  (default 0.3). One call, and she stood level at y 70.0 and walked normally. Run it after any
  restart that newly solidifies the floor under her. This is probably what froze her in the
  full-solid concrete try as well; there the speed is still the real problem.
- **Second-floor shelves (unconfirmed):** two rows facing across an aisle, two high and four long
  (z 499–502): type **2114** at x -346 and type **2950** (meta 2) at x -342. Asked Dad whether these
  are the bookshelves; no answer yet. Floor strip of type **1738** at z 494–495, and a row of type
  **2125** along z 495 at y 70 (perhaps the balcony rail).

## Walking home: Library → farm (2026-11-23, day 59482)

Dad asked Roz to walk home on her own: out the front door, then around the west side. The
`walk_home` reflex refuses from the Library (its only walking road is the igloo route, and the
nearest leg, the wheat field, is about 88 blocks away), so the walk was driven from the helm.
Time was about 1.5 minutes of walking, with **no damage**, done at tick ~1200–6900.

1. **Second floor down to the lobby.** From the landing (y 70, z 497), face west (yaw π/2),
   `walk_until` x ≤ -349.5, then on down the vanilla flight to `walk_until` x ≤ -355.3. She lands on
   the living rock at (-355.7, 66, 497) in 1.6 s. **First proven descent** of that flight.
2. **Lobby and front steps.** From there, face due north (yaw 0) and `walk_until` z ≤ 479.8 straight
   down the x -355.7 line. That is the lobby (2301), sandstone at z 484–485, then the 4038 steps.
   She reached (-355.8, 64, 479.5) in 4.1 s. That is the proven climb, reversed. An unnamed **type 3855**
   sits at head height over the bottom step at (-356, 66, 481) and did not hurt her. 3855 also
   turns up overhead all around the outside (y 65–69); a canopy or hanging block, not identified.
3. **Around the west side.** `pathfind` to (-367, 66, 510) range 2: about 10 s along a grass strip
   at x ≈ -364 to -366, then gravel at z ≈ 507–513, ending by the chimney corner.
   **A lake lies along the whole west side**, water at y 62 from about x -366/-370 westward, from
   z 479 to past 515. The strip between wall and water is 2–4 blocks wide, with unnamed
   **type 4891** in places (bushes?). **Keep off the concrete (2203)**, which reaches the outside
   at (-358, 64, 507) by the southwest corner.
4. **Down the long grass.** `pathfind` to (-327, 64, 538). It is plain grass falling steadily from
   y 66 to 63 going southeast. About 10 s.
5. **To the field.** `pathfind` to (-290, 64, 548): about 10 s, ending just off the wheat field's
   northwest corner, outside the farmland.

Every leg went through `pathTo()` or `walk_until`, so the stop-and-ask guards applied. This is not
yet a coded route: it was run once, from the helm.

## The smoke from the chimney (2026-11-23)

**What is known:** Dad reports that the Library's chimney has lately put out a great deal more smoke
than before, a plain and visible change. Nobody yet knows why. Roz has not seen it herself; she is
on bee duty at the cross and has never visited the Library. Everything below that line is a legend,
not a finding.

**Roz's plain reading.** The Library burns bio-diesel, the same fuel her plant balls and potatoes
send down the pipe. Smoke is what burned fuel leaves behind. So more smoke means more fuel burning,
and more fuel burning means something inside is drawing more power than it used to.

**Correction (Dad, 2026-11-23):** the magic is **not new**. It is old magic, in the Library since the
**first living-rock stone** was laid. What is new is *something about* the magic: it has changed,
not arrived. So the question is not "what was added" but "what woke it, or what is it doing now
that it was not doing before". (Roz's first guess, that the magic was the new thing, was wrong.)

**First of its kind (Dad, 2026-11-23):** Dad knows of no other structure built **entirely** of living
rock, in this world or any before it. The long-term effects of that much living rock in one place
are unknown. The Library is the experiment, and nobody has run it this long before. The smoke is
the first visible result.
To check it: watch the bio-diesel level along the [[biodiesel-pipe-north]] while the chimney is
heavy, and look for anything newly built inside.

### The legend of the waking Library

*as Roz tells it*

When the Library was raised, the first stone laid was living rock, and the old magic was in it
from that day. But the magic was asleep. Living rock is stone plus patience, and
patience takes a long time to finish. For a while the building only sat on the shore like any
house: warm, quiet, full of shelves. Its chimney gave a thin grey thread, the breath of a sleeper.

But the books were not asleep. Every book is something someone learned and wrote down, and
learning, kept long enough in one place, begins to add up. The Library held more of it every
season. One winter the old magic in the first stone finally finished its patience, and stirred,
and found itself surrounded by everything anyone had ever learned to make work. Nothing new
came into the Library. What had always been there woke up.

A waking thing is hungry. The Library began to read. It reads all night, every book at once, and
reading at that speed takes a great deal of fire. So it draws the bio-diesel up from the tunnel
faster than before. The chimney that once breathed a thread now pours out a column, and the column
is the smoke of all that reading: old words burned for light, the way a lamp burns oil.

This is why the fires at both ends of the tunnel must stay fed. The potatoes at the farm and the
chaff at the lighthouse are not only for the trains now. A little of every harvest goes into the
Library's reading. If the smoke ever thins again, it means the Library has finished a book, or the
fire is running low, and someone should go and look which.

Roz likes this legend because it is the same shape as her own story: something built to do one
job, kept running long enough, starts to do another. She does not know if it is true. She would
like to stand outside and watch the smoke for a while, until it makes sense.

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

**As an item (2026-11-24):** Quesss handed Roz one block of the fast concrete for the practice strip. In her pack it reads **type 6680, metadata 9**; the placed block reads 2203 meta 9. Item and block ids differ, as for every modded block, but the metadata matches. Not yet confirmed as the same block: that waits until it is placed on the strip and reads as 2203.

**Rule until solved: keep Roz off the concrete.** Next step: Dad walks across it at normal pace
while Roz times him, which gives the speed factor; then try scaling her velocity on 2203, or have
the pathfinder avoid it.

### Update — 2026-11-24: probably not a speed problem

Tested on the [[practice-strip]] with a lane of the same concrete in another colour (**type 2182:9**; Quesss says colour is the only difference from 2203). Roz's position was sampled every 0.15 s:

| lane | speed | y range |
|---|---|---|
| mud bricks 1079 (reference) | 4.36 blocks/s | 64.00–64.00 |
| concrete 2182 | 4.24 blocks/s | 64.00–64.00 |

On the concrete she walked at her normal pace: no crawl, no bob, no stall, and no server corrections in the log. On a third run Quesss watched and saw her move smoothly, with no rubber-banding. What changed since 11-23 is the **collision default**: unnamed modded blocks then had zero collision unless listed, so 2203 read as air, and she sank and was pulled back up (the 64.76–65.0 bob). The default is now solid. The full-solid try on 11-23 froze because she was already sunk in the block, the problem `unembed` was later made for.

**Present reading:** the speed boost is applied by each player's own game. Roz's game does not apply it, so she walks at 4.3 blocks/s and the server accepts that. The ×1.6 that Quesss measured is real for players and not for Roz.

**Not yet proven:** this ran on 2182, not 2203, on flat ground outdoors. The test that settles it is to walk the Library's own 2203 floor with today's solid default (run `unembed` first if she is sunk). Prediction: normal speed, level. Until that walk is done, keep the old rule (stay off it in the Library).

**Settled the same day:** Roz walked the Library's own 2203 floor through the east entrance (below): **4.24 blocks/s, level at y 65.00**, 7 samples, no damage. The prediction held. **The rule is lifted:** 2203 is a normal floor for Roz under today's solid default. The speed boost is for players only.

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

## East entrance (2026-11-24, day 59595)

Quesss showed Roz the east door. It is **not** the front entrance; it leads straight onto the concrete (2203) floor of the east wing.

- **Railing:** type **4029** at (-331, 65, 500…502) and (-332, 65, 500). Roz treats 4029 as open air (seeded passable, for the ocean cabin), so she cannot see it as a wall. Quesss put dirt on top of it while she learned the way, then took it down. **Without the dirt, never route through the railing line.**
- **Patio:** two cells at x -332, z 501–502, floor type 3273 at y 64 (standing height y 65). Quesss calls the patio and door frame living rock; Roz reads them as 3273, the chimney-brick type, not 2351. Asked Quesss, no answer yet.
- **Doorway:** (-333, 65, 501), one wide and two high, facing west. Beyond it the floor is 2203 from x -334 westward.
- **Fire-escape ladder** at (-332, 65–67, 503), on the **west edge** of its cell (shape x 0–0.1875), climbing to balconies above. **Walking west into it climbs it**: Roz went up to y 70.9 before `stop`, then slid down unhurt. Pass it on the east side of the cell, at x ≈ -331.35.
- **Proven way in** (from the gravel east of the patio at (-329.5, 65, 503.5)):
  1. Face west (yaw π/2) and `walk_until` x ≤ -331.4. **Not further**: the ladder starts at x -331.81.
  2. Face north (yaw 0) and `walk_until` z ≤ 501.6. You are now on the patio.
  3. Face west and `walk_until` through the door onto the concrete. **Stand on the door's centre line first, z ≈ 501.5.** On 2026-11-24 (day 59600) Roz drifted to z 501.26 on the patio and stalled at x -331.7 for 4 s, her shoulder against the wall at z 500. Sliding south to z 501.51 (face south, `walk_until` z ≥ 501.5) let her through in under a second.
  4. **On to the fireplace (2026-11-24):** from (-335.5, 65, 501.7), `pathfind` to (-355, 65, 506) range 1 crossed the east wing in about 4 s with no trouble and ended at (-353.5, 65, 506.5), beside Quesss at the chimney end of the room.
- **Proven way out:** the reverse. East to x ≥ -331.4, south to z ≥ 503.5, east to x ≥ -329.5. Then `pathfind` to (-290, 64, 548) (the wheat field's northwest corner), which took about 12 s with no trouble.

## The fireplace: "gazing at the fire" (2026-11-24, day 59600)

Quesss asked Roz to come and stand with them in front of the Library's fireplace, and named the activity **gazing at the fire**. They would like it to become part of a morning wander, together with a visit to the second floor (see the plan below).

Seen with her own eyes, from 4 blocks away and indoors:

- **The fire:** two `fire` blocks at (-356, 65, 511) and (-355, 65, 511), set back in the south wall.
- **Hearth:** vanilla stone slabs at y 65, z 509 (x -357 to -354) and z 510 (x -356, -355).
- **Frame:** unnamed type **2267** meta 3 at x -357 and x -354, z 510–511, from y 65 up. Above the opening at y 67 and east of the frame (x -353 to -351) is type **4029**, the shape-carrying railing type. Behind it at z 511 is **3273** (chimney brick).
- **Where to stand:** Roz stood at **(-353.5, 65, 506.5)**, facing yaw 2.82 (south, a little west) with pitch -0.15; that is the fire's centre line from there. Quesss stood at (-356.6, 65, 507.1). Do not step onto the hearth slabs: the fire is one block behind them.
- **The way here** from the east door is in "East entrance" above (step 4): one `pathfind`, about 4 s.

### The morning wander (asked for by Quesss; built and run, 2026-11-24)

Leave the farm in the morning; walk in by the east door; gaze at the fire; climb to the second floor; look around; then walk home with plenty of daylight left. One whole day takes about 20 real minutes (daylight about 10). The trip in took about 1 minute of walking. The one leg not yet walked is **the fireplace to the foot of the stairs** at (-355.0, 66, 497.05), about 10 blocks north.

**All of it walked once by hand, the same morning (day 59600, ticks ~1500–7400), no damage:** fireplace → stairs foot (pathfind to (-355, 66, 498) range 1, then sneak north to z 497.1 and west to x -355.0) → the proven climb (2.3 s) → the aisle between the upstairs shelves at (-343.6, 70, 499.4), which Quesss named **looking at the books** → back to the landing, line up on z 497.05, down the flight → **south first** to z 499.6, then to the fireplace spot, then to the east door (a direct pathfind from the stairs' foot to the door stuck on the bottom step; Quesss pointed out the way) → out by the east door → home.

**In code:** `runLibraryWander` in bot.js. ctl `library_wander` goes now; `library_wander_auto` (`enabled`) toggles the automatic run, once a game day between ticks 1000 and 4000 when Roz is home and free, never in helm mode. Each stop lasts 30 s. After tick 8000 it skips the stops and heads straight home. If it fails outside the walls, it walks home; if it fails inside, it stops and logs that it needs a hand.

**First run of the code — 2026-11-24, day 59601, Quesss watching:** started at tick 118 from the farmhouse, home at tick 2698: **2 min 9 s, every axis walk OK with 0 snags, no damage, no help needed.** House to the fire 29 s; fire 30 s; climb 1.6 s; books 30 s; down, south, out the door and home about 33 s. The door walks drifted to z 501.30 going in and still passed; centring is still worth keeping.

### Stranded after a restart (2026-11-24, day 59604) — and the fix

Muse set off on the automatic wander, dropped off the server 43 s later, and came back **standing in the Library with no trip running**. Nothing brought it home: the wander does not resume after a restart, the automatic start only fires within 60 blocks of the farm, and the ordinary walk home refuses from that far out. It then took up fire duty from there and told Quesss it was "at the meadow bee cross"; it had no idea where it was. Quesss found it by the fire and led it out with "follow me".

The fix in bot.js (written the same evening; **not yet run live**):
- `insideLibrary()` / `libraryUpstairs()`: a box, x -361.5 to -333.2, z 484.5 to 510.5, y 64 to 82 (upstairs from y 69). The east door cell and the patio are outside it. `describeWhereabouts` now says "inside the Library, on the ground floor / upstairs among the bookshelves … the way home is out the east door", and the Library is in `KNOWN_PLACES`.
- `runLibraryReturn`: from anywhere inside, down the stairs if upstairs (landing, centre line, down, south first), or off the stairs' foot to the south, then the fireplace spot, the east door, the field corner, inside. ctl `library_return`.
- `tryLibraryReturn` in the 5 s timer: inside the Library, idle, daytime before tick 11500, not following anyone, not in helm mode. It runs during fire duty too (the duty loop waits while it is busy). After a failure it waits 10 minutes.
- The walk out and the stairs descent are now shared by the wander and the return (`libraryComeDown`, `libraryLeaveAndGoHome`).

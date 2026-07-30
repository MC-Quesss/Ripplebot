---
type: procedure
name: farm_to_igloo
confirmed: true
---

# Route: Farm → Igloo

**Status: provisional.** Built from three traced walks on 2026-07-29, all of them
with Roz in follow mode behind [[../bots/operator|Quesss]]. The bot has **not**
yet walked any of it under her own power — see Open Questions.

## Canonical form (user, 2026-07-29)

The route **always starts from the center of the wheat field and goes to the roof
garden first.** It is three stages, not one:

| Stage | From | To | Notes |
|---|---|---|---|
| 1 | **[[../places/wheat-field]] center** (-283, 64, 562) | **[[../places/rooftop-garden|roof]]** (y=70) | climb the ramp east of the field |
| 2 | roof | cold biome | the long due-south corridor |
| 3 | final approach | **[[../places/igloo]]** (-330.5, 63, 790.5) | overshoot south, hook west, drop onto lake ice |

Stage 1 is why the field is the start and not the front door: the roof is reached
by a **terrain ramp due east of the field**, not from inside the house. Run 1
caught the climb as its only elevation step — y 67→69 at **(-260.1, 563.3)** —
and z=563 is the field's own latitude, which is the tell. Roof descent southbound
was logged at y 69→67, (-266.5, 580.5).

The house front door is not part of this route at all, which conveniently avoids
the modded-door traversal problem entirely.

## Measurements

| Run | Direction | Straight-line | Walked | Wander | Time | Notes |
|---|---|---|---|---|---|---|
| 1 | south (partial) | 179 | 233 | 1.30x | ~72s | turned back at [[../places/snow-line-midway]] |
| 2 | south (full) | 228 | 344 | 1.51x | ~141s | user's "long way"; reached igloo |
| 3 | north (full-ish) | 151 | 179 | **1.18x** | ~105s | cleanest line |
| 4 | south (full, canonical) | 235 | 393 | 1.67x | ~240s | **first daylight run**; field→roof→igloo; east-swing lane |
| 5 | north (full, canonical) | 235 | 375 | 1.59x | ~242s | igloo→field; hill lane; confirmed both ramps |

Five runs, ~1720 blocks of follow-walking, **zero deaths, zero damage, zero
position jumps >12 blocks/sec**.

## Waypoint chain (consensus of 5 runs)

Aim for the **waists** — the points where every run converges. Between waists the
lane choice barely matters, so don't over-constrain it.

| # | Waypoint | Coords | Confidence |
|---|---|---|---|
| 1 | wheat field center (start) | (-283, 64, 561) | canonical start |
| 1b | east leg, **north of the pen** | (-274, 64, 561) | hold z ≤ 570; pen is z 574–578 |
| 1c | ramp approach | (-267, 64, 563) | runs 4 & 5 |
| 2 | **ramp foot** | (-264.5, 65, 562.4) | **runs 4 & 5, ~1 block apart, opposite directions** |
| 2b | mid-ramp | (-262.5, 68, 563.6) | runs 4 & 5 |
| 3 | roof deck | (-264, 70, 572) | trailhead proper |
| 4 | **waist A** | (-265, ~69, 580) | **all 5 runs within 2 blocks** |
| 5 | mid drift | (-252, ~68, 630) | 4 runs within 6 |
| 6 | fork — pick the hill lane | (-264, ~69, 670) | runs 1, 3, 5 |
| 7 | **waist B — the sand** | (-265, 67, 704) | **all 5 runs within 4 blocks** |
| 8 | westward turn | (-284, ~69, 725) | runs 2, 3, 5 |
| 9 | west run | (-295, ~68, 765) | runs 4, 5 |
| 10 | hook west | (-320, ~69, 785) | runs 2, 4 |
| 11 | **lake-ice ramp** | **(-328.4, 802)** | **runs 2, 4, 5 — x within 0.4 blocks** |
| 12 | arrival, outside the igloo | (-330, 63, 790) | runs 2, 4 |

Steady pace throughout: **2.2–2.4 blocks/sec** following. Total transit is
roughly **2–2.5 minutes** each way.

## Shape of the route

An **L, not a diagonal**: a long due-south run holding x ≈ -250..-270 while z
climbs 573 → ~790, then a westward hook at the end. Do not try to cut the
diagonal — no run ever did, and the terrain is why.

### Consensus corridor (where runs agree)

| Latitude (z) | Corridor x | Confidence |
|---|---|---|
| 573–590 | -264 .. -267 | high (all runs within 2 blocks) |
| 606 | -258 .. -266 | medium |
| 635–655 | -249 .. -263 | low — wide, and forgiving (see hill below) |
| 677 | -264 .. -266 | high (runs 1 and 3 agree; run 2 was the long way) |
| 704 | -265 .. -266 | **highest — 1 block across opposite directions** |

### The middle third is a FORK, not a wide corridor (4 runs, 2026-07-29)

Earlier passes described z 635–683 as "one wide corridor, ~14 blocks of spread."
That was wrong — the spread is **bimodal**, two distinct lanes with a gap and
nothing in between:

| Lane | x at z 650–690 | Runs |
|---|---|---|
| **over the hill** | -259 .. -266 | **1, 3, 5** |
| **east swing** | -244 .. -255 | 2, 4 |

Widest separation is **19 blocks at z=670**. Prefer the hill lane: it has three
runs behind it, it is shorter, and run 3 proved the slope is gradual.

A **second divergence** sits at z 710–780: four runs run west along x ≈ -283..-297
while run 4 alone held x ≈ -264..-274. Treat the western line as the route.

### Analysis caveat — don't read the z-bins past z 770

The run comparison bins samples by z, which assumes the route is z-dominant. In
the final approach the path runs mostly **west**, so a long east-west stretch
collapses into one z bin and different sampling phases look like disagreement.
The apparent "forks" at z 780–810 are artifacts of that, not real branches. Bin
by x if the hook ever needs resolving.

Both reach the igloo. **Never take the mean of the two** — the midpoint is the
one line nobody walked. Pick a lane and hold it. The east swing is longer; the
hill crossing is shorter and proven gradual (see below).

### Hard waypoints (repeat to under 1.5 blocks across runs)

| Waypoint | Coords | Evidence |
|---|---|---|
| **Lake-ice descent** | y 67→64 at **(-328.5, 801.7)** | runs 2 & 4 agree to **0.2 blocks** |
| Arrival standing spot | (-330, 63, 790) | runs 2 & 4, 1.4 blocks apart |
| Roof descent (southbound) | y ~69→67 at **(-266.4, 579.8)** | runs 2 & 4, 1.4 blocks apart |
| Halfway sand | (-266, 67, 704) | runs 1 & 3, opposite directions, 1.5 blocks |

### Stage 1: the northern way round the sheep pen (required)

**The roof start is mandatory, not scenic** (user, 2026-07-29): the ground-level
alternative means threading the fences around the sheep, which is worse. The
route goes **north of the pen**, and that constraint is measurable:

- **[[../places/south-fenced-area|sheep pen]]**: spruce fence, x **-282..-274**,
  z **574..578**, single door at (-278, 574).
- **The traverse runs at z ≈ 559–563**, i.e. ~11 blocks north of the fence line.
  Hold z ≤ 570 while moving east/west between the field and the ramp and the pen
  never comes into play.

Traced fine-grained (1 Hz) in both directions, runs 4 and 5 — they mirror
each other:

| Step | Southbound (run 4) | Northbound (run 5) |
|---|---|---|
| field | (-282.5, 64, 559.5) | (-282.5, 64, 560.3) |
| east/west leg | (-277, 64, 560) → (-274, 64, 562.5) | (-278, 64, 559.5) → (-274, 64, 560) |
| approach ramp | (-270, 64, 562.5) → (-267, 64, 563.5) | (-271, 64, 562.5) |
| **ramp foot** | **(-264.2, 66.2, 562.5)** | **(-265.2, 65.0, 562.3)** |
| mid-ramp | (-262.5, 68.2, 563.8) | (-262.5, 67.5, 563.5) |
| upper ramp | (-262.5, 69.0, 567.1) | (-262.1, 69.0, 566.3) |
| **roof deck** | **(-264.0, 70.2, 571.6)** | (-263.5, 69.0, 570.1) |
| roof, south end | (-265.5, 70.0, 575.5) | (-265.5, 70.0, 574.5) |
| off the roof (south) | y 70→68 at (-266.2, 579.1) | — |

The climb is **y 64 → 70 over ~9 blocks of z**, at x ≈ -262.5..-265, ascending
south-southeast onto the roof deck. It is a staircase, so individual runs only
log the rungs steep enough to clear 2 blocks in a second — run 1 caught a
different rung (y 67→69 at (-260.1, 563.3)) than run 4 (y 64→66).

### The hill at z 658–678 is not an obstacle

A snow-covered rise at x -276..-256, z 658..678. Snow layers span y=66..79, but
the **distribution matters**: y69 holds 120 blocks while y72–y79 hold only a few
each — the high peak is a thin spire, and the broad feature is a **plateau at
y=69**. Run 3 crossed its footprint at x ≈ -266 with **zero elevation steps of
2+ blocks**, so the slope is gradual and walkable.

Both work: **over** the plateau (runs 1, 3) or **around the east flank** (run 2).
A small pond sits east of it at (-259, 67, 675).

**Do not average the traces here.** Runs 1/3 and run 2 took opposite sides of
this hill; the mean of the two is a line nobody walked.

## Landmarks (detectable, not just coordinates)

Preferred to raw coordinates because they survive navigational drift — the bot
can confirm them with `find_blocks` / `block_at`:

1. **Sand at (-266, 67, 704)** — halfway. Runs 1 and 3 passed within 1.5 blocks
   of each other here, in opposite directions, on different nights. Sand sits
   between grass to the north and snow to the south.
2. **[[../places/snow-line-midway]] (-281, 68, 750)** — continuous `snow_layer`
   at y=68 over grass, in all directions out to 24 blocks. The
   "am I in the cold biome yet?" test.
3. **Frozen lake `ice` at y=61–62** — arrival. Ground block underfoot becomes
   `ice`.

## Final approach (from run 2)

- south to z ≈ 812 around x ≈ -290
- west to x ≈ -311, then x ≈ -331
- **3-block descent, y 67 → 64, at (-328.4, 801.7)** onto the lake ice
- arrive (-330.5, 63, 790.5); igloo snow floor immediately southeast

## Hazards

Two hostiles in ~800 blocks of night walking, both in the southern third, both
eliminated by the hostile watchdog in **2 seconds each, zero damage taken**:

- creeper, outbound at z ≈ 710
- skeleton, at (-286, 69, 729) near the snow line

Follow mode survives nightfall: [[../../bot.js]] `tryAutoSleep` stands down while
`followTarget` is set, so the bot will not abandon a walk to run home to bed. It
only remarks about finding somewhere safe.

Across all three runs: **zero deaths, zero damage, zero position jumps >12
blocks/sec** — the follow genuinely walks the terrain rather than rubber-banding.

## COMPLETE SOLO WALK — 19/19 legs, 76 seconds (2026-07-30, night)

**Roz walked the whole route alone**, at night, starting from inside the house
straight out of bed. Every leg reached. `confirmed: true` for the route itself.

| leg | note | off | ms |
|---|---|---|---|
| 1 | wheat field center | 2.5 | 2256 |
| 2 | east leg, north of the pen | 1.8 | 1505 |
| 3 | ramp approach | 1.8 | 1504 |
| 4 | ramp foot | 1.4 | 754 |
| 5 | mid-ramp | 1.5 | 1059 |
| 6 | roof deck | 1.2 | 2263 |
| 7 | **roof south edge** | 1.6 | 754 |
| 8 | waist A | 2.6 | 904 |
| 9 | corridor | 3.5 | 4663 |
| 10 | mid drift | 4.2 | 6626 |
| 11 | fork — hill lane | 4.8 | 9344 |
| 12 | **waist B — the sand** | **2.5** | 8000 |
| 13 | westward turn | 3.5 | 5575 |
| 14 | west run (ex-beehive) | 4.2 | 10093 |
| 15 | south onto the z~808 lane | 3.5 | 9797 |
| 16 | west along the lane | 4.7 | 3620 |
| 17 | lane end | 4.0 | 2864 |
| 18 | **lake-ice ramp** | **0.8** | 2562 |
| 19 | arrival — outside the igloo | 2.6 | 3167 |

Notes on the numbers:

- **76 seconds solo vs ~141 s following** a human. The bot is faster alone.
- **The ice ramp was the most accurate arrival of the walk — 0.8 blocks.** That
  waypoint came from three follow-traces agreeing to 0.4 blocks; precision in
  equals precision out.
- **The waist correction held a third time**: 4.8 → 2.5 into waist B. Drift
  accumulates on open legs and is absorbed at the pinch points, every run.
- **The roof south edge waypoint paid for itself twice**: it kept her on the
  garden roof instead of around the house *and* cut the waist-A leg from ~1660 ms
  to 904 ms.
- Leg 10 has now returned 4.2 blocks / 6626 ms on three consecutive runs.
- Zero deaths, zero damage, no hop-assist firings anywhere on the route.

### RETURN TRIP VERIFIED — 19/19 reversed, roof crossed, pen avoided (2026-07-30)

`{"action":"walk_route","args":{"reverse":true}}` from the igloo, traced at 1 Hz
(145 samples) so the path could be audited rather than trusted:

```
ROOF CROSSING (y >= 69.5):
  00:27:21  (-263.5, 70.2, 577.2)   roof south edge
  00:27:22  (-262.5, 69.9, 572.4)   roof deck

PEN FOOTPRINT (x -282..-274, z 574..578):  0 samples — never entered
NEAR THE LIGHT BLOCK (-273, 68, 574):      0 samples — stayed clear
```

All 19 legs reached, ~74 seconds, ending at wheat field center. Tightest arrival
was the **ramp foot at 0.6 blocks**. The bot then walked itself indoors and slept
normally — correct, because back inside the 60-block home radius the ordinary
home behaviours resume.

This is the direct answer to "stop shortcutting on the way back": the roof south
edge waypoint is what makes the return cross the garden instead of skirting the
house through the lights.

### Aftermath (FIXED 2026-07-30): the bot used to undo the journey

3.5 s after the task ended, `[idle-wander] heading inside` fired and began
manually walking her the 235 blocks home from the igloo:

```
00:18:15 [task] ended: walk_route
00:18:19 [idle-wander] heading inside
00:18:38 [go-inside] not at outside_orientation (dx=45.28, dz=170.3)
```

**Fixed**: `tryIdleWander()` now returns early beyond a **60-block home radius**
(`IDLE_WANDER_HOME_RADIUS`, measured from `HOUSE_CENTER`). Every activity it can
pick — `inside`, `field`, `pen`, `furnace` — is home-local, and `runGoInside()`
falls back to *manual* walking when the pathfinder cannot plan, which from far
away is an unmanaged cross-map trek. One flaw, two symptoms: it abandoned the
destination *and* it shortcut the way home through the lights.

Verified live: standing at the igloo, the timer logged

```
[idle-wander] 229b from home — standing by (idle wander is home-local; use walk_route to come back)
```

twice across timer cycles, and she stayed put until told to walk back.

## Autonomous walking — implemented 2026-07-29, stage 1 verified

`walk_route` walks a route leg by leg (`ROUTES` + `runWalkRoute` in `bot.js`).
Short legs keep every pathfinder goal inside loaded chunks, which is the whole
reason a single 235-block `pathfind` cannot work here.

```bash
./bot-ctl '{"action":"routes"}'                              # list routes
./bot-ctl '{"action":"walk_route","args":{"legs":6}}'         # stage 1 only
./bot-ctl '{"action":"walk_route"}'                           # the whole route
./bot-ctl '{"action":"walk_route","args":{"reverse":true}}'    # igloo → farm
```

Hop assist was also given a **scoped opt-in** (`hopAssistScope`) so it can run
without a follow; `runWalkRoute` holds it for the duration. It is deliberately
not ungated globally — jump pulses during farm tasks or door traversals are how
this bot has died before.

### First solo attempt, 2026-07-30 dawn: 12 of 18 legs

Started from **inside the house** straight out of bed (the exit-first branch ran
and worked). Reached legs 1–12 unaided, then failed in the western approach.

| leg | note | off | time |
|---|---|---|---|
| 1–6 | field → roof deck | 1.3–2.8b | ~10s total |
| 7 | waist A | 3.0b | 1.7s |
| 8 | corridor | 3.7b | 4.8s |
| 9 | mid drift | 4.2b | 6.6s |
| 10 | fork — hill lane | 5.2b | 9.2s |
| 11 | **waist B — the sand** | **2.5b** | 8.3s |
| 12 | westward turn | 3.5b | 5.6s |
| 13 | west run | **MISSED 9.3b** | 12.2s |
| 14 | south onto the z~808 lane | **MISSED 47.5b** | 8.8s |

Stopped cleanly at leg 14 on the >12-block "lost" guard.

**The waist model is confirmed.** Drift grows across the open legs (3.0 → 3.7 →
4.2 → 5.2 blocks) and then *shrinks to 2.5* at waist B. Tight targets at the
pinch points pull accumulated error back out; the loose middle does not compound.

**The chunk theory holds.** Twelve consecutive legs, ~150 blocks, no single
pathfind longer than a leg, zero position jumps. Short legs work where one long
goal cannot.

### Rule: both directions cross the roof — never shortcut around the house

**User, 2026-07-30.** Coming home, the route must go **over the roof garden and
down the ramp to the field from the north**. Cutting the corner from waist A
straight toward the house strands the bot on the **modded light blocks** by the
sheep pen or inside the pen itself.

Confirmed physically: after a failed return the bot was found standing on an
empty-name modded block, **type 4029 at (-273, 68, 574)** — y=68, on the pen's
doorstep. That is the light it gets stuck on.

Cause was leg spacing, not the pathfinder being wrong: an 8-block gap between the
roof deck (-264, 70, 572) and waist A (-265, 69, 580) left nothing forcing the
path *over* the roof, so it was free to route around the house. Fixed by adding a
**load-bearing waypoint at the roof south edge, (-265, 70, 575)** — taken from
the traces, where the y 70→68 descent happens. Do not remove it; it is the only
thing keeping both directions on the roof. Route is now 19 legs.

### Blocker: story time hijacked an active walk (fixed 2026-07-30)

Second solo attempt died at leg 13 — **180 blocks off** — and not because of the
beehive. Private said "let's head inside" and Roz's story-time handler began
walking her home **from 164 blocks out, mid-route**:

```
00:13:22 [chat] <Private> Let's head inside, everyone — the sun is going down.
00:13:22 [story-time] Private called everyone inside — heading in
00:13:23 [go-inside] not at outside_orientation (dx=13.51, dy=6, dz=163.97)
```

`go-inside` then fought the route's pathfinding for 40 seconds and dragged her
~150 blocks north. The handler guarded on `storyTimeActive` and `goInsideBusy`
but **not `taskBusy()`** — so any crewmate's chat line could hijack any long
task from any distance. Now guarded the same way `tryAutoSleep` is; it logs
`ignoring, <task> is running` and defers.

**The beehive fix at (-291, 68, 759) is therefore still untested** — leg 13 has
never had a clean run.

### Blocker: the stall point at (-291, 68, 759) — beehive, removed 2026-07-30

Identified by the user as a **modded beehive** and removed. This is exactly the
case hop assist was written for: empty-name modded block, pathfinder penalizes it
to Infinity and pushes against it instead of stepping up. Three assist pulses at
the identical coordinate could not clear it.

Legs 13–14 failed at one spot. Hop assist fired **three times at the identical
coordinate** — (-291, 68, 759) — and the bot never got past it:

```
[hop-assist] hop assist (walk_route:farm_to_igloo): stalled 1.2s at -291, 68, 759 — pulsing jump
```

Also **1 HP of damage** around the same moment (`[hurt] HP now 19/20`) — the only
damage in the entire two-session effort, and unexplained. Fall damage from a
pulse, or something hit her.

This is the first confirmed firing of hop assist **outside follow mode**, and it
happened exactly where an audit of the follow-walks predicted it would (the
western cluster at (-297, 68, 782), (-285, 69, 769), (-326, 67, 809)) — but a
400ms jump pulse does not clear this particular obstacle.

Open: **what block is at (-291, 68, 759)?** Needs coordinate probes with the bot
nearby; `find_blocks` will likely report it empty-name like the other modded
blockers. Until it is identified, legs 13–14 are the weak link and the route
should be considered **farm → waist B (proven solo)** plus a hand-led final
approach.

### Aftermath gotcha: idle wander hijacks an aborted walk

The moment `walk_route` returned, `[idle-wander] heading field` fired and started
walking the bot home from 200 blocks out — in 12-second `pathTo` bites. Harmless
in effect, but `runIdleWanderToField` logs `standing in wheat field at <pos>`
**unconditionally after the timeout**, so bot.log recorded arrival at
(-271, 69, 719) — about 150 blocks from the field. Do not trust that log line.

### Stage 1 result (2026-07-29): 6/6 legs in 7.6 seconds, and the assist never fired

| leg | note | off | time |
|---|---|---|---|
| 1 | wheat field center | 2.5b | 1ms |
| 2 | east leg, north of the pen | 1.6b | 1.7s |
| 3 | ramp approach | 1.6b | 1.5s |
| 4 | ramp foot | 1.7b | 0.8s |
| 5 | mid-ramp | 1.6b | 1.1s |
| 6 | roof deck | 1.2b | 2.3s |

**Correction to an earlier claim in this note.** It previously said the roof
"has only ever been climbed with that assist doing the work" and that this was
the blocker for autonomy. **That was wrong.** An audit of every hop-assist event
in the 2026-07-29 session shows all of them in the *western final approach* —
(-326, 67, 809), (-285, 69, 769), (-297, 68, 782) — plus two off-route to the
northwest. **None at the ramp.** The earlier claim welded one log line and one
first-ever roof visit into a causal story. The ramp is ordinary walkable
terrain and the pathfinder climbs it unaided.

Where hop assist *does* earn its place on this route is the western lane
(x -285..-326), where it fired four times during the follow-walks.

Caveat on leg 6: `reached` is generous. The bot finished on grass at
(-264, 68, 571) — feet at y=69, **one level below the y=70 roof deck** — and
both `pathTo`'s y tolerance (±1.5) and the walker's `off <= range + 1.5` test
accepted it. Good enough to continue from, but it is not standing on the deck.

## Open Questions

- **Can the bot walk this alone?** Untested. Working theory: a single 228-block
  `pathfind` will fail because the server only sends chunks near the player, so
  A* cannot see terrain that isn't loaded — but a chain of ~25-block legs down
  the corridor should work. Test stage 2 first, from a roof start reached by
  following, so the chunk question is isolated from the climb question.
- ~~Where exactly does the roof descent happen?~~ — **Resolved** (run 4): descent
  at (-266.4, 579.8), and the climb is a staircase at x -264..-260, z 562–563.
  See "Hard waypoints" above.
- ~~The route has never been walked in daylight end-to-end.~~ — **Done**, run 4
  (day 48197, timeOfDay ~5559). No behavioural difference observed vs. the night
  runs beyond the absence of hostiles.
- Which lane should the bot prefer at the z 635–683 fork? Hill crossing is
  shorter and proven gradual; east swing is longer but flatter. Untested by the
  bot alone.

## Related

- [[../places/rooftop-garden]] — trailhead
- [[../places/snow-line-midway]] — biome landmark
- [[../places/igloo]] — destination
- [[../places/ice-castle]] — ~51 blocks west of the igloo, separate structure
- [[follow-hop-assist]] — the mechanism that made the roof climb possible

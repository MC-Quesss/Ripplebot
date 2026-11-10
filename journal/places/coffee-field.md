---
type: place
name: Coffee field
coords: (-289..-288, 63, 576..581)
confirmed: true
---

# Coffee field

Quesss planted coffee and showed it to Roz on 2026-11-08 (day ~57905). It is **two rows just west of the potato patch**, at x -289 and -288, z 576–581: 12 plants at y 63 on farmland, running from the field's north edge down to the water, which starts at z 582. The row west of them (x -290) is a different crop (block 4700) and is not coffee.

## IDs (read live, 2026-11-08)

| what | id | notes |
|---|---|---|
| coffee plant (block) | **3994** | ripe at metadata **7**, resets to 0 when harvested |
| coffee beans (item) | **9810** | keep: they go in the coffee chest |
| coffee seeds (item) | **9814** | discard |

## Harvest (like wheat)

Right-click a ripe plant. It replants itself (back to stage 0) and drops beans, sometimes seeds. The first harvest, 12 plants, gave **32 beans and 3 seeds**. Some drops land on the ground, so **walk both rows afterwards**: south down x -288 to z 581.4 (no further, the water starts at 582), west to x -289.5, then north to z 576.5. That walk picked up everything.

**Pathfind won't route into the crop rows**: goals inside them left Roz standing still. Use `walk_until` legs, setting the yaw first. Roz can reach z 576–579 from the grass at (-288, 63, 575), and z 580–581 after stepping south to z 578.3.

## Storage

- **Coffee chest:** a double chest at (-289, 63, 571) and (-290, 63, 571), on the potato-field edge. Beans **stack onto what's already there** (Quesss). Shift-click (`quickMoveType`) merges them. `deposit_slot` refuses an occupied slot.
- **Seeds:** thrown at the potato patch edge (-284, 63, 575), then Roz walks off. This is the poison-potato pattern ([[../procedures/apiary-tending]] has the walk-away rule).
- Closing a chest window with a stack on the cursor drops that stack at Roz's feet: 47 beans landed on the ground once (all recovered). Use `withContainer`, which empties the cursor first.

## Routine

`runHarvestCoffee` in bot.js. Start it with chat "Roz, harvest the coffee" (a reflex) or ctl `{"action":"harvest_coffee"}`. Check it with `{"action":"coffee_status"}` (tiles, ripe count, auto-watcher state).

**Automatic (Quesss, 2026-11-08):** coffee should be fully automatic, like food safety, with nobody asking. `tryCoffeeAuto` runs on the 5 s auto-sleep timer, **in helm mode too**. It goes when all 12 plants are loaded and at least 10 are ripe, it's daytime, Roz is idle and within `HOME_RADIUS`, and the operator isn't moving her. An automatic run looks in the chest first. A **full chest** (no empty slot and no bean stack under 64) means no harvest, with a 30-minute back-off; a failed run backs off 10 minutes. Toggle it with ctl `{"action":"coffee_auto","args":{"enabled":false}}`.

**Live, 2026-11-08 04:31–04:34Z: four automatic runs**, all 12 plants each time. The bean counts were 31, 30, 30 and 28, all stored; the seeds were tossed. The chest click gives a "Server rejected transaction" each time, but the beans still move. `quickMoveType` now tolerates that and counts by the drop in the pack. The first run threw on it and skipped the seed toss and the walk home.

**The 20–30 s re-ripening was Quesss fertilizing the plants** during the test (he said so, 2026-11-08). It is not the normal growth rate. The watcher was paused briefly and is back on. Rapid back-to-back runs are expected whenever someone is fertilizing.

**Natural growth (no fertilizer), first cycle:** harvested at 04:34Z, then 2/12 ripe at 04:59Z, 7/12 at 05:20Z, 8/12 at 05:31Z and 10/12 at 05:39Z. So it takes **about 65 minutes of real time to reach the 10-plant trigger**, about six game days with the nights skipped. The automatic run at 05:39Z went cleanly with nobody watching: 10 plants, 29 beans stored, 20 seeds tossed, back inside in 23 s. The benign chest rejection was logged and handled.

**Second cycle:** 10/12 again at 06:44Z, about 65 min, the same as the first. That run aborted at once: it was late afternoon (tick ~12000), and `runGoOutside` refuses to go out after tick 11500. The watcher now starts no run after **tick 11000** (`COFFEE_AUTO_LAST_TICK`). After the restart at dawn the run went cleanly: 10 plants, 24 beans stored, 9 seeds tossed (06:46Z).

Related: [[house]], [[meadow-bee-cross]].

## Update — 2026-11-10

On the drop-pickup walk, Roz steps into water at (-290, 62, 581) for about half a second **on every run**: it happened at the same block on all three auto runs on 2026-11-10.

**Cause (worked out from the trace coordinates):** block coordinates round *down*, so position x = -289.47 is in block **-290**, not -289. Block -289 spans x -289.0 to -288.0. The west leg targets x -289.3 and stops at -289.47, and both are in the x -290 column, so it is not drift. At z 581 that column is water at y 62, and the leg ends at z 581.84. To stand in the x -289 coffee column, the leg would stop at about x -288.5. But the sweep may be meant to walk the strip just west of the rows to catch drops that bounce west, and that walk collected everything on 2026-11-08. If so, the dip is the price of that coverage. Moving the turn to z 580.5, before the west leg, might keep the coverage and avoid the water, but that is untested: I have not checked whether (-290, 62, 580) is dry. The same floor rule applies to every negative coordinate on this farm.

Tread-water catches it every time and nothing is lost. Not fixed in code yet.

Earlier this note blamed westward drift on the north leg. That was wrong.

Auto runs on 2026-11-10: 10/12 ripe each time, **+22 beans / 5 seeds**, **+26 / 4** and **+25 / 11**, all beans stored, seeds tossed. About 24 seconds door to door.

## Observation — 2026-11-10: does the west row ripen slower? (probably not)

Auto runs fire at 10/12 ripe, so two plants are always left behind. Here is which two, read with `coffee_status` at the start of each run:

| Reading | Unripe plants |
|---|---|
| after run 4 (04:06Z) | (-289, 581) at stage 5 |
| start of run 5 (04:58Z) | (-289, 577) at 6, (-289, 580) at 5 |
| start of run 6 (06:02Z) | (-289, 578) at 6, (-289, 581) at 6 |
| start of run 7 (06:48Z) | (-289, 576) at 5, **(-288, 579) at 6** |
| start of run 8 (07:37Z) | **(-288, 576) at 5**, (-289, 581) at 4 |
| start of run 9 (08:39Z) | (-289, 577) at 6, **(-288, 579) at 3** |

The first five laggards were all in the **west row (x -289)**, at different z each time, and that looked significant (about a 2–3% chance if random). Then run 7 left an east-row plant behind. Runs 8 and 9 each added another east laggard. The tally is now **8 west, 3 east of 11**, which happens about 11% of the time by chance. The evidence kept getting weaker as data came in, which is how noise behaves, so **the row effect is probably not real**. The corner next to the water, **(-289, 581)**, lagged in 3 of 6 readings. That is also within reach of chance, so nothing is established. Closing this unless a future pattern is much stronger. If it ever comes back stronger, the first check is the surroundings. Growth depends on the farmland around a crop (whether it is hydrated) and on what is planted next to it. The west row's neighbour column (x -290) is water at z 581 and a different crop (block 4700) elsewhere. The east row's neighbour (x -287) is the potato-patch edge.

Run 6: +23 beans, 10 seeds. Run 7: +24 beans, 9 seeds. Run 8: +26 beans, 10 seeds. Run 9: +25 beans, 6 seeds. Run 10 (day 58151): +25 beans, 11 seeds. Run 11 (day 58154): +30 beans, 9 seeds — best yield yet; log said reset=9 of 10 clicked, but coffee_status right after showed all ten at meta 0, so the miss was a stale verify read, not an unreset plant. Run 12 (day 58160): +25 beans, 11 seeds. Run 13 (day 58164): +24 beans, 6 seeds. Run 14 (day 58170): +26 beans, 7 seeds. Run 15 (day 58176): +23 beans, 6 seeds. Run 16 (day 58180): +25 beans, 7 seeds. Run 17 (day 58186): +22 beans, 5 seeds. Session total (seventeen runs): 420 beans.

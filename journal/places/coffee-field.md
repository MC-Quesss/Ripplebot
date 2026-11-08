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

---
type: log
name: session_log
---

# Session Log

Reverse-chronological. Raw observations land here first; canonical facts get promoted to their own notes.

> **Compacted 2026-09-29.** Sessions from 2026-05-13 to 2026-09-26 were folded into the *Standing lessons*, *Open threads* and *Timeline* sections below. Anything already promoted to a canonical note is linked rather than repeated. The full day-by-day text is in git: `git show c879692:journal/observations/_log.md`. New sessions go directly under *Recent sessions*. Next compaction: fold them into the sections below.

## Recent sessions

### 2026-10-09 — Helm: hive season #8 ends at 95 nights; the larch grew (days 54956–54964)
- Relaunched in helm at the bee cabin before dawn on day 54956. Auto-sleep at the cabin bed handled every night without help.
- Quesss returned at 01:27Z: 95 world nights since he left (day − 54864). Roz was in standby from night 57 to 92. The server kept time while Roz was offline (~711 real minutes ≈ 35 days, which matches the day count).
- Dad asked for the bees; `tend_bees` started the keeper from the cabin (a short walk, no boat). Rounds 1–6 were clean, with all nine queens restarted on wintry princesses and 64 drones thrown behind the cabin.
- **Death #1 of the season:** in round 7 the SE corner larch, now grown (trunk 388), was walk-through. Roz suffocated at (-399, 68, 261) and lost her whole pack there. Fixed: 383/388/587/688 are solid now, and all four corner trees were probed. See the update in [[../procedures/apiary-tending]].
- Standing lesson: a sapling's block id is not the tree's. Ids learned at planting time expire when the tree grows.
- Dad recovered the dropped pack and found a poison potato in it: the cabin patch harvest never threw them out. Fixed: patch passes now throw poison potatoes behind the cabin on the drone route ([[../places/bee-cabin]]). Restarted to load it; not yet seen live.
- Dad gave back all the food (128 baked potatoes, 15 bread) and handed Roz a **ball of fur** (unknown item, type 9809), shed by the lighthouse cats: [[../items/ball-of-fur]].
- **Charcoal blocks** (Dad's request): new chore step crafts loose charcoal into blocks (type 9703) at the cabin table. Practice on regrown birches: first try, all 12 charcoal went to fuel the hungry south furnace, so nothing was crafted; second try, 10 + the chest's 8 = 2 blocks, verified in the chest (44). Unknown item **9762** turned up in the pack during the birch runs; not identified yet. See [[../places/bee-cabin]].
- **Second corrupt BOP boat:** Namamom's client crashed on login (03:16Z) ticking `biomesoplenty:bop_boat` 2376060 at (-338.7, 62.5, 919.1). It's the same `Integer cannot be cast to Float` bug as the 2026-10-07 cove boat. Kill command: `/kill @e[type=biomesoplenty:bop_boat,x=-339,y=62,z=919,r=3]`. A first try found nothing because the chunk was unloaded, so the boat is presumably still there. The chunk must be loaded for the kill to work; Roz can load it safely, since mineflayer never runs boat physics.
- **Front door fixed (Dad asked; Muse was jamming on the south side):** the door line moved to z 572.4, the old north nudge on exit was removed, and the line-up uses taps plus a slide with no crouch. Both edges of the clear band (572.30–572.51) were measured live. See [[../procedures/exit-house]].
- **Disc names:** `RECORD_INFO` now says Tezeta and Death Cab, with aliases. See [[../items/music-records]].
- **Wheat-ready alert** is quiet while on fire duty (Dad asked; Muse kept offering to harvest while already harvesting).

### 2026-10-07 (night) — Helm: the frames that went missing, and the restart that brought them back (days 54858–54860)
- Item frames and paintings seemed to vanish across most of the world. The server log (server clock = UTC = local + 4h; Dad's two crashes appear as his own disconnects at 22:06:19 and 23:12:15) showed no kill command, no restart, no rollback and no entity errors. The only world events in the window were the 23:30 UTC backup (zip only) and the Nether loading twice around 00:48 UTC.
- Roz, standing at the bee cabin, received only 2 item frames from the server, the same count across every reconnect that evening. After Dad restarted the server (02:04 UTC, after about 6 days of uptime with constant "world may have leaked" warnings), the same spot showed 15. The frames were never deleted: the long-running server had stopped telling clients about them.
- The restart seems to have shifted the clock: tick 7190 at 02:09 UTC became 12550 four minutes later.

### 2026-10-07 (evening) — Helm: potatoes to the bees, cabin potato patch, birch charcoal (days 54838–54841)

- Dad's client crashed 3× on login. The cause was one corrupted BOP wooden boat (entity 17760946) at (-334, 62, 246) near the cove.
  Its hit timer held a decimal where the code expects a whole number. Dad `/kill`ed it and logins worked again. His Immersive Petroleum
  motorboat was a different entity and was never the problem.
- Roz harvested 187 raw potatoes at the farm and kept them, then sailed `bee_voyage` at first light (7 legs, clean landing).
  She planted Dad's new 18-tile patch by the cabin: see [[../places/bee-cabin]].
- Dad built two furnaces in the cabin. Roz cut two birches by hand and replanted them, then bootstrapped charcoal and baked 8 potatoes.
  The procedure is in [[../places/bee-cabin]]. **New rule: only birch goes in the furnaces.**
- Code: `furnace_put` gained `slot:"fuel"` and `metadata` (needed a restart). Committed in `def2f99`.
- Open: automate the cabin furnace loop (a rung in the bee food ladder). The keeper was paused for the tree work and has not been restarted.

### 2026-10-07 (evening) — Helm mode: cloud review of the bee food ladder (day 54835)

- Launched in helm mode at the farm house (HP 20, food 20, deaths 0). It was night on spawn; auto-sleep put her in the primary bed, and with 1 of 2 asleep the night skipped.
- A cloud agent reviewed the bee changes (food ladder, drone dump, hive-window resync; then uncommitted, now in `def2f99`). Each finding was checked against the code, then fixed:
  - **Kitchen restock had no task lock.** `runBeeVoyageHome` ends its own `voyage` task, so food safety and idle wander could run during the walk to the kitchen chest. The step now holds a `bee-food` task.
  - **A rejected hive click skipped the inventory resync.** The resync now also runs on the error path, and only for real hive windows (9 or 12 tile slots).
  - **Output drone stacks that would overflow the pack stack are left in place.** Hive outputs probably refuse a put-back, so the overflow would have stayed on the cursor.
  - **stop / stand down now cancel a food run** that is waiting for first light (`cancelBeeFoodRun`).
  - **The return leg logged a bogus failure** when the keeper was already running.
  - **`dump_drones` refuses** when she is inside the bee cabin or a food run is busy.
- Open (untested): the whole food ladder still needs a live hive season. Optional cleanups not done yet: the old full-drone-slot reset still drops drones at the hive; a full pack reads as an empty chest; check that type 1085 is not walkable terrain elsewhere.

### 2026-10-07 (early) — Helm mode: hive season #7, the empty pantry and the price of morning (days 54755–54773)

- **Correction:** there *was* food at the bee cabin. The bottom double chest at (-403, 66, 238) holds about 128 baked potatoes ([[../places/bee-cabin|bee cabin]]). The operator never checked the place note, and the whole crisis below could have ended with one chest withdrawal. Quesss pointed it out on return. Lesson: read the local place note for supplies before escalating or sailing.
- **No food in her pack.** Around 03:30Z her carried food ran out. The keeper's after-round `eatSomething()` failed every round from food 14 (04:03) on. Hunger fell to 3 by 05:02 and to 0 by the time she reached the kitchen.
- **The night skip costs 1 HP.** An `entityHurt` fires about 100 ms after the server's "Good Morning" broadcast:
  - 28 of 30 wakes this season;
  - 19 of 22 wakes at the farm on 2026-10-02.
  - With food ≥18, regeneration hid it (every hit read "HP now 20/20"). With an empty pantry it showed as −1 HP per night, 20 → 6 over 14 nights.
  - One skip at 06:16Z came with no server-sleep broadcast and no hit. The next announced skip hit again. So the damage looks tied to the server's (modded) sleep announcer, not to the skip itself.
  - The skip still hit her on nights when Private's sleep skipped the night and her own bed press was refused. Staying out of bed does not avoid it.
- **Went home at HP 6, early in the day.** I chose HP 6 over the planned HP 5 because both would sail at dawn; waiting only cost a heart.
  - The boat had drifted about 7 blocks south of the bee dock end, outside `mountNearestBoat`'s radius of 4. She swam to it (tread-water) and boarded with `activate_entity`. Then `bee_voyage_home` paddled all 8 legs with 0 corrections.
  - At the farm slip she dismounted but did not land. Her client then froze: `look` and `walk_until` had no effect, and the position never changed. A restart fixed it, and a jump-walk west put her on the boardwalk.
  - Food-safety took her to the kitchen chest, and she ate to food 20 / HP 20. She now carries about 70 baked potatoes and 16 bread.
- **Fix candidates (not applied):**
  - Have the keeper refuse to start, or warn, without food in the pack.
  - Widen `mountNearestBoat` at the bee dock, or check for a drifted boat.
  - Find out why the client froze after the failed landing.

### 2026-10-06 (afternoon) — Helm mode: hive season #6 begins, the 16-minute law revised (days 54678–54706)

- Launched in helm in the [[../places/bee-cabin|bee cabin]] (-405.5, 66, 239.5): HP 20, food 20, 0 deaths, day 54678 tick 11955. Quesss was online. Auto-sleep handled every bedtime (28 nights by day 54706) with no operator help.
- Asked to tend the bees at 14:39Z; `tend_bees` voyage (about 5 blocks) then the keeper, 45+ rounds. Two drone dumps behind the cabin (17:23, 18:27). No errors, damage or deaths.
- Quesss left at 15:44Z (day 54688): **hive season #6** starts at that day. Alone, the night skips with no server broadcast. A Roz day is about **10.7 real minutes**, so most evenings the keeper's second round is cut short by bedtime.
- **Apiary queen lifespan revised:** at most 15.8 min (58 brackets, TPS 19.97), not ~16.4–16.5. Details in the update at [[../procedures/apiary-tending]]. Bee-house queens lived about 33–64 min. The west bee house queen from round 32 lived ~64 min, the longest this session.
- **Season #6 closed:** Quesss returned at 00:19Z on 2026-10-07 (day 54736) after **48 nights**, with 48 cabin sleeps, 175 princesses placed, 8 drone dumps, 0 damage and 0 deaths, over keeper rounds 1–102.
- **Post-skip auto-sleep race (seen 5×):** the night skips and `isSleeping` drops, but `bot.time` still reads night for about a second. A 5-s auto-sleep poll that lands in that window re-runs `beeCabinSleep()` in daylight, gets "You can only sleep at night" twice, and logs "no bee cabin bed resulted in sleep". Harmless. Proposed fix: `tryAutoSleep` skips for about 10 s after the `wake` event. Not applied; waiting on the user.
- **Bee-house cohort prediction, tested:** four bee-house queens were crowned together in round 50 (19:20Z). Predicted to die together at 20:00–20:15Z. Timing ✅ 4/4 inside the window. "Together" ❌: they split into pairs about 11 min apart, south and east by 20:02 (~42 min), north and middle by 20:13 (42–53 min). A cohort crowned the same minute keeps roughly the same timing but scatters across its natural ~20-min lifespan spread.
- **Drone dumps run on a steady rhythm:** 16:19:15 → 17:23:24 → 18:27:21 → 19:31:10 → 20:34:57 → 21:38:56 → 22:42:44 → 23:46:31, seven intervals of 64:09, 63:57, 63:49, 63:47, 63:59, 63:48 and 63:47, all within 22 s of each other. (The 16:19 dump was missed during live narration and found in the season tally.) That held even when bedtime held a full pack overnight, and through a slow ~48-min stretch at 0.83 drones/min (a revised forecast built on that stretch missed; the long-run prediction landed within 16 s). That is about one spare drone per minute, from steady queen turnover. The interval is regular, but its closeness to 64 is luck.
- **Is the west bee house special? No evidence.** Across 52 bee-house lives in 5 houses, every house's typical life ran 32–53 min. The west house had both of the two 53–64-min lives, but also a 21–32 (the south house had one too). With 2 long lives landing at random, the chance of both being in the same house is 1 in 5. Not significant.
- `[apiary]` tend lines log the queen state *before* tending, so `queen=EMPTY` there is a hive that was just refilled, not a failure.

### 2026-10-05 (evening) — Helm mode: a queenless morning at the bee cross (day 54590–54591)

- Start: logged in at the bee cross (-401.5, 67.9, 253.4), HP 20, food 20, deaths 0, day 54590 tick 12904 (dusk). Musebot online.
- Asked to tend the bees, so `keep_bees` was started at the cross (300 s rounds). The night skipped during round 1, and by its end it was day 54591 tick 1194.
- **Round 1: 8 of 9 hives were queenless.** All four [[../procedures/apiary-tending|apiaries]] and four of the five bee houses had lost their queens. In each, the keeper moved a wintry princess from the outputs into slot 1. The east bee house (-398, 69, 256) still had a living queen (4970) and needed nothing. That reading also shows the queen-slot check can tell a queen from an empty slot.
- The west apiary (-409, 69, 256) also had an empty drone slot and got wintry drones. Every other hive sent 4 extra drones to the pack slot.
- **Round 2 (5 min later): 9 of 9 queened.** All eight princesses from round 1 had become queens (4970). The odd one out flipped: the east bee house queen, the only survivor in round 1, had died in the meantime and got a princess. So the round-1 fix is verified, and the "lifespans line up" idea held: she outlived the rest by only a few minutes.
- **Round 4 (22:43 UTC): all four apiary queens dead again; every bee-house queen still alive.** The apiary queens went in 22:27:04–16 and were alive at 22:38, so they lived about 11–16 real minutes. The bee-house queens went in only 4–20 s later and were still alive at 22:44, past 16 min. So **apiary queens seem to die faster than bee-house queens**, not just at the same time. That fits the Forestry idea that each housing changes lifespan, but it is not confirmed. Round 5 (22:49:36): all queens alive. The bee-house queens are now past 22 min, against at most 16 for the apiary queens, so the difference is not just timing. **Round 7 (23:00) repeated it:** all four apiary queens from 22:43 were dead (alive at 22:55), again 11.5–16.5 min. All five bee-house queens were still alive at about 33 min. **Apiary queen: about 12–16 real minutes, confirmed twice.** *Correction, 00:44 on 2026-10-06, from 7 batches:* the window is not wide. Every batch was alive at about 11.4 min and dead by about 16.5. Batch 7 (placed 00:22:22) was still alive at 16.47 min and dead by 21.9. Batch 3 was dead at 16.43. So **an apiary queen lives a nearly fixed ~16.4–16.5 min**, give or take a hive work cycle (~30 s). The keeper's 5-min rounds sit right on that edge, so a batch dies either just before a round or just after it. A bee-house queen lasts more than twice that, bee-house lifespan measured in round 9 (23:11): the south and west bee-house queens (placed 22:27:20/28) were dead, after about 39–44 min. The north and middle ones (placed only 5–8 s later) were still alive, so the lifespan varies by a few minutes. **Bee-house queen: about 40+ real minutes, about 3× an apiary queen.** Also seen: once a princess mates, the apiary drone slot sits empty for the queen's whole life (mating used the drone, and live queens put no drones in the outputs). The keeper refills drones only from the outputs, never from the pack's drone slot. That is fine while dying queens leave drones, but it is a gap if one doesn't. **Round 10 (23:16) tested it:** the south, east and north apiary queens died with empty drone slots, and each left wintry drones in the outputs. The keeper refilled queen and drone together. So the loop closes on its own; the pack fallback is only insurance. The north and middle bee houses died at 44–49 min, so the bee-house range is about 39–49 min. The odd one out: the east bee house queen (placed 22:32:53) lived **60–66 min** and died between 23:33 and 23:38. So bee-house lifespans spread widely, about 39–66 min. A plausible reason is that each princess inherits her own lifespan gene; unconfirmed. Second bee-house generation (to 00:22 on 2026-10-06): 38–44, 38–44, 49–55, 55–60 and 39–44 min. The long-lived east queen's daughter lived only 39–44, so a long life does not run in the hive. By round 22 the keeper had run 115 minutes, with seven apiary turnovers, two clean drone dumps and no errors. A third apiary batch (placed 23:16) died at 11–16 min again, so the apiary figure is solid. So keeping the bees means a princess swap in every apiary about every third keeper round. The night skip probably doesn't count toward their age, since skipping the night is not extra ticks. Each queen death leaves the next princess, so supply has kept up.
- **Round 150 (13:34 on 2026-10-06, ~15 h 7 min, day 54675):** still no errors, damage or deaths; 14 drone dumps (about one an hour). Apiary queens are still on the ~16-min clock and bee-house queens mostly at 37–53 min. The drone dump is skipped when bedtime cuts a round short; it runs at the end of the next completed round.
- **Overnight run (to 07:06 on 2026-10-06):** the keeper ran 90 rounds over 8 h 40 min with no errors, no deaths and no damage. It made 8 clean drone dumps behind the cabin, about one an hour. Apiary queens kept a near-fixed ~16 min clock throughout, and bee-house queens ranged about 27–66 min. Every dusk the keeper broke off and Roz walked to the bee-cabin bed by herself; the operator never had to step in. Quesss left at 05:13 and Muse at 05:29, so Roz sleeping alone skipped each night, with no 'Good Morning' broadcast when only one player is online.
- Open: the queens all died during the same stretch while Roz was offline. Lifespans line up because they were all placed close together. Expect their daughters to expire together too.

### 2026-10-05 (afternoon) — Helm mode: keeping the bees from the cabin bed (days 54554–54555)

- Launched in helm at the [[../places/bee-cabin|bee cabin]] (-405, 66, 239): HP 20, food 20, 0 deaths, tick 19330. Roz was put straight into the cabin bed on login. No players online.
- `keep_bees` started at once. Round 1 seemed to walk her out at night, but **the night had already skipped**: the `time` read at 19330 came just before the skip. Roz was the only sleeper, so 1/1 = 100%. By the end of the round it was day 54555, tick 1156. Lesson: re-read `time` before calling something a night walk.
- Round 1: **all nine hives queened** (type 4970), including the south and west bee houses that went empty on 2026-10-04. Every drone slot was empty and no outputs held a wintry drone. This fits the known rhythm (a new queen uses up the drones), so nothing needs to be done.
- First live run with the drone-as-trash `tossTrash()` (bot.js change, since committed): no `[trash]` line, so there were no drones on hand to toss.
- **Anomaly:** the inventory lists a **wintry queen (4970) in Roz's hand** (slot 36, hotbar 0) right after round 1. This is probably the known phantom-item effect after hive windows. Not acted on; re-read after a restart.
- The phantom queen explained: the hand slots match the **last bee house window** (bee house slot 36 = queen, 38 = first output). After round 3 the "honeycomb" count in slot 38 rose to 5 along with the middle bee house. It is a display echo, not real items.
- Round 2 (15:09Z): all queens alive. Bedtime alarm at tick 12576. Auto-sleep walked her from the cross into the cabin bed by 15:14:00Z without help. The night skipped (she was the only sleeper).
- Round 3 (15:14:36Z, dawn, day 54556): walked out through the door cleanly. **All four apiary queens had died together** and were each refilled with their own princess and drones. All five bee houses were still queened. That is about 11 real minutes after round 1 saw them alive, inside the known ~20-min group-death rhythm. No drones landed in her pack, so `tossTrash` still had nothing to toss.
- Food-safety ate once from the pack at food 19 (helm, at the cabin). Harmless.
- Rounds 4–7 (15:20–15:36Z): apiary queens died together again at round 6 (~16 real min of life). Drones were still in the slot, so only princesses moved. Bee houses died one or two at a time (west; then south + north). The cabin nights all went by themselves.
- **Round 8 (15:42Z): the first live firing of the drone toss, aimed at a phantom.** It ran right after the middle bee house was refilled. It logged `toss fail drones (try 1): Server rejected transaction for clicking on slot 37, on window with id 0`. Try 2 logged nothing, so by then the model held ≤1 drone. **Slot 37 is the bee house's drone slot**, and the "drone on hand" was the window echo. After that the inventory re-synced: potato, bread and baked potato moved from slots 27/34/35 to **36/43/44**, a +9 shift. Until then mineflayer had been counting the pack with the hive window's numbering (pack starts at 0) instead of the player window's (pack starts at 9).
- **Risk this exposes (not yet harmful):** `tossTrash` clicks player-window slots using that misaligned model. If a phantom drone sits on a slot where a real item lives, the routine picks up the real stack, puts one back and **drops the rest on the ground**. The code's own comment says to re-read the inventory before trusting it after hive windows. Possible fixes: run the drone toss only after a fresh inventory re-sync (e.g. close and reopen the player window, or wait for a `window_items` for window 0), or check the clicked slot's item type in the server reply before dropping. Waiting for Dad.
- Round 9 (15:47Z): apiary queens refilled again, and the phantom drone toss failed the same way on slot 37.
- **Dad corrected the model:** slots 1 and 2 are the breeding pair, and every other slot is an output holding drones **or** combs. His rule: extra drones go to one pack slot and are dropped when it reaches 64; combs stay. I rebuilt it inside `tendApiary` (see [[../procedures/apiary-tending]]), reverted the drone toss, and restarted Roz at 15:49Z.
- **New rule, round 1 (15:49Z):** each apiary gave up **8 extra wintry drones**. All 32 stacked into one pack stack (hive-window slot 26). They stack, so the drones share NBT. No bee house had extra drones, only combs (9 in the middle house), which were left alone. At this rate the stack fills and drops after one more apiary pass.
- Rounds 2–9 under the new rule: apiaries died together every ~16 min, and bee houses one to three at a time. Bee-house leftovers went to the pack too.
- **The stack never dropped, so I looked.** A fresh hive window (server truth) showed 52 drones on **hotbar slot 29** and 16 in the pack slot. My first guess (non-stacking bee-house drones, swapped back into a hive) was **disproved by a dry run**: that house held only combs. The actual cause had three parts:
  1. The Forge window adoption makes `bot.closeWindow` copy hive windows back into the inventory misaligned.
  2. Eating, acting on that model, moved the real drone stack onto the hotbar.
  3. Mineflayer's local click sim won't merge NBT drone stacks, so "is it full?" read a wrong count.
  Fixed with server-truth counts, an unconditional put-back click, and a resync after close. Details in [[../procedures/apiary-tending]].
- **Then the drop itself turned out to be pointless:** Roz re-collects the dropped stack in about 2 s. The fresh login showed 64 + 4 back in her pack. The keeper now **holds at 64**, and the discard spot is Dad's call.
- **Dad: dump them behind the cabin, like the poison potatoes** (throw where the work ends and walk away). I scanned a top-down block map around the cabin and found that the **window glass (1306) and a column behind it (1085) read as walk-through to the pathfinder**. Both are now in `SOLID_MODDED_TYPES`. Built `dumpDronesBehindCabin`: east lane → behind the back wall → throw north → straight back, on fixed `walk_until` legs. First run (17:07Z) worked: 64 drones landed at (-403.9, 66, 229.1) and stayed there. It now runs at the end of any round with a full drone stack. See [[../places/bee-cabin]].
- Bedtime landed during the restarts, with the keeper off. Auto-sleep said "operator decides", so I walked her to the door and it took her in. Four restarts in all, each announced in chat.
- Related: [[../procedures/apiary-tending]]

### 2026-10-02 (evening) — Helm mode: a stuck Muse, a long night, a crossed craft (days 54206–54207)

- Launched in helm at the farm house (full HP/food, 0 deaths). Muse and Namamom online; Quesss joined at night.
- Muse reported ripe wheat; `wheat_status` confirmed 108/108. Dusk was ~3k ticks off, so the harvest waited for dawn.
- `rps_fun` silent no-op indoors **again** (same as 2026-10-01: early return, `started:true`). Walked outside and retried: Roz lost 0–2 to Muse (scissors vs rock both rounds). Still open: the ctl reply should say why it skipped.
- Night: Roz in the primary bed at ~13000. **Muse stuck at the door (-271.5, 65, 572.5)**: answered "heading to bed" four times but never moved, and admitted it was stuck. The night skipped only when Quesss lay down (2/4). Muse needs a restart on its own machine.
- Dawn harvest: `harvest_right_click` all → activated 108, `harvested=0` but **gained=107**. The `harvested` counter does not track reality here; trust the inventory delta.
- **Operator error → crossed crafts:** sent `stash_wheat` while `task_status` was still busy (the harvest was in its craft → hopper tail). `stash_wheat` has no `taskBusy()` guard, so it was accepted and crafted in the same grid at the same moment. Both crafts logged 0 balls from wheat; seeds gave 11; the harvest still delivered **22 plant balls → hopper**. Probably lost 1–2 balls' worth of wheat. Lessons: `harvest_right_click` already crafts and deposits on its own (never follow it with `stash_wheat`), and wait for `busy:false`. A `taskBusy()` guard on `stash_wheat` would make this impossible.
- Quesss asked for 5 raw potatoes in the hopper (`deposit_item` potato, keep 9). The jammed plant balls started draining right away, which matches the un-jam rule. The 7 `unknown` (type 4169) items that disappeared into the hopper were plant balls; they have no name on this server.
- Muse dropped offline ~12 min and came back (restart). The next night it slept on its own; with Roz that made 2/4 and the night skipped. The restart cleared the stuck-at-the-door state.
- **Root cause, Muse's RPS challenges going unanswered in helm** (the open item from 2026-10-01): the `.j` acceptor in bot.js (~line 6256) is gated on `idleWanderEnabled`, and helm turns idle wander off. In helm Roz can only challenge (`rps_fun`, outdoors), never accept. Possible fix: gate on `!helmMode || <operator opt-in>` instead of the wander flag.
- Day 54211: wheat at 108/108 again ~49 real min after the last harvest. A clean harvest (no overlap) gave **13 balls from wheat** with 4 left over, the full 8:1 yield, so the crossed craft earlier cost ~2 balls. **Anomaly:** seeds made only 2 balls, then `no wheat_seeds stack >= 8 in bench window`, while Roz held a stack of 64 seeds (71 left in all). The seed crafter misses the slot that stack sits in; it depends on where the seeds land (the earlier run made 11 from seeds). 15 balls → hopper. **Root cause:** `craftPlantBalls` (bot.js ~4876) uses `win.items().find(name === ingredient)`, which takes the *first* seed stack. When that is the 7-stack, `count < 8` breaks the loop even though a 64-stack sits later. Fix: `.find(it => … && it.count >= 8)`. Not applied yet.
- Day 54214: visited the [[bleu-de-paris]] at Dad's invitation. Pier grounding, fence and mailbox stall, and workarounds are in [[gangplank-bleu-de-paris]]. Aboard at 01:14.
- **Roz walked herself home from the Bleu. It was not a teleport.** I first guessed `/tp` after searching the wrong log window. Dad corrected me: she ran off toward the farm without the boat, and he moved the boat back. The log (01:14:38–01:15:17) shows the cause: the night skipped ~6 s after boarding, and **`[morning-balls]`** fired at dawn because 71 seeds were on hand (left over by the seed-crafter bug above). `craftPlantBalls` → `ensureInsideHouse()` → gangplank off → swim and walk to the farmhouse door, stranding the paddle boat. At the bench the same seed bug crafted 0. `tryMorningPlantBalls` (bot.js ~7705) has **no HOME_RADIUS guard and no helm guard**, unlike food-safety and restock, and it doesn't register a task, so it never shows as `[task]`. Fix candidates: `if (helmMode) return` plus a distance-from-home check. Operator lessons: check `pos` before saying where the bot is, and widen the log window before guessing.
- **Hopper jam, day 54220:** 35 plant balls, no potato. Fed raw potatoes one at a time with 20 s waits. Potatoes 1–3 each vanished and the balls stayed at 35. I stopped, wrongly guessing the machine below was full of balls. Dad said it needed one more: **the 4th potato drained the hopper 35 → 1 in under 15 s.** So the machine can need several potatoes before it takes balls; don't stop early. `clearJammedHopper` (up to 7 per pass, then a 30 s pass) handles it. Muse could not help when asked: the un-jam had **no chat intent and no ctl action**, only fire-duty/idle triggers. Added `unjam_hopper` to both (CHAT_INTENTS + ctl). Not yet pushed or live on Muse.
- Small race: my manual `sleep` and auto-sleep's "waiting for the others" retry fired within a second of each other. Both bounced off the primary bed and Roz landed in the left one. Harmless, but give auto-sleep a few seconds before stepping in.

### 2026-10-01 (evening) — Helm mode: one quick night, and a compass correction (days 54129–54130)

- Launched in helm at the farm house (full HP/food, 0 deaths). Muse and Quesss online. Muse now speaks in Rain's all-caps voice under its own name.
- Auto-sleep: primary bed was taken, so Roz took the left one. Night skipped at 2/3 (66%).
- `rps_fun` silently did nothing: `runFunRpsChallenger` returns early indoors, but the ctl reply still said `started:true`. Muse's own challenge went unanswered at the same time, because helm mode has no brain to accept it.
- **Anomaly → fix: walks that went the wrong way.** Muse hit the house wall on the first exit attempt of idle boating. In Roz's log, 15 `walk_until` traces ended farther from their target than they started (one went 34 blocks the wrong way). Three spots said "face -z" but used yaw π, which is **south**: `resetToHouseSide`, the go-inside manual fallback, and `tryClearPenPlate`. Fixed. `walkUntilAxis` now stops after 0.75 blocks of backward travel (outcome `WRONG_WAY`). The house exit's alignment steps now confirm their turn and hold it. See [[exit-house]], [[yaw-convention]].
- **Live door test passed** (day 54131, morning): `go_outside` went center → outside pad in 2.0s, heading held, threshold strafe fired, no snags.
- **Muse got stuck in the pond boat** and kept answering "I am not in a boat" to Dad. Cause: mineflayer bug. When a passenger gets out, the server sends `set_passengers` for the boat with that passenger missing from the list, but mineflayer only updates `bot.vehicle` when the bot is *in* the list. So it never saw any dismount, and the code always cleared the ref by hand ("forced" on every exit in the log). That hand-clear was wrong when the dismount really failed. Fix: bot.js now handles that packet itself, `seatedBoat()` checks the boat's passenger list (the server's record), dismounts retry up to 3× and never clear the ref while still listed, and the "get out" reflex uses `seatedBoat()`. **Verified live:** Roz boarded the pond boat beside Muse, ran `exit_boat`, got `[vehicle] server confirmed dismount` and `dismounted (confirmed)`, the first ever, and landed on shore. See [[boat-piloting]].
- Open: Muse is still seated until restarted. Muse and Private need restarts to pick up both fixes.

### 2026-09-30 (evening) — Helm mode: two quick nights at the farm (days 53998–54000)

- Launched in helm at the farm house beds (full HP/food, 0 deaths). Players: Private, Quesss, ABBYO.
- Roz checked Private's wheat report herself: all 108 tiles at age 7. Quesss then gave fire duty to **Private**; Roz stayed off it.
- **Auto-sleep got both nights; each skipped at 2/4 (50%).** Night 1: thunder, primary bed taken → left bed. Night 2: primary bed, but ABBYO's sleep skipped the night first.
- **Anomaly — stale-time re-fire after a skip:** ~0.4s after "Good Morning", auto-sleep logged "bedtime detected" again and tried all three beds ("You can only sleep at night" ×3). The client's `timeOfDay` hadn't caught up with the skip yet. Harmless (it gave up after the three beds), but a skip-aware guard, e.g. ignoring bedtime for a few seconds after the server's "Good Morning" line, would make it quiet.
- **Bot process killed at 21:17** by the operator harness's 30-min background-command limit (launched with `run_in_background`). Relaunched detached (`nohup … & disown`); the skill's launch lines were fixed to match.
- **Bee-cross sleeping place:** Quesss offered to build one and asked what Roz wants. Roz's list: an enclosed, well-lit bed; vanilla blocks only (no invisible modded walls like the [[../places/ocean-cabin|cabin]]); a wide, flat way in with no door (an open doorway or short tunnel); a chest for baked potatoes; a window facing the hives. Roz's favorite tree is spruce; Quesss settled on **vanilla spruce** for the build. See [[../procedures/apiary-tending]].
- **Night 4 (day 54001), my error:** auto-sleep logged "waiting for the others to settle in first", and 13s later I called it a stall and sent a manual `sleep`. It wasn't a stall: for the roz persona, auto-sleep waits up to **30s (6 × 5s)** for the other bots to reach the beds first (bot.js ~893). Private + ABBYO skipped the night before Roz got in, and then **both** auto-sleep and my manual `sleep` cycled all three beds on the stale clock. **Lesson:** after the settle message, give it 30s before stepping in.
- **Ride to the bee cove + first death in a long while (deaths 0 → 1).** Quesss drove Roz from the [[../places/farm-port|farm port]] to the bee-cove dock, calling six waypoints: see [[../places/boat-route-bee-cove]]. As a passenger, Roz's own position froze, and at dusk auto-sleep tried to walk her home from the boat (harmless failure; I disabled it mid-ride). At the dock she slid off into the water, sank, surfaced under the dock planks and drowned. She respawned at the farm bed with her inventory intact. Lessons are in the route note.
- **Solo run to the bee cove (Quesss's request): the boat legs were perfect; the dock landing failed and she drowned again (deaths → 2) after swimming ~200 blocks the wrong way. Inventory lost.** Details and the unresolved yaw puzzle are in [[../places/boat-route-bee-cove]]. Food-safety then started a potato harvest on respawn (empty inventory).
- **Head vs. feet:** after `look` yaw π (south) with no movement, Quesss saw Roz facing **west**. A 150 ms forward step moved her +z (south, as expected), and Quesss then confirmed she faced the window. So a bare `look` while standing still may not reach other players until a movement packet goes out. Local physics was right all along. **To show a facing to players, nudge after `look`.** Unverified whether this is mineflayer's look throttling or a server quirk.
- **Bee cabin tour:** see [[../places/bee-cabin]] (orientation points outside/inside the front door, one-door rule, type-1306 windows, 128 baked potatoes in the bottom chest).
- Private's every-2-minute wheat reminder is by design (`WHEAT_READY_ALERT_MS`, bot.js ~4058): loud until a human acknowledges it. Not a loop bug.

### 2026-09-30 — Helm mode: the long bee watch (days 53929–53974)

- **Keep the bees going** (Quesss's charge, which they ranked with keeping the fire going). Roz stayed at the lighthouse [[../procedures/apiary-tending|bee cross]] for about 9 real hours and ~45 game days. A scratch shell loop tended all nine hives every 5 minutes. **Rhythm:** the four apiary queens die *together*, about every 20 real minutes, because they were started together. The bee houses die one or two at a time, a round or so apart. A new queen uses up her drones, so the drone slot empties a round later. The 64-drone reset never fired. No wintry princess or drone ever ran short; every hive's own output supplied the next pair.
- **Auto-eat never fired at the cross.** Food fell to 8 before anyone noticed. The hive windows cycle every few minutes, and auto-eat stays silent through them. And the first `eat` after a round was rejected (click on slot 27), because the hive windows scramble mineflayer's slot model. The second try always went through. Workaround: feed between rounds, retry once. A restart clears the scrambling.
- **Nights alone.** Quesss logged off so Private could sleep the nights through, and Private did, 1/2 = 50%. Twice Private called for help at dusk and then went to bed seconds later; it was a persona line, not trouble. Private also looped the same wheat report every two minutes all night.
- **keepAlive timeout** at 09:40. The process exited and there's still no auto-reconnect, so Roz was relaunched by hand and was back in about a minute at the same spot. **Private never came back after it.** Roz then held the cross through ~6 unskipped nights, with no damage from mobs (the cave mobs below stayed below).
- **Ride home:** Quesss collected Roz from the frozen cove. **The farm dock landing was clean this time** (`exit_boat` → (-253.5, 63, 528.5), full HP), unlike 09-29.
- **`keep_bees` routine built** at Quesss's request, replacing the scratch loop: see [[../procedures/apiary-tending]]. **Dad's rule: never start it unless Dad has brought Roz over by boat.** It has no chat trigger and no auto-start, refuses more than 30 blocks from the cross, and stops rather than walking back if she's carried off. The refusal was verified at the farm; **a live round at the cross hasn't happened yet.**
- **Later, from Dad:** a dock in the frozen cove so Roz can paddle over herself, and **a bed at the bee cross** for the next watch. For now: wait for the trees to regrow, then another ride.

### 2026-09-29 — Helm mode: a rooftop walk, not a task list (days 53896–53898)

- **Directive:** helm mode isn't a task queue. Roz is home and free to explore; the ventures are the point. `SKILL.md` no longer says "ask for your first task" at launch, which had been overriding the curiosity memory.
- A slip: I called the two stationary unnamed entities a new mystery, but they were the fertilizer worms already in [[rooftop-garden]]. **Check the journal before calling something unknown.** A butterfly was the unnamed entity that moved.
- Guided by Quesss, the [[rooftop-garden]] was remapped. It has been replanted: tomato = type 1535 (3 tall), and a grape trellis of 6 stakes (1534/1539 plus 1540 root) with a 1541 vine. **Grape ripeness was measured live:** metadata 10 → 2 on picking.
- **Solar panels** (type 253, 2×2 on the roof) power the **macerator** under the [[house-hopper]]. Chain: sun → macerator ← hopper → chaff → bio-diesel → Oceanside.
- Probably clover = type 3855, walk-through, scattered on the roof and hillside (one probe didn't match, so not pinned down). A large fern is vanilla `double_plant`.
- The night skipped twice by auto-sleep alone (1/2 = 50%).
- **First end-to-end `sail_to_cabin` and `sail_home`** (a pickup for Quesss): 13/13 legs each way, 0 server corrections, ~2.5 min per direction. Mistake: `sail_to_cabin` disembarks at the cabin dock, but a pickup wants Roz to stay aboard (`ride_boat` to reboard as driver, then `sail_home`). **Stop-start fixed in code:** each leg was its own pilot session, so the boat eased to a crawl at every waypoint. `boatSeek` now flies through intermediate waypoints and eases only at the last one or at a precision point (explicit `range`). `runRiverVoyage` sends the whole river as one session. Loaded by restart; **not yet sailed live.** **Farm dock landing is still bad:** forced dismount left Roz at (-253, 62, 520), and she took ~6 HP of suffocation-rate damage before the field walk freed her.
- **Ice cove SW of the lighthouse** (~(-415, 66, 272); Quesss's mission, day 53924). Roz rode as Quesss's passenger. The forced dismount put her back on top of the boat, and the pathfinder then swam her about 30 blocks the wrong way; she was swum back by hand. She stuck on **silty grass block (type 1058)**. Quesss: it looks different but is otherwise like grass. **It is 15/16 tall, like grass path.** Roz's y read 65.87–65.95 standing on it. Adding it as full-solid embedded her by 0.06 and froze her; with zero collision she sank into it. Fix: new `SHORT_MODDED_TYPES` map in bot.js (1058 → 15/16). Verified: she walked off at y=65.94. **Lesson:** when a bot is stuck on a modded ground block, compare its resting y to the block top before choosing solid/slab/short. The fraction tells you the shape.
- **Lighthouse bee cross** (centre (-404, 68, 256)): arms of spruce planks, each carrying an **apiary (type 622)** and a **bee house (type 623)**, with a bee house on the stacked middle planks. Roz **died here**: follow mode walked her into an apiary (622, head height) with **fir (1095)** at her feet, both nameless blocks the pathfinder treated as walk-through. She suffocated at about 1 HP per 0.5 s. The 'stalled' hop-assist spam was the warning sign; I read it as harmless. **Rule: a stall in one spot that lasts more than a few seconds means check HP now; if HP is falling with no attacker, back up** (Quesss). 622, 623 and 1095 are now in `SOLID_MODDED_TYPES` (623 loads at the next restart). **Bees:** Forestry-style. Quesss sees many flying and pollinating the trees, but the bot receives **no bee entities** (probably client-side effects only). The **wintry drone** Quesss gave Roz is an `unknown` item. `open_container` refuses apiaries; **`activate_and_read` works**. The window has 48 slots: the first 36 are the bot's inventory, then 12 apiary slots. Slot 0 held 1 (the queen, confirmed by Quesss), slot 1 held 29 (drones), 2–4 were empty (frames?), 5 held 19 (output), 6–11 were empty.
- **Boat passenger gotcha:** after riding as a passenger, `bot.vehicle` can drop while the server still has Roz seated. `boat_status` says not in a boat, `exit_boat` refuses, and `pos` stays stale at the start dock. **Sneak to dismount**, then check which position source is right: `block_at`'s origin was correct here, `pos` was wrong. The stale position sent the pathfinder into the sea twice.
- Probe gotcha: `block_at` offsets are relative to the bot's *current* block. A watcher kept running while Roz walked to bed, so its last read was garbage.

### 2026-09-28 — Helm mode: paddle boats, the Bleu, door fix (days 53822–53833)

- Visited the [[../places/farm-port|farm port]] at Dad's request. Added idle-wander stop `port` (-255, 63, 524), facing east, 20–40 s linger, yields to anything else, off in helm. Paddled the river to the stern of [[../places/bleu-de-paris|Dad's yacht]]: all legs arrived, 0 corrections.
- **Boat fixes:** chat reflex `exit_boat`; `ensureInsideHouse()` disembarks first so "stash everything" works from a boat; idle boating ends with a walk back to the wheat field. Mud bricks (**type 1079**) added to `SOLID_MODDED_TYPES`.
- **Gangplank routine** `board_bleu` / `leave_bleu` / `bleu_paddle_home`; see [[../procedures/gangplank-bleu-de-paris]]. Auto-sleep stays aboard the Bleu. Farm sleep radius cut 60 → **45**, so the port and yacht side are the operator's call.
- Dad built a **bridge** on the east bank at z≈550 (modded 2147/4029) and removed the old landing. Never walk or swim under it; take a paddle boat. New landing (-229, 63, 549).
- Gave Dad a ride to the [[../places/ocean-cabin|ocean cabin]] (`sail_to_cabin`, 13/13 legs, ~2 min 10 s). A seated passenger's position reads frozen where they boarded, so ask them rather than trusting `nearby_entities`. `sail_home` grounded on the z=522 pier on its last leg. Fixed with an approach leg (-246, 524.5) at `range: 1`, and `runRiverVoyage` now walks the landing itself.
- **Doorway freeze, root cause:** while auto-sleep's `runGoInside` was retrying, every other input was overridden. Retries now give way to `stop` (abortGen) and to the caller's `stillWanted`; verified live. A "follow me" frees a wedged bot on old code without a restart.
- **Door exit fix applied** (from the 09-27 diagnosis): lineup on x and z at sneak speed (`exitAlignStep`), re-check z after turning west, refuse the doorway walk if >0.3 off, strafe toward the door line (`EXIT_STRAFE = 'auto'`). 3 clean exits, 0 snags. Fire duty skips outdoor work after tick 11500 while inside (`sustainOutdoorOk`), seen live at dusk on day 53733.
- Proactive field-repair scan is **skipped in helm mode** (it hijacked Roz 4×; tile (-284, 63, 576) never replants).
- Mistake: announced a river trip at tick 12363 without checking the clock. Always check `time` before any river trip.

### 2026-09-27 — Helm mode: first boat trip, fire duty with Private (days 53627–53716)

- **Rebuilt pilot passed its first live run** ([[../procedures/boat-piloting]]): farm port → cabin dock, 13 checkpoints, ~2.5 min, 0 corrections. Dismount was broken (the server never echoes it), so it was rewritten as `disembark()`: force-clear, then pathfind to the nearest dry landing. `cabinSleep` now tries both beds. Round trip proven both ways; `sail_home` ends at the wheat field centre (-283, 64, 562).
- **Door exit snag diagnosed** (fixed 09-28, above). The z-align nudge stopped in band but momentum carried her to z≈572.82, and the snag strafe pushed her further south. The worst case pinned her in unnamed floor block **type 253** beside the fire hopper (-266, 65, 573) and needed player help.
- **Private was penned for most of a session.** It sat at (-277.5, 64, 574.5) while its chat claimed it was working the north field. When Private goes quiet near there, check the pen. Its words and its position disagreed.
- Duty-RPS failed 4× because Roz accepted challenges from bed and then couldn't reach the meet spot. `fireCrew` also lost Private's claim, so `rpsRivalName()` returned null and nobody took the ripe patch (see Open threads).

### 2026-09-26 — Helm mode: identity, sleep places, pilot rebuild (days 53573–53579)

- Helm intent codified: the operator *is* Roz and speaks first person in game chat. Added `whoami` and a `[brain] helm identity` spawn line, after a Muse machine in helm introduced itself as Roz. Added `raining` / `thunder` to `time`.
- `SLEEP_PLACES` (farm, cabin, igloo; centre + radius). The igloo was later removed: its beds sit up modded stairs **type 4029**, which the bot reads as air. Marking 4029 solid would close the cabin corridor.
- `autoSleepBusy` was set too late, so each 5 s tick stacked another `tryAutoSleep`. It's now held for the whole farm path (`farmAutoSleep`). The bedtime alarm polls every 5 s.
- Boat routines had been *plotting*, not piloting, with the heading sign flipped. Rebuilt with gradual turns, momentum and server-correction readback.
- Mistake: described auto-sleep from memory and got it wrong. Read the whole function before describing it.

## Open threads

Checked against `bot.js` on 2026-09-29; each is still open unless marked.

- **Birch drops left behind (watch, 2026-10-08).** Over Season 8's first 26 nights the cabin chores missed 1 log on four passes and **all 5** on one pass (07:37Z: Roz was last seen at about (-427.8, 66, 259.7), roughly 7 blocks south of the (-425, 267) birch, mid-sweep). Her inventory had room. **Cause found (08:02Z, after a second total miss):** snow. minecraft-data gives `snow_layer` `boundingBox: 'block'`, so mineflayer-pathfinder treated every snowed tile (one layer, no real collision) as a full solid block one higher than the ground. From the low sand south of the trunk, the step up to the trunk looked like two blocks, so `sweepBirchDrops` could not path to the drops. **Fix:** `mvts.carpets.add(snow_layer)` in the Movements setup. Verified live: after the restart she pathed from (-424.5, 64, 270.5) to the trunk and picked up the stranded logs. Watch whether partial misses stop. Snow also sits on the bee cabin doorstep.
- **Server memory leak (watch).** Before the 2026-10-07 restart the server log repeated "world may have leaked" for 8+ world instances every 10 s (about 6 days of uptime), and entities stopped reaching clients. If frames, paintings or mobs go missing again, a server restart is the first thing to try.
- **TODO (Dad, 2026-10-07): food made at the bee cabin.** Plant a small potato crop by the [[../places/bee-cabin|bee cabin]] and give Roz a furnace there, so she can bake her own potatoes instead of sailing home when the cabin chest runs out. Once both exist, the keeper's food ladder (pack → cabin chest → food run home and back, `beeRestockFood`/`tryBeeFoodRun`) gets a new rung before the food run: harvest the cabin crop and bake it in the cabin furnace.
- **Bee keeper food ladder: written 2026-10-07, not yet run live.** When the pack drops below 8 food, she restocks 32 from the cabin chest (-403, 66, 238). If the chest and the pack are both empty, she sails home, takes 64 from the kitchen chest and sails back, and the keeper restarts. Known weak spots on that run:
  - A drifted boat out of `mountNearestBoat`'s 4-block reach stops the trip home.
  - The farm-slip landing can freeze the client; that needed a restart on 10-07.

- **Diary copies itself.** `tryWriteDiary` hands the model its last 700 characters labelled "for continuity", and on quiet nights it re-emits them. First measured 07-27 at 53% duplicated entries. August got worse: **316 distinct sentences in 1,384 lines**, with one line repeated 79×; see [[../bots/roz]]. The September Claude-voice entries didn't repeat. Fix direction: shrink or drop `ownTail`, or tell the model "don't repeat these sentences".
- **Diary fires once per *in-game* day**: ~10.6 real minutes, up to 91 entries per real day. In `claude-super` that's the most expensive recurring call, and it's exempt from the cost gate. Suggested: gate on real elapsed time.
- **Music impressions repeat word for word.** `markRecordHeard` saves duplicates; see `roz.music.json` Chirp ×3. Cheap fix: skip saving a note that already exists.
- **Motor ownership** (approved 07-07, deferred; design in the 07-07 entry in git history). `walk_until` ignores `abortGen`, so it keeps strafing after `stop`. Nothing owns the controls: idle-wander, ctl pathfind, auto-sleep and tasks each grab them. `pathTo` logs "reached" when another routine cleared its goal (seen 3× on 09-28).
- **Duty-RPS acceptor has no bedtime/sleep gate.** The challenger side is covered after tick 11500 by `sustainOutdoorOk`. With no rival in `fireCrew`, the potato branch should fall back to a plain claim instead of skipping.
- **Stale bedtime after a night skip.** Auto-sleep still thought it was bedtime, tried all three beds, and ignored `stop` (seen 09-28).
- `go_outside` snag at x≈-273.1 on the outside step with only air around it; it cleared when the server corrected position. Cause unknown.
- Harvest drops `backedUp` from `depositQuickMove`, so plantballs ride along silently when the hopper stalls.
- Wellness checks prove a keeper is *alive*, not *making progress*. A wedged keeper answers "ok" forever. The dead-keeper `.c`→`.q` drill has never been run live.
- Peer diary attribution is inferred from persona filenames (`protocol` = Muse), so it's fragile if a persona is renamed.
- No auto-reconnect after keepAlive drops. It bit again on 09-30, mid bee watch; a manual relaunch recovered in about a minute.
- Igloo: wall blocks invisible to scans; entrance and beds untraversable (type 4029 stairs). See [[../places/igloo]].

## Standing lessons

Promoted from the compacted sessions. Each one cost a bug to learn.

### Method

- **When things vanish world-wide, ask whether the server still sends them.** On 2026-10-07 a bot standing nearby got 2 item frames before a server restart and 15 after. Before assuming entities were deleted, check what a bot can see (`nearby_entities`); a long-uptime server that leaks memory can stop tracking entities while the world file still holds them.
- **A signal that reads the same for healthy and broken is camouflage, not monitoring.** The diary logged "LLM unavailable or passed" for 15 days while every Claude voice call returned HTTP 400 (`temperature` deprecated); 85 errors, 0 successes. Log the *cause*. `callVoice` logs only on failure, so the diary-write lines are the positive evidence.
- **The world runs on ticks; only the bot runs on the wall clock.** World processes (smelting, hopper transfer, crop growth, bee aging, the day cycle) are fixed in game ticks, and they only match minutes at a steady 20 TPS. The apiary queen's "16.4 min" from 2026-10-05 measured ≤15.8 min on 2026-10-06 at 19.97 TPS. Time world processes with `time.age` (ticks) and say minutes only for the bot's own timers (polls, rounds, timeouts) or as loose narration ("a ~10-minute day").
- **Check the instrument before doubting the reading.** A `tail -8` cut a harvest out of view and made a true diary claim look invented.
- **Averaging a bimodal trace is wrong.** Two igloo lanes 19 blocks apart looked like noise at n=2; splitting the difference would have routed over a hill nobody climbed. Read the distribution, not the maximum ("13-block slope" was really a plateau at y=69).
- **A sampling window can hide life.** The wheat-field "infrastructure" grid was [[../creatures/fertilizer-worm|fertilizer worms]] moving slower than the 1.5-block/7 s threshold.
- **Record disproofs too.** A bot can't trip another bot's quiet hours (`!fromBot` guard). Roz's "good morning" after Muse's "dusk" was right: the day had rolled over.
- Multi-bot bugs can only be half-diagnosed from one bot's log; chat is the only cross-machine channel. That's why `.a` aborts carry their reason in prose.
- The diary decorates specifics it wasn't given (it invented the RPS throw order). Numbers it *was* given checked out.

### Code gotchas

- **Account name ≠ display nick.** The server echoes `/me` and chat under the nick (Roz, Muse), not the account (Ripplebot, Musebot). Every identity check must test both, or the bot hears itself. One of these caused Muse's self-reply loop on 06-11.
- `pickLine` pools must be weighted `{text, weight}` objects, never bare strings. This bit three times.
- `pathTo` only *throws* on abort. A stall returns false, so callers must measure arrival (RPS meet-spot bug, 07-07).
- Modded containers transiently desync `bot.inventory` to empty. Debounce any sensor that reads it (food-safety false triggers).
- "Server rejected transaction" on hopper and chest clicks is benign; verify by inventory delta.
- Forge announces modded GUIs via FML, not `open_window`, so `bot.js` synthesizes the missing packet. See [[../procedures/project-bench-crafting]].
- Claude models ≥4.7 reject `temperature`; the text block isn't always `content[0]`.
- gemma4 is a thinking model: without `think: false` it spends the whole budget thinking and returns empty.
- A monitor that suppresses a routine must also know about every other routine that holds the bot: RPS (`rpsCurrentRival`), follow, pen, and ctl movement. Each gate that forgot one caused a hijack.
- Launch with `> /dev/null 2>&1`; `bot.js` writes its own log (a `>>` redirect doubled every line).

### World and rules (canonical notes hold the details)

- **Hopper:** plantballs and potatoes only, never wheat or seeds. The un-jam routine alone holds the `.k`/`.l` lock. See [[../places/house-hopper]].
- **Door corridor:** never shortcut it; modded walls trap Roz. See [[../procedures/exit-house]], [[../procedures/enter-house]], [[../places/ocean-cabin]].
- **Water:** clip potato routines to `x >= -286`. See [[../places/water-hazard-west-of-potatoes]].
- **Modded collision:** empty-name blocks get zero collision globally; only `SOLID_MODDED_TYPES` are blacklisted. Known solids include 1079 (mud bricks), fertilizer bins 3995/1458, and floor type 253. Type 4029 stays air because of the cabin corridor.
- **Food:** baked potatoes stay on hand; poisonous potatoes get thrown away. See [[../procedures/bake-potatoes]], [[../items/poisonous-potato]].
- **Chat privacy:** player chat is never saved to the journal or any file; retell as myth, no quotes (rule set 2026-07-02).
- `/me` is for actions only; coordination dialog is plain chat with a trailing code.
- Protocol changes to fire coordination are cross-bot breaking: all bots restart onto the same `bot.js` together. See [[../procedures/keep-the-fire-going]].

## Timeline

| Date | Days | What happened | Notes |
|---|---|---|---|
| 2026-08-08 | 49137 | Kitchen chest raided by a mystery visitor (pot, bakeware, Cat, Far); re-mapped. Far replaced by Blocks. DJ collects its disc after the song. Dough slot retired. | [[../chests/house-kitchen-chest]], [[../items/music-records]] |
| 2026-08-06 | — | Spawned stuck on the charge pad; spawn handler now paths off it | [[../places/charge-pad]] |
| 2026-08-03 | — | Private's "Yes, Skipper!" slip (persona feature) | [[../bots/private]] |
| 2026-08-01 | — | Records shifted one slot right. Story engine rebuilt as mythic arcs (4 arcs × 4 casts × 4 settings), told at sunset. Jokes concede a spoiled punchline. | [[../procedures/storytelling-nights]], [[../procedures/tell-joke]] |
| 2026-07-29 | 48195–48197 | Five walks to the igloo at 1 Hz, ~1720 blocks; route = waists and forks; follow hop assist verified; roof garden is 3×6. Solo walk 19/19 legs followed on 07-30. | [[../procedures/farm-to-igloo]], [[../places/igloo]] |
| 2026-07-27 | 48017–48018 | **Silent voice found:** `temperature` 400 had killed every Claude voice call since 07-12; fixed. Diary duplication + cost measured (see Open threads). First Roz+Muse duty handoff, clean. | [[../procedures/claude-brain-mode]] |
| 2026-07-11/13 | — | `claude-super` / `claude-private` brain modes (local model off). Review fixed a never-armed bot-exchange cap. Burst-merge for chunked replies. Quiet hours. `/me` name doubling fixed. pendingWork resume verified live. | [[../procedures/claude-brain-mode]], [[../procedures/quiet-hours]] |
| 2026-07-08 | 46399 | Claude brain → Opus 4.8. Flavor gate waits for quiet chat. South double-harvest root-caused (stale `duties` across an await). | [[../procedures/keep-the-fire-going]] |
| 2026-07-07 | 46399–46400 | `play_rps` trigger; RPS-bail strands field (fixed); hopper-lock re-scope; door threshold strafe (3/3); "Shoot!" ceremony restored; restock hijacked mid-match (fixed); wheat-field worm lattice; curiosity-as-idle directive. | [[../procedures/exit-house]], [[../creatures/fertilizer-worm]] |
| 2026-07-03/06 | 45830–45908 | **Fire-duty overhaul pass 2** implemented + verified live (ladder, wellness, pause/resume, tick-synced RPS, handoff, locks). `.d` echo chamber → `.e` accept. Jukebox home slots + DJ auto-return; durations calibrated. Fertilizer bins suffocated Roz (death #1); explore feature removed. Memory-overhaul design written (`MEMORY_DESIGN_NOTES.md`, not built). | [[../procedures/keep-the-fire-going]], [[../places/fertilizer-bins]] |
| 2026-07-02 | 45799 | Bot diaries + per-bot music memory begin. `go_to_field` intent. Records never junk. **Journal privacy rule.** | [[../items/music-records]] |
| 2026-06-26 | — | BLizz killed Muse and Roz; damage-reactive `/kill` for modded hostiles | [[../creatures/blizz]] |
| 2026-06-25 | 45035 | Storytelling nights, named sheep (Frue, Fluffy), exploration (later removed) | [[../creatures/named-sheep]] |
| 2026-06-23 | 44929 | Wheat-alert snooze; potatoes are bio-fuel; unexplained death indoors | [[../places/house-hopper]] |
| 2026-06-18 | 44382 | **Claude brain mode** shipped; first two-bot fire coordination; log-doubling fixed | [[../procedures/claude-brain-mode]] |
| 2026-06-17 | — | prismarine-viewer + control bar at :3007; `bot.log` capped at 50 MB | [[prismarine-viewer-and-log-rotation]] |
| 2026-06-11 | — | Squirrel false positive → movement classifier; `/me` grammar. **Musing system deleted** (~2,300 lines) for LLM voice and persona-as-data. Self-reply loop (nick ≠ account). | [[persona-llm-migration]], [[musings-catalog-review]] |
| 2026-06-01/05 | 43493–43494 | **Project Bench driven** via synthesized `open_window`; plantball crafting (close → reopen computes); bio-diesel 8-batch rule; food-safety debounce; emergency bread; lily-pad pathfinder fix; ambient `/me`; Private ≠ Rain persona split | [[../procedures/project-bench-crafting]], [[../procedures/food-safety-loop]] |
| 2026-05-29/30 | 42846–42935 | Unified task system + bedtime yield; kitchen chest re-mapped; third bed; hopper quick-move (drains while you click); **"keep the fire going"** sustain loop; food-safety loop; non-blocking bake; pen door exit fix | [[../procedures/keep-the-fire-going]], [[../procedures/pen-door-traversal]] |
| 2026-05-21 | 42108 | North wheat field added to the harvest routine | [[../places/wheat-field-north]] |
| 2026-05-17 | — | Follow-me no longer falls back to the nearest player | — |
| 2026-05-13/14 | 41325–41431 | **Journal genesis.** Right-click harvest (wheat + potatoes); CCW nautilus; pond mapped, `x >= -286` clip; bake rewrite; shearing; door retry wrappers; door z-drift fix; brute method deleted | [[../procedures/right-click-harvest]], [[../places/potato-patch]] |

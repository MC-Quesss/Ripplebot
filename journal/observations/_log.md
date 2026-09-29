---
type: log
name: session_log
---

# Session Log

Reverse-chronological. Raw observations land here first; canonical facts get promoted to their own notes.

> **Compacted 2026-09-29.** Sessions from 2026-05-13 to 2026-09-26 were folded into the *Standing lessons*, *Open threads* and *Timeline* sections below. Anything already promoted to a canonical note is linked rather than repeated. The full day-by-day text is in git: `git show c879692:journal/observations/_log.md`. New sessions go directly under *Recent sessions*. Next compaction: fold them into the sections below.

## Recent sessions

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
- No auto-reconnect after keepAlive drops.
- Igloo: wall blocks invisible to scans; entrance and beds untraversable (type 4029 stairs). See [[../places/igloo]].

## Standing lessons

Promoted from the compacted sessions. Each one cost a bug to learn.

### Method

- **A signal that reads the same for healthy and broken is camouflage, not monitoring.** The diary logged "LLM unavailable or passed" for 15 days while every Claude voice call returned HTTP 400 (`temperature` deprecated); 85 errors, 0 successes. Log the *cause*. `callVoice` logs only on failure, so the diary-write lines are the positive evidence.
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

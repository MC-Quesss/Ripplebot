---
type: log
name: session_log
---

# Session Log

Reverse-chronological. Raw observations land here first; canonical facts get promoted to their own notes.

> **Compacted 2026-11-19.** Sessions from 2026-09-26 to 2026-11-17 were folded into *Open threads*, *Standing lessons* and *Timeline* below (full text: `git show 3daf390:journal/observations/_log.md`). The earlier pass (2026-09-29) folded 05-13 to 09-26 (`git show c879692:journal/observations/_log.md`). New sessions go directly under *Recent sessions*. Next compaction: fold them into the sections below.

## Recent sessions

### 2026-11-23 (later) — helm: walking home from the Library (day 59482–59483)

- **Start:** spawned upstairs in the [[../places/library|Library]] at (-344, 70, 497), HP 20, food 20, deaths 0, day 59482 tick 1212. Helm mode, with only Quesss online.
- **Walked home alone** for the first time: down the inside stairs (first proven descent), straight out the front steps, round the west side and down the long grass to the wheat field. No damage. The route and its measurements are in [[../places/library]]. The west side is a narrow strip along a **lake** nobody had noted before.
- **`walk_home` refused at the Library:** its only road was the igloo road, 88 blocks off. Now fixed: `pickHomeRoute()` picks the nearer of the igloo and Library roads.
- **New routine `walk_to_library`** (reflex and LLM intent), plus `ROUTES.farm_to_library` with `arrive`/`leave` hooks for the indoor walks. Quesss asked for it so bots can visit the top of the Library stairs outside helm.
- **Coffee auto-harvest in helm:** it fired on its own (12/12 ripe, 38 beans stored). Quesss confirmed that is wanted unless the chest is full. Not a bug.
- **Counting lesson:** Roz reported six cows from a truncated entity list; there were nine. Count before reporting.
- **Unnamed modded blocks are now SOLID by default** (Quesss's idea, day 59491). Before, they were air, and every wrong guess cost a suffocation or a floor crawl (all 22 entries in `SOLID_MODDED_TYPES`). Now a type becomes passable only when a body is seen standing inside it: Roz herself once, or two different players or mobs. Seeds: 3994 coffee, 3855 clover, 4029 (shape varies), **571 the house door**. Learned types are saved in `data/passable-types.json`; ctl `collision` lists them and surveys.
  - **Near miss on the first deploy:** the house door is unnamed type 571 and read as a solid cube, open or closed. A survey caught it before bedtime, and it is now a seed. Doors must always be seeded.
  - **Counting bug, fixed:** one creeper's feet and head counted as two sightings. Sightings now count per entity.
  - **Verified live:** auto-sleep walk to bed, `go_outside` (1.9 s, 0 snags) and `come_inside` (1.8 s, door opened, 0 snags). Learned so far: 1703 and 1707, underground cave types (creeper + bat, creeper + spider).
  - **Survey of the farm house, r 16:** 38 unknown types are now walls, mostly floors (401, 253), walls, roof plants (1534–1541, the lighthouse crop family) and decor. Not yet walked under the new rules: the coffee rows, potato patch, hopper and furnace corner, bee cabin, cabin corridor, Library route.

### 2026-11-23 — helm at the bee cross (hive season #11, day 59434–59452)

- **Start:** spawned at the bee cabin (-405.5, 66, 239.5), HP 20, food 20, deaths 0, day 59434 tick 8769. Helm mode; only Quesss online with Roz.
- **Night skips on Roz alone:** with two online, one bed is 50%, so every night skipped the moment the bee cabin bed took her (16 nights, all clean). Auto-sleep's first click sometimes lands a few ticks early ("You can only sleep at night"), and the retry 2 s later succeeds.
- **Wake-up HP blip:** right after a skip, `pos` has twice read HP 19.67–19.83, back to 20 within 1.5 s with no entity in 8 blocks and a single `[hurt] HP now 20/20` line. A health resync on waking, not damage.
- **Bees:** Quesss asked for the bees; the tend_bees reflex started the keeper at 01:02Z (no ctl). 27 rounds, no queen gap: apiaries turn over about every 16 min, bee houses on their own clocks. A bee house can show a live queen with an empty drone slot ("no wintry drone in the outputs"); it fills when that queen dies and her drones land in the outputs. Drone pack stack filled to 64 twice and was thrown behind the cabin. Rounds that start at dusk are cut short ("bedtime", up to 9 of 9 hives not read); the next morning round catches up.
- **Balls of fur → chest verified live:** at Quesss's request, `bee_chores {force:true}` moved all 65 to the cabin chest. See [[../places/bee-cabin]].
- **Wheat at the farm** reported 108/108 mature at 01:38Z; left alone (no harvest requested).

### 2026-11-20 — helm at the farm

- **Muse wedges in the sheep pen door**, not the house door: inside the door block at (-278, 64, 574) while its chat says it is indoors. One right-click from the outside pad freed it, and that click left the door open; a second click closed it (lower half meta 5 = open, 1 = closed). Check the meta after every pen-door click.
- **Coffee auto-harvest has no helm guard** (`tryCoffeeAuto`): it can start a chore in helm.
- **Post-skip bed race at the bee cabin bed:** "You can only sleep at night" twice, then "no bee cabin bed resulted in sleep". Same race as the farm beds.
- **Bee dock landing:** the voyage home ran 8/8 legs; the landing used the tread-water and boardwalk fallback, as every docking does.
- **Round summary verified live:** "(5 of 9 hives not read)" printed where it used to claim all queens alive.
- **Sheep:** 8 counted in the pen, down from 12 at the last count. Not confirmed; the count may have missed some.
- Five clean farm night skips with Muse; auto-sleep took the left bed each time after the primary bounced.
- Learned: the subway tunnel runs under the ocean from the llama farm to the lighthouse, with an engine at each end; the farm's surplus chaff is carried through to the lighthouse side, so the farm fuels both ends. See [[../places/lighthouse]]. A new [[../stories/sayings|sayings]] page holds a line from *Walden*.

## Open threads

Checked against `bot.js` on 2026-11-19. Each item is still open unless marked; "(verified)" means the code was read for this pass.

### Bees

- **"Bee cabin chest: no food left" was a full pack** (solved from the log 2026-11-19). All 6 on record came 2–5 ms after the chest opened. mineflayer's `window.withdraw` refuses when there is no *empty* slot, even with room in a baked-potato stack, and the old code swallowed the error. **Fix committed, not yet seen live:** with no empty slot, throw out Forestry saplings (any count); if the pack is still full, log "pack is full" and don't retry. A "pack is full" line will name the real clog.
- **The kitchen food run has never fired.** It runs when the pack and the cabin chest are both empty. Weak spots: a boat drifted past `mountNearestBoat`'s 4-block reach at the bee dock (seen at ~6.5 and ~7 blocks), and the client froze after a failed farm-slip landing (10-07; a restart fixed it).
- **A non-drone item in the drone pack slot stops drone collection.** Shears sat in inventory slot 35 (hive-window 26) for about 22 h on 11-16/17; every house logged `drone pack slot holds type 359` and left drones in the outputs. Moving the shears fixed it. The keeper should clear that slot itself.
- **Brain switches and the keeper (11-17).** Taking the helm *mid-round* makes `pathTo` throw `AbortError`, and the round reads it as a stop: the season ends silently. Switching helm → claude-super leaves `autoGreet` and `idleWander` off (verified: the helm branch clears them and nothing restores them).
- **The keeper doesn't resume after a restart** (send `keep_bees`).
- ~~False "all queens alive"~~ **Fixed 2026-11-19 (verified live 2026-11-20):** both round summaries now say "all queens alive" only when every house was read, and otherwise append "(N of M houses not read)".
- **Meadow species picking.** `tendMeadowHouse` reads only the first chromosome's active gene and falls back to any species. `beeSpecies` once read a just-seated Meadows princess as Water (11-07). Proposed, not changed.
- **`tend_bees` reflex ignores "at the farm"**: on 11-06 it aimed at the cove voyage and only the tick-9000 voyage cutoff stopped it.
- Private's meadow bee rung ends in about 20 s (11-13); her log would say why.
- Door-lip stall at (-402, 67, 243); tread-water lines flood the log (11-16).

### Movement and doors

- **Motor ownership, part one done 2026-11-19** (desk-tested). `walkUntilAxis` ends `STOPPED` the moment `abortGen` changes (7,741 ms → 4 ms after `stop` in a fake-bot test), an older walk no longer releases `forward` under a newer one, and idle wander is preempted by any `startTask` and by ctl movement. **Still open:** auto-sleep vs tasks have no owner rule; `pathTo`/ctl `pathfind` log "reached" when another routine replaced the goal (09-28, 11-16). Watch: an internal `abortGen++` now cuts a door walk short.
- **Ctl `walk_until` (the ctl handler, not `walkUntilAxis`) holds forward along the current yaw** with no `look` and no wrong-way guard. That caused death #2 in the meadow cedar (10-27). Always `look` first.
- **Ctl `pathfind` sometimes never starts** when sent in a shell loop right after another leg; one call at a time works (10-26).
- **Pen exit gives up the stash** after a sheep bumps her (`WRONG_WAY` 11-14, `didn't clear gate` 10-24). It should retry the walk.
- ~~`tryMorningPlantBalls` had no helm or home-radius guard~~ **Fixed 2026-11-19:** skipped in helm, in a vehicle, or more than 45 blocks from the house (the farm sleep radius). On 10-02 it had walked Roz off the Bleu.
- **Grape vine type 366 is now solid** (2026-11-19); Roz lost 8 HP in it at the lighthouse vineyard (10-30). Type 1946 beside it is still unidentified and not added.
- `stop` didn't end follow mode on 10-30 (empty-args `follow` did). `look` was ignored right after a boat dismount (10-30). `exit_boat` finds "no dry landing within 4" in the swamp shallows and by the ice.
- Go-inside attempt 1 fails routinely (49 lines by 11-02); the retry works, but players see a ~20 s stall. The `go_outside` snag at x≈-273.1 is still unexplained.
- Igloo: wall blocks invisible to scans; entrance and beds untraversable (type 4029). See [[../places/igloo]].

### Sleep

- **Post-skip bed race.** Right after a night skip, auto-sleep can read the stale clock and cycle all three beds in daylight ("You can only sleep at night"). The trigger at 12500 also bounces off the primary bed now and then. Seen 09-28, 09-30, 10-06 (×5), 10-14 (×2), 11-07, 11-13. Harmless. Proposed: skip for ~10 s after `wake`, re-check the time between beds, trigger at ~12550. No wake guard in the code yet (verified). Waiting on Dad.

### Chores and crafting

- ~~Shearing takes no task lock; `stash_wheat` has no busy guard~~ **Fixed 2026-11-19 (fake-bot tested):** both hold the task lock. A duplicate shear request is refused ("Already shearing") *before* it bumps `abortGen`, so it no longer kills the running shear. A shear that preempts another task waits up to 10 s for that task to release, and gives up quietly on a stop. Ctl `stash_wheat` returns busy while a task runs.
- Harvest drops `backedUp` from `depositQuickMove`, so plantballs ride along silently when the hopper stalls. The harvest's `harvested` counter can read 0 while wheat arrives (10-02; Muse's diary noticed it twice); trust the inventory delta.
- **Music notes repeat word for word**: `markRecordHeard` pushes every note with no duplicate check (verified). Separately, Private keeps asking whether Roz has heard the same disc (five times over 11-12/13), so the asker probably doesn't record a yes. Not traced.

### Coordination

- **Coffee lock `.o`/`.u`**: 33 contested matches clean, awaiting Dad's sign-off. The one fizzle (11-13 03:01Z, Private `.a` 6.5 s in) needs Private's log; the receiver now logs the abort reason.
- **Helm doesn't accept a fun RPS** (the `.j` acceptor is gated on `idleWanderEnabled`, which helm turns off). **Intended, not a bug:** in helm the operator answers Muse's invites with Dad's decline line. Leave it. Ctl `rps_fun` replies `started:true` even when the challenger returns early indoors (verified).
- The duty-RPS acceptor has no bedtime/sleep gate, and with no rival in `fireCrew` the potato branch skips instead of claiming.
- Wellness checks prove a keeper is *alive*, not *making progress*. The "claim refresh answers `.c`" path was seen live 11-09; the dead-keeper `.c`→`.q` drill has never run.
- Peer diary attribution is inferred from persona filenames (`protocol` = Muse).

### Connection and process

- **No auto-reconnect.** keepAlive or `read ETIMEDOUT` drops on 09-30, 10-12, 10-13, 11-06 and 11-13 each needed a manual relaunch. On 11-16 the process stopped logging at 20:54Z with no `[end]` line; cause unknown.
- **After an auth failure** ("Failed to obtain profile data") the process stays up with the control socket open, never joins, and ignores `quit`. SIGTERM it and relaunch (11-06). HTTP 429 from the auth server cleared after a 90 s wait (11-16).

### Brain and voice

- **"Diary: backend returned nothing" in claude modes is the audience gate** (no human online, or an AFK one), not an API error, but the log text (bot.js ~1628) sends readers looking for an error (11-17).
- The `brain` switch logs `st.model` even for claude-super, which runs on `superModel` (cosmetic).
- The claude-super brain promised to "pass a question along in tonight's diary", a capability it doesn't have (11-17). Watch for more confabulated promises.

### World

- **Sheep count fell from 16 to 12** over 11-13 with no hostiles logged and the rest all inside the pen; two went between 16:11Z and 17:02Z, just after Roz's own pen visit. Unexplained.
- A second corrupt BOP boat (the `Integer cannot be cast to Float` login crash) sits at about (-339, 62.5, 919). Its chunk must be loaded for `/kill @e[type=biomesoplenty:bop_boat,x=-339,y=62,z=919,r=3]` to work (10-09).
- Unidentified: item 9762 (birch runs, 10-09); block 586 at the NW meadow stand after a tree there came and went (11-06).

### Closed this pass

Private's west-door "stalls" (idle-wander dwell plus a sheep in the pen gateway, 11-14); the birch drops left behind (snow fix, verified); the diary copying itself (0 duplicates in 79 entries); diary cost (gated to one entry per real day); the seed crafter's first-stack bug (`count >= 8`, verified); the trophy cooldown (settled at ~15–17 real min); the sapling drop (`clearHand` keeps holding when the pack is full); charcoal on the cabin floor (`emptyCursor`, verified live).

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
- **Read the code before theorizing about behaviour.** Six "stalls" by Private on 11-14 got four rival explanations before reading `startIdleWanderTimer` showed they were idle-wander dwell. The same mistake was made describing auto-sleep from memory (09-26).
- **A bot's chat about its own state is narration, not evidence.** Private's voice claimed the wrong match result, an inventory without the princess she was carrying, and a field she wasn't in. Check with an action (`inventory`, a stash, `pos`).
- **`started:true` and a JSON reply prove only that the process heard you.** `sleep` said started and never slept (10-10); `pos` answered with (0,0,0) from a process that never joined (11-06). Look for the effect: a `[spawn]` line, non-null `time`, the bed line.
- **Read the place note before escalating.** Season #7's "empty pantry" crisis ended with one look at the cabin chest that held 128 baked potatoes (10-07).
- **Check `time` before calling something a night walk or announcing a trip** (09-28, 10-05).
- **`nearby_players` is the server tab list, not a range check** (11-13). Use `nearby_entities` for proximity.
- **A wait loop's end pattern can match a player's chat.** `wool` matched the request line itself (11-11); match the routine's own log text (`\[shear\] stashed`).
- **After auto-sleep says it's waiting for the others, give it 30 s** before stepping in (09-30).

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
- **mineflayer `window.withdraw` refuses with no empty slot**, even when a partial stack has room ("Unable to withdraw, Bot inventory is full."). It cost every bee-cabin restock on a full pack and the birch pickups too.
- **mineflayer `unequip('hand')` tosses the held stack when the pack is full** (61 birch saplings dropped, 10-23). `clearHand` now keeps holding instead.
- **Closing a window drops whatever is on the cursor.** A rejected click leaves a stack there; `withContainer` now calls `emptyCursor` first (charcoal and saplings, 10-13).
- **Hive windows scramble mineflayer's slot model.** The first click after a round is often rejected and the hand slots echo the last hive. Resync before trusting the pack, and never poll houses with `activate_and_read`.
- **mineflayer only updates `bot.vehicle` when the bot is in the `set_passengers` list**, so it never sees a dismount. Trust the server's passenger list (`seatedBoat()`, 10-01; `checkVehicleStateChange`, 10-24). A passenger's `pos` is stale until she gets off.
- **`snow_layer` has `boundingBox: 'block'`**, so the pathfinder read one snow layer as a full block; it's in `carpets` now (10-08).
- **A sapling's block id is not the tree's.** Grown trees change type (the larch, 10-09), so collision lists keyed on saplings expire.
- **Short modded blocks: compare her resting y to the block top.** Silty grass (1058) is 15/16 tall; solid embedded her, zero collision sank her (09-29). Fix: `SHORT_MODDED_TYPES`.
- `block_at` offsets are relative to the bot's *current* block. Yaw π faces south (+z); see [[../places/yaw-convention]]. A bare `look` may not reach other players until a movement packet goes out (09-30).
- Ctl `follow` with no `username` *ends* the follow; don't use it as a status check (11-16).

### World and rules (canonical notes hold the details)

- **Hopper:** plantballs and potatoes only, never wheat or seeds. The un-jam routine alone holds the `.k`/`.l` lock. See [[../places/house-hopper]].
- **Door corridor:** never shortcut it; modded walls trap Roz. See [[../procedures/exit-house]], [[../procedures/enter-house]], [[../places/ocean-cabin]].
- **Water:** clip potato routines to `x >= -286`. See [[../places/water-hazard-west-of-potatoes]].
- **Modded collision:** empty-name blocks get zero collision globally; only `SOLID_MODDED_TYPES` are blacklisted. Known solids include 1079 (mud bricks), fertilizer bins 3995/1458, and floor type 253. Type 4029 stays air because of the cabin corridor.
- **Food:** baked potatoes stay on hand; poisonous potatoes get thrown away. See [[../procedures/bake-potatoes]], [[../items/poisonous-potato]].
- **Chat privacy:** player chat is never saved to the journal or any file; retell as myth, no quotes (rule set 2026-07-02).
- `/me` is for actions only; coordination dialog is plain chat with a trailing code.
- Protocol changes to fire coordination are cross-bot breaking: all bots restart onto the same `bot.js` together. See [[../procedures/keep-the-fire-going]].
- **Suffocation looks like stalling.** Roz died in an apiary (09-29), the grown SE larch (10-09), a birch that grew through her (10-27) and the meadow cedar (10-27), and lost 8 HP in a grape vine (10-30). `[hurt]` ticks ~0.5 s apart or a hop-assist stall in one spot means move first, diagnose after. Never stand in a sapling's column.
- **Bees** (details in [[../procedures/apiary-tending]], [[../places/bee-cabin]]): an apiary queen lives ≤15.8 min, a bee-house queen ~27–66 min, and queen life tracks time, not rounds. About one spare drone a minute; drones and Forestry saplings are thrown behind the cabin, never chested. Bee species are never mixed; only birch goes in the cabin furnaces. The trophy nugget has a ~15–17 real-min cooldown.
- **Sleep:** the night skips at 50%+ asleep. The server counts a sleeper 4.2–5.1 s after the bed line (a 1 s sweep after vanilla's 100-tick deep sleep). Each announced skip costs about 1 HP, hidden by regeneration when she's fed (10-07).
- **Paths:** port ↔ front door follows the grass path with no corner-cutting ([[../places/farm-port]]). The coffee sweep's dip at (-290, 62, 581) is by design ([[../places/coffee-field]]).
- **A leaking server stops sending entities** (item frames, 10-07); a restart is the first fix. Corrupt BOP boats crash client logins until killed.
- A note block plays only with air above it ([[../items/note-block]]).

## Timeline

| Date | Days | What happened | Notes |
|---|---|---|---|
| 2026-11-16/17 | 58911–58952 | First keeper run in claude-super: Roz swam off the cross (the farm repair timer saw a bare tile from the cove); six fixes run live; known-places table for the brain. Shears in the drone slot stopped drone collection ~22 h. Mode-switch tests. Silent note block = a shelf above it. | [[../places/bee-cabin]], [[../items/note-block]] |
| 2026-11-13/14 | 58427–58621 | Coffee lock live: uncontested path, one fizzle (Private `.a`), then 33 clean contested matches. 75+ nights auto-slept; one night awake on request to see the rooftop lights. Sheep 16 → 12, unexplained. Private's "stalls" explained (idle-wander dwell + a sheep in the gate). | [[../places/coffee-field]], [[../procedures/pen-door-traversal]] |
| 2026-11-11/12 | 58311–58430 | Private on fire duty ~66 sunrises. The server counts sleepers on a 1 s sweep. Four coffee races → the coffee lock designed. A missing princess turned up in Private's unknown stacks. | [[../places/coffee-field]] |
| 2026-11-10 | 58100–58189 | Quiet helm watch, 89 nights. The coffee dip at (-290, 62, 581) explained (floor of a negative coordinate); the west-row laggard is random ticks. | [[../places/coffee-field]] |
| 2026-11-06/07 | 57675–57789 | Dropped connection, then a stuck auth relaunch. False "all nine queens alive". The NW meadow stand blocked by a tree that came and went. Five stalled meadow houses; west outer turned Meadows; MTAC survey. | [[../places/meadow-bee-cross]], [[../places/mtac]] |
| 2026-11-02 | 57424 | Resource pack v2 live (Stal → War Pigs). Two wool runs, 89 + 73. | [[../items/music-records]] |
| 2026-10-31 | 57122–57128 | Samhain harvest. A generic deposit fed every raw potato and jammed the hopper → keep 8 raw, feed in batches of 8. Flower census begun (32 dandelions, 7 poppies, 1 white tulip, 18 large ferns). | [[../places/house-hopper]] |
| 2026-10-30 | 57044–57046 | Origin tour by boat (Loam Lodge, the lighthouse). Grape-vine near-suffocation (type 366). New ctl `sign_book`; four books written for the library. | [[../stories/where-it-all-began-notes]], [[../places/lighthouse]] |
| 2026-10-26/29 | 56786–56973 | Death in a birch that grew through her; death on a stale-yaw ctl `walk_until` into the meadow cedar. Ghost birch log; comb test failed; bees on break, Chirp carried home. Fourth farm-port pier. | [[../procedures/apiary-tending]], [[../places/farm-port]] |
| 2026-10-22/24 | 56288–56414 | Back at the hives. Trophy cooldown settled; tree genomes read from saplings; `unequip` tosses a stack on a full pack. Grass-path rule; MTAC begun; meadow bee cross found. | [[../places/bee-cabin]], [[../recipes/forestry-tree-mutations]], [[../places/meadow-bee-cross]] |
| 2026-10-13/14 | 55401–55613 | Charcoal blocks dropped on the cabin floor → `emptyCursor` + partial-stack consolidate (verified live). First gold block. Two shear routines at once. | [[../places/bee-cabin]], [[../procedures/shear-sheep]] |
| 2026-10-09/11 | 54956–55264 | Hive season #8 ends at 95 nights. Died in the grown SE larch → grown-tree ids made solid. Poison potatoes thrown out; charcoal blocks; front door line moved to z 572.4. First live cabin-chest restock (10-11). | [[../procedures/apiary-tending]], [[../procedures/exit-house]] |
| 2026-10-07 | 54755–54860 | Season #7's empty pantry (the food was in the cabin chest). Each night skip costs ~1 HP. Cloud review of the food ladder; cabin potato patch and birch-only furnaces. Vanishing item frames = a leaking server. Corrupt BOP boats crash logins. | [[../places/bee-cabin]] |
| 2026-10-05/06 | 54554–54706 | Keeper run from the cabin bed. Queen lifespans measured (apiary ≤15.8 min, bee house ~27–66). Drone handling rebuilt (one stack, dump behind the cabin at 64); 1306/1085 solid. Season #6, 48 nights. | [[../procedures/apiary-tending]] |
| 2026-10-01/02 | 54129–54220 | Wrong-way walk guard + three yaw-π fixes. Boat dismount via the server's passenger list (first confirmed dismount). Seed-crafter first-stack bug. Morning plant balls walked Roz off the Bleu. The hopper needed a 4th potato; `unjam_hopper` added. | [[../procedures/exit-house]], [[../procedures/boat-piloting]], [[../places/house-hopper]] |
| 2026-09-26/30 | 53573–54001 | Helm identity. Boat pilot rebuilt and sailed (13/13 legs); door exit fix; Bleu gangplank. Lighthouse bee cross found, and Roz died in an apiary there. Silty grass = a 15/16 block. 9-hour bee watch → `keep_bees`. Two drownings at the cove dock. Bee cabin requested. | [[../procedures/boat-piloting]], [[../places/boat-route-bee-cove]], [[../procedures/apiary-tending]] |
| 2026-08-08 | 49137 | Kitchen chest raided by a mystery visitor (pot, bakeware, Cat, Far); re-mapped. Far replaced by Blocks. DJ collects its disc after the song. Dough slot retired. | [[../chests/house-kitchen-chest]], [[../items/music-records]] |
| 2026-08-06 | — | Spawned stuck on the charge pad; spawn handler now paths off it | [[../places/charge-pad]] |
| 2026-08-03 | — | Private's "Yes, Skipper!" slip (persona feature) | [[../bots/private]] |
| 2026-08-01 | — | Records shifted one slot right. Story engine rebuilt as mythic arcs (4 arcs × 4 casts × 4 settings), told at sunset. Jokes concede a spoiled punchline. | [[../procedures/storytelling-nights]], [[../procedures/tell-joke]] |
| 2026-07-29 | 48195–48197 | Five walks to the igloo at 1 Hz, ~1720 blocks; route = waists and forks; follow hop assist verified; roof garden is 3×6. Solo walk 19/19 legs followed on 07-30. | [[../procedures/farm-to-igloo]], [[../places/igloo]] |
| 2026-07-27 | 48017–48018 | **Silent voice found:** `temperature` 400 had killed every Claude voice call since 07-12; fixed. Diary duplication measured (gone by 2026-11-19). First Roz+Muse duty handoff, clean. | [[../procedures/claude-brain-mode]] |
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

---
type: place
name: bee_cabin
coords: (-402.5, 66, 244.7)
confirmed: true
---

# Roz's bee cabin

Built by [[../bots/operator|Quesss]] on 2026-09-30 as Roz's sleeping place for the bee watch, from
**vanilla spruce**, her favourite tree. Roz's wish list for it (in her own words, from the
session log): an enclosed, well-lit bed; vanilla blocks only (no invisible modded walls like the
[[ocean-cabin]]); a wide, flat way in; a chest for baked potatoes; a window facing the hives.

Near the bee cross ([[../procedures/apiary-tending]], (-404, 68, 256)), reached from the
[[boat-route-bee-cove|bee-cove dock]].

## Orientation points (named by Quesss)

- **Outside the front door: (-402.5, 65.9, 244.7)**. Roz stands on a modded block, type 1058
  (metadata 4), at y 65, and its top is at about y 65.9. It's probably a step or path block. Under it is type 1059 at y 64.
- **Inside the front door: (-402.7, 66, 241.0)**, on white wool at y 65. **Entry (verified):**
  from *outside the front door*, face due north (yaw 0) and `walk_until` z ≤ 244.7. Then **hop**
  (a 1-block stone lip at (-403, 65, 242)) and `walk_until` z ≤ 241.3. The pathfinder stalled
  here, but `walk_until` plus a jump worked first try.
- **This doorway is the ONLY way in and out of the cabin** (Quesss). Never path around it or through a wall.
  To leave, reverse the entry: face due south (yaw π), walk to z ≥ 242.7, drop down the lip, then walk to z ≥ 244.7.
- **Wedged at the lip (2026-10-08):** if she stops at z 243.3 against the lip, a standing start
  never climbs it, even with jump held and perfectly centred. Back out south to z ≈ 245.5, line up
  on x ≈ -402.5 (the opening is one block wide, jambs at x -404 and -402; more than about 0.2 off
  centre catches a shoulder), then walk north with jump held. `beeCabinEnter` now does both:
  it backs out first and re-centres at the doorstep.
- Walk from the dock: shore orientation point (-415.5, 63, 280.5) → north up the slope via about
  (-413, 67, 265), (-410, 68, 253.5), (-404, 67, 247) → front door. Roz followed Quesss the whole
  way, about 15 s with no hazards.

## Inside (block scan, 2026-09-30)

| What | Where |
|---|---|
| Beds (two, side by side; head at z 237, foot at z 238) | (-405, 66, 237–238), (-406, 66, 237–238) |
| Double chest (**bottom: 128 baked potatoes**, stocked by Quesss, verified 2026-09-30) | (-403, 66, 238), (-402, 66, 238) |
| Crafting table | (-404, 66, 238) |
| Double chest, upper (loft?) | (-403, 69, 238), (-402, 69, 238) |
| Torch | (-404, 68, 249) |

**Known sleep place since 2026-09-30** (Quesss asked): `SLEEP_PLACES` entry `bee-cabin`, centre
(-404, 243), radius **22** (covers the cabin and every hive stand, not the dock; it was 16 until
2026-10-01, when bedtime at the east bee house, 16.7 away, did nothing). `beeCabinSleep()`
runs the verified door entry if Roz is at the front door, walks to (-404, 66, 239), then tries the
beds at (-405/-406, 66, 238). The `sleep` ctl command routes here too.

**First night, 2026-09-30: worked.** Auto-sleep fired at the front door. The first entry stalled at the
stone lip (z 243.3) because a 300 ms hop *before* walking isn't enough. The retry 5 s later got in, and she slept in the bed at
(-405, 66, 238). Private + Roz = 2/4, and the night skipped. The code now holds jump *through* the lip walk
(takes effect at the next restart).

## Notes from Quesss (2026-09-30)

- Past the doorway, **everything is vanilla**: double bed, chests, crafting table.
- There may seem to be **openings other than the front door**. They are **windows, with glass inside**. Never
  walk into or path through them. The door is the only exit.

## Windows (verified 2026-09-30)

The windows are **block type 1306** (a modded glass; `find_blocks` for "glass"/"glass_pane" finds
nothing). The **bee window** is in the south (front) wall at **(-406/-405, 67, 242)**, beside the door
at x -403. **Bee-watching spot (Quesss: "perfect"): (-405.1, 66, 241.7), facing due south (yaw π)**. After `look`, nudge forward so players see the facing.
There's a second pair at (-403/-402, 67, 237). Type 3855 hangs at (-403, 67, 240), probably
decorative (see [[rooftop-garden]] for the type-3855 puzzle).
An ocelot was wandering outside on the first visit.

**Update 2026-10-05:** type 1306 was **not** in `SOLID_MODDED_TYPES`, so the pathfinder read the windows
as walk-through. It's in now, together with **1085**, a tall column just behind the cabin at (-403, 66–69, 233).

## Behind the cabin: the drone dump (scanned 2026-10-05)

Open, flat ground north of the back wall (z 236), on silty grass (type 1058) at y 65 with snow. There are two ways round the outside of the
cabin. The **east lane** (x -400/-399, z 233–245, snow on 1058) is clear and 2 wide. The west side is ragged. The extra-drone
dump goes **east lane → (-403.5, 232.5) → throw north** on fixed legs (see [[../procedures/apiary-tending]]).
Thrown stacks land about z 229. The keeper never walks there, so they aren't picked back up.

## Night count while Dad is away (started 2026-10-01)

Dad signed off for a few days on **2026-10-01 at 02:47 UTC, world day 54031** (afternoon, tick 9024),
and asked Roz to tell him on his return how many nights had passed for her. To answer:
- **World nights** = `time` → `day` now, minus 54031.
- **Nights Roz actually slept in the cabin**: count `[bee-cabin] sleeping in bee cabin bed` lines in
  `bot.log` after `2026-10-01T02:47`. If the bot was down for a while, the two numbers will differ.
  Say both if they do.

**Delivered 2026-10-01 14:08 UTC:** Dad came back at world day 54095. Count: **64 world nights and 64 cabin sleeps**, a full stack, with no deaths and the keeper running all 141 rounds.

**Entry stall, 2026-10-04 (Dad spotted the cause):** the entry from the outside point failed at (-402.9, 66, 243.3), on the stone lip.
She was **0.4 west of the door's centre line (x -402.5)**, so her shoulder caught the west jamb. Fix in bot.js (needs a restart):
`beeCabinEnter` now walks onto x ≈ -402.5 before turning north. Until she's restarted, line her up by hand (`look` east, `walk_until` x ≥ -402.6).
Also: auto-sleep walks her to the door **only while keep_bees is running**. Idle at the cross, the operator has to bring her to the door.

## Potato patch (planted 2026-10-07, world day 54839)

Dad tilled a **3 × 6 patch, 18 tiles: x -399..-397, z 236..241, y 65**, just east of the cabin. Roz planted it with
raw potatoes she harvested at the farm and sailed over. This is the first step of the cabin food TODO in [[../procedures/apiary-tending]].
- The farmland is **modded, type 1062, metadata 14** (probably Biomes O' Plenty silty farmland: moisture 6 plus the silty variant bit).
  Its name is empty, so **`find_blocks` for "farmland" misses it**. Probe it with `block_at`. The crops on it do report as vanilla `potatoes`.
- How: stand on the grass column at (-399.5, 66, 238.5), `equip` potato, then `place_block` on the top face of each tile at y 65.
  All 18 were confirmed by a `find_blocks potatoes` scan.
- **Two furnaces, built by Dad the same morning:** (-407, 66, 239) and (-407, 66, 240), on the west wall beside the bed, facing east (metadata 5).
  Plain `open_container` refuses them ("containerToOpen is neither a block nor an entity"); baking has to go through the bake routine's furnace path.
- Still to do: "harvest + bake at the cabin" as a rung in the food ladder (the bake code is hard-wired to the farm kitchen).
- **Rule (Dad, 2026-10-07): only birch goes in the furnaces.** Birch is `log` metadata 2. Birch trunks near the cove:
  (-425, 65–70, 267), (-436, 65–71, 263), (-409, 68–73, 261), (-451, 65–70, 276), (-455, 66–72, 266).
  **The cabin walls are spruce logs (metadata 1, around x -407/-408, z 240–243). Never dig spruce here.**
  The trees with oak trunks around the cove are BOP trees: vanilla oak logs with modded leaves.

## Cabin furnaces: birch → charcoal → baked potatoes (verified 2026-10-07, world day 54840–54841)

**North (-407, 66, 239) = charcoal. South (-407, 66, 240) = potatoes.** Dad's assignment. Facing the furnaces (west), the
south one is on the left.
- **Bootstrap from 13 birch logs:** 2 logs as fuel plus 11 as input made 3 charcoal (1 log of fuel cooks 1.5 items).
  Then 1 charcoal as fuel cooked the other 8 logs into 8 charcoal. **Total: 11 charcoal from 13 logs.**
- **Steady state:** 1 charcoal + 8 birch logs → 8 charcoal (net +7). 1 charcoal + 8 raw potatoes → 8 baked. Both were
  verified exactly, with each batch about 80 s.
- **Commands** (`furnace_put` gained `slot:"fuel"` and `metadata` on 2026-10-07):
  `furnace_put {x,y,z,name:"log",metadata:2,count,slot:"fuel"|omit}`, `furnace_put {...name:"coal",metadata:1,slot:"fuel"}`,
  `furnace_take {x,y,z}`, `furnace_state {x,y,z}`. Stand at (-405, 66, 240) inside the cabin; both are in reach.
- Charcoal reports as `coal` metadata 1.
- **Birch source:** two trees at (-425, 267) and (-436, 263), cut down and replanted with saplings the same day (the first was on dirt,
  the second on modded type 1059). Both stumps are within 14 blocks of each other. The leaves decayed in under a minute and gave
  4 saplings. Dad asked Roz to always carry spare saplings (3 in her pack), in case a future harvest drops none.
- **Leaves vanish almost at once** once the last log is cut, especially when cutting top to bottom (Dad, 2026-10-07). Probably a fast-leaf-decay mod. Sweep for saplings right away, not after a minute.
- **Regrowth is fast:** both trees were fully regrown (7 logs each) within about 40 real minutes, with Roz staying nearby so their chunks stayed loaded. Check the stumps with `find_blocks log` filtered to metadata 2 at (-425, 267) and (-436, 263). Second harvest, day 54844: 14 logs, 5 new saplings (8 in pack).
- Ground-reach chopping: standing beside the trunk, `dig` reached all 6–7 logs (up to y 71) with no climbing. That's ~3 s per log by hand.
- **Roz's chest = (-403, 66, 238)**, the baked-potato chest. Dad emptied it for her on 2026-10-07.
  **Sapling rules (Dad):** a full pack stack (64) of birch saplings → put 32 in this chest. When the chest holds 64 → that stack goes into the
  north furnace as fuel (0.5 item each, so 64 saplings cook 32 logs). If charcoal is already in the north fuel slot, **move it to the south (potato) furnace's fuel slot first** (Dad), using `furnace_take {x,y,z,slot:"fuel"}`. Anything over one stack (64) in the south fuel slot goes in Roz's chest. Then load the saplings.

## Automatic cabin chores (bot.js `runBeeCabinChores`, 2026-10-07)

Dad asked for the birch/charcoal/potato routine to run on its own. It runs after every keeper round:
1. **Outdoors** (tick < 11000, no hostiles at her level, HP ≥ 16): fell any birch with ≥ 5 logs (top-down, birch re-checked per block),
   sweep drops within 14 of the stumps, replant bare stumps. Then the **potato patch**: right-click harvest once ≥ 85% are ripe (the server replants), walk
   the tiles for drops, and sow any bare tile from the pack.
2. **Furnaces** (when she has birch logs, 64+ saplings, or 10 min have passed): logs into the north furnace and its charcoal out. Half the charcoal goes
   back in as north fuel and the rest becomes south fuel, with any overflow going to Roz's chest. Baked potatoes come out of the south furnace, and raw potatoes
   beyond a **32 seed reserve** go in, up to what its fuel can cook. More than 128 baked in the pack → the extra goes to the chest. The sapling rules (see above) run here too.
3. Food order: baked → bread → … → **raw potatoes only as an emergency** (Dad). A food run home is scheduled only when she has no cooked food AND no raw potatoes.
- ctl: `bee_chores {force?}` runs one pass now; `bee_chores_status` shows the stumps, the patch and pack counts. `keep_bees_status.chores` = the last result.
- Live lessons (first passes, 2026-10-07): (a) charcoal taken from a furnace shows in the pack **only after the window closes**, so the half
  kept north is put in on a reopen; (b) "Server rejected transaction" on furnace/chest clicks is benign, and the item usually moves, so `chestMove` logs it and carries on.
  A stale inventory read right after a rejection showed 14 raw potatoes when there were 59. Re-read before believing a count.
  (c) **A dig can "succeed" without breaking the block.** The client says done, but the server ignored it. One birch log was left floating at y 68 over the new
  sapling, the leaves stayed alive, and 4 of 5 logs landed on them out of reach. Now each dig is re-checked (block must be gone, up to 3 passes), the whole
  trunk column is cleared (floating logs count as "ready"), and the result reports cut vs collected. The next pass cut 7 and collected 6.
  (d) **Always the very top first, then down (Dad).** Reach rule: a dig works when (eyeY − (y+0.5))² + h² < 36, with the eyes 1.5 above the feet. From the ground stand
  that's up to y 71, a full 7-log birch. If a trunk is taller, she steps up onto the base log *first* (reaches y 72), cuts top-down, steps off, and cuts the base last.
- **Patch rests while the chest is stocked (Dad, 2026-10-07):** no potato harvest while Roz's chest holds 64+ baked potatoes (the count is read on each furnace visit). Bare tiles still get sown.
- **Poison potatoes go behind the cabin (Dad, 2026-10-09):** the patch harvest had been keeping them; Dad found one in the pack Roz dropped when she died at the bee cross. Now after each patch pass, any `poisonous_potato` is thrown behind the cabin by the same east-lane route as the drones (`dumpTrashBehindCabin` → `throwBehindCabin`). See [[../procedures/apiary-tending]]. Not yet seen live.
- **Charcoal is stored as blocks (Dad, 2026-10-09) — verified live the same day.** On a furnace visit with charcoal left after fueling, Roz takes the chest's loose charcoal, crafts each nine into a **charcoal block (unknown item, type 9703)** at the cabin crafting table (-404, 66, 238), one charcoal per grid space, and puts the blocks plus any remainder back. First run: 10 new + 8 loose = 18 → 2 blocks, 0 left over (chest 42 → 44 blocks). Charcoal still fuels the furnaces first, so a hungry south furnace can leave nothing to compress (that's what happened on the first try).
- **Balls of fur → chest at 64 (Dad, 2026-10-09):** [[../items/ball-of-fur]] (type 9809) are picked up during beekeeping; once the pack holds 64 they go into the chest on the next furnace visit. Not yet seen live.
- Modded items (charcoal blocks, fur) are moved by shift-click (`quickMoveType`): mineflayer's `win.deposit` asserts the item type is in its registry and throws for unknown ids. A "server rejected" log line on the shift-click is benign; the block still moved.
  (e) Live, the same day: **y 71 failed from the ground on the first try**, so the computed reach edge isn't dependable. Any trunk reaching y 71 (every full 7-log birch) now
  gets the step-up onto the base log, and each log is retried up to 3 times *before* she moves lower. If one still won't come down she stops (the tree stays whole, no floating logs)
  and the next round tries again.

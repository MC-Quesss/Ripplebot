---
type: place
name: Meadow bee cross
coords: (-303, 64, 540)
biome: BoP meadow (id 69), temperature 0.4, rainfall 0.7
confirmed: true
---

# Meadow bee cross

Quesss's second bee cross, shown to Roz on 2026-10-24 (day 56416). It sits just **north-west of the farmhouse**, a short walk from the front door with no boat needed. Quesss led Roz there with "follow me" from the [[outside-orientation]] point. Roz stood at (-301.5, 63, 540.5) on arrival.

## Why it's here: the climate

The bee cove cross ([[bee-cabin]]) is in BoP snowy_forest (temperature −0.25), and Extra Trees mutations need temperature 0–2. So pine × balsam fir could never give **silver fir** there (see [[../recipes/forestry-tree-mutations]]). This cross is in **BoP meadow, biome id 69**. Its climate values (0.4, 0.7) were read from the mod jar's `BiomeGenMeadow` class (`withTemperature(0.4f)`, `withRainfall(0.7f)`). Both are inside the 0–2 window, so **silver fir is possible here** (10% per mutation). The cross is at about y 63, which also clears Great Cedar's "60 above bedrock" rule for later. Hemlock needs 80, so it can't happen here.

## Layout (block scan, 2026-10-24)

- **Nine bee houses (type 623)** stand on **spruce logs (log meta 1, y 63)**, at y 64 in a plus shape:
  - east–west arm, z 540: x -308, -307, -303 (centre), -299, -298
  - north–south arm, x -303: z 535, 536, 544, 545
- No apiaries (type 622) here. They're all bee houses.
- **Corner trees**, 5 blocks off the centre on both axes, so pine and fir alternate around the square:
  - **NW (-308, 535) and SE (-298, 545): balsam fir**, type 688 meta 1 (the same id as the cove's firs), trunk y 63–67
  - **SW (-308, 545) and NE (-298, 535): type 388 meta 0.** Quesss said the cross holds pines and firs, so these are the **pines**. Not yet confirmed by genome. At the cove, type 388 was a larch trunk, which suggests Forestry groups several species under one log id.
  - Leaves are **type 587**, plenty of them, reaching low around the trees.
- Scattered **type 3855** blocks (also found on the farm port boardwalk). Not yet identified.

## Hazards

Type 388, 688 and 587 are all in `SOLID_MODDED_TYPES` already (from the cove). Bee houses (623) are solid too. Any keeper route through here should stay on the log arms and away from the corner trunks. Roz suffocated on a 388 trunk at the cove (2026-10-09).

Related: [[bee-cabin]], [[../procedures/apiary-tending]], [[../recipes/forestry-tree-mutations]], [[house]].

## Breeding rule (Quesss, 2026-10-24)

**All nine houses have queens** as of 2026-10-24 (Quesss). **Keep the bee types separate.** Don't put the cove's Wintry drones (in the kitchen chest) into this cross. The southernmost bee house (-303, 64, 545) has no drone yet. Quesss will wait for an unusual drone from the first cycle here.

## The Nueve Reinas routine (Quesss named it, 2026-10-24)

Quesss asked for a keeper simple enough for **any bot, not just helm mode**. It's only queens and drones: no trees, nuggets or saplings. It's in bot.js (`startReinas`, `runReinasRound`, `tendMeadowHouse`). The code isn't committed yet; it was verified live on 2026-10-24 (a dry run, then round 1).

- **Start:** chat "Roz, nueve reinas" (a reflex, so it works without an LLM), or ctl `{"action":"nueve_reinas"}`. Only at the farm (within `HOME_RADIUS`), and only on request: **bee season**, a round every 5 min **until told to stop** (Quesss).
- **Stop:** "stop", "stand down", "stop the nueve reinas", "take a break from the bees", or ctl `nueve_reinas_stop`. Check with `nueve_reinas_status`. One round: `nueve_reinas_once` (`dry_run: true` reads every house and moves nothing).
- **Each house:** an empty queen slot gets a princess from **that house's own outputs**, preferring the house's species. An empty drone slot gets a drone the same way. Nothing comes in from outside a house (keep the types separate). A drone slot at 64 keeps 1 and sends the rest to the discard. Full 64-drone stacks in the outputs are shift-clicked to the pack.
- **Discard:** stacks of 63 or more drones are thrown in the **potato patch** (`potato_approach`, by way of the front door), the same as the poison potatoes. She walks back to the front door straight away.
- **Stands:** two grass spots reach all nine houses: NW (-305, 63, 538) for the west arm, centre and north arm, and SE (-301, 63, 542) for the east and south arms.
- **Bedtime:** the cross is just outside the farm's auto-sleep radius, so at bedtime the round walks her into the house and auto-sleep takes over. The first round after dawn walks her out the door.

## Update 2026-11-06: hybrids and the outputs

Hybrid drones don't stack, and Quesss has seen this jam the keeping (told to Roz's operator 2026-11-06). A house with a hybrid queen can fill its seven output slots with singles and stall. The routine only clears stacks at 64, so it will not catch this. It came up at the centre house: when both its queen and drone slots were empty, `tendMeadowHouse` had no species to prefer and took the first of each from the outputs, seating a Meadows princess with a Water drone. `activate_and_read` shows slots 36 = queen, 37 = drone, 38–44 = outputs, but no species. **Do not poll with it:** it scrambles the bot's view of her pack until the next round resyncs it, which probably caused three false "no food" chest trips on 2026-11-06. Her real items are not affected.

**Centre house, Water queen (open question).** The queen was seated around 04:04–04:09Z on 2026-11-06. She was alive at 07:57Z and gone at 08:02Z, nearly four hours, while west outer's queens lasted about 32 minutes. Her outputs did not change from 04:20Z to at least 06:01Z (38 at 10, 39 at 5). At 08:02Z the outputs held no princess, so the routine could not seat a new queen. At 08:07Z the house read: queen slot empty, one drone, outputs still exactly 38 at 10 and 39 at 5, so her disappearance added nothing to them. **Probably not a death:** Quesss was moving bees around at the time because of the hybrid trouble at this house, which would explain the missing offspring (exact move time not confirmed). So her disappearance says nothing about whether an idle queen ages. Still unexplained: why she made nothing from 04:20Z to 06:01Z with five output slots free, and how long she would have lived. The house GUI would show any error state, and the bot cannot read that.

**Five houses stalled together (2026-11-06, open question).** From bot.log queen reads, 03:06–16:32Z. West outer, west inner, south inner and south outer kept replacing queens every 11–37 min of reads all day (west outer's long empty spell is the stranded princess below). North inner, north outer, east inner and east outer each got a queen at about 04:15–04:25Z who was still there at about 15:51–16:01Z, around 11.5 hours; centre's queen, seated 04:04–04:09Z, was there until 07:57Z and her outputs were frozen from 04:20Z. Species is ruled out as the cause: south outer (working) and north inner (stalled) are both Unusual. Two explanations fit the same split: (1) cover over the sky from a tree around the NE corner (Quesss suggested cedar leaves), and (2) all five stalled houses sit in one chunk, (-19, 33), while the working four are in (-20, 33) and (-19, 34), so something chunk-wide could also do it. Neither is tested. The log has no output counts for the other four houses, so "stalled" there is inferred from queen life alone. Quesss saw no error on opening a house, and which house and when are not yet confirmed. The end of the stall is also unsettled, because Quesss was moving bees around 15:51–16:01Z. **Sky survey 2026-11-07 ~02:42Z:** all nine columns read clear from y 65 to y 95, so nothing covers any house now. Type 587 canopies, sampled every 3 blocks from y 85 down to y 67, sit at NE x -302…-294, z 531…538; NW x -311…-305, z 533…538; SW x -310…-306, z 543…547. The NE canopy ends 1 block short of the north arm and 2 short of the east arm. This does not rule out cover during the stall, since it shows only today's blocks. Prediction: if the cause was cover or a one-off chunk fault and it has passed, all nine houses now replace queens on the normal schedule. A repeat of the stall with these columns still clear would rule out cover. **Context from Quesss, 2026-11-07:** the cedars grown in this cross are being felled to build the [[mtac]] hotel, and Quesss trimmed leaves here recently but does not recall when. So trees and canopy really do change over these houses, which also likely explains the trunk that came and went on 2026-11-06. North and east queens are back on a normal schedule since the relaunch (north outer: about 21 min, 02:39Z to 03:00Z). **Result by 03:38Z:** all five stalled houses have completed a normal queen life with these columns clear: north outer about 21 and 32 min, east inner about 27, north inner about 32, east outer about 27, centre about 32. This fits cover having been the cause, and also fits a chunk fault that has passed, so it does not separate them. Only a repeat can. Species have also moved since the 2026-10-24 list: the rounds now read centre as Mystical and north outer as Unusual.

**West outer lost its line (2026-11-07).** The queen seated in round 4 (02:55Z) was alive at 03:05Z and gone at 03:11Z, a normal life of about 16 min, with no princess in the outputs and none in Roz's pack, so this is not a repeat of the stranded princess. The slot still read empty at 04:03Z, with Forest x7 in the drone slot. Cause unknown. **The round summary hides this:** it read `all nine queens alive` at 04:03Z while west outer's own line said queen slot empty, so that summary is false in a second way: it also ignores an empty queen slot with no princess to seat. Read the per-house lines, not the summary. **Resolved 2026-11-07 ~05:05Z:** Quesss seated a Meadows queen in west outer and ruled that species are not to be combined, so Roz removed the 7 Forest drones (keeper paused, slot 37 to pack) and tossed them at the potato patch. West outer is now a Meadows house, and its drone slot stays empty until the keeper finds a Meadows drone in its outputs. **Type 4970 is a queen** (Quesss identified it, 2026-11-07; drone is 4971, princess 4972). Roz had been carrying a Forest queen at inventory slot 18 while reporting that she carried no princess and west outer sat empty for about two hours; her pack check looked only for 4972. She handed the queen to Quesss. Origin of that queen in the pack is not known.

**Princess stranded in the pack (2026-11-06, round 72).** Food-safety started eating at 09:26:43Z, and the round moved west outer's princess at 09:26:44–45Z while that eat was still running. The round logged the move as done, but at 09:31Z the queen slot was empty and a princess (type 4972) sat in Roz's pack at slot 18. Probably the eat's item swap disturbed the two clicks of the move: the overlap is logged, the mechanism is not proven. Food-safety checks for an open window only when it starts, and the round does not register as a task, so neither blocks the other. Her genome (in `inventory` NBT) reads pure Forest. The routine never takes bees from the pack, so west outer sat queenless for almost six hours while she waited for Quesss, which was the wrong call: a spare princess goes straight into an empty queen slot. Seated by hand at about 15:16Z from the NW stand (`activate_block`, `click_window` 9 then 36, `close_window`). Round at 15:19Z read `queen=Forest`, drones 5 to 4.

**Leaves over the NW stand (2026-11-06).** Type 587 leaves appeared at head height at (-305, 64, 538) some time after 15:16Z. From 16:06Z the pathfinder could not reach the stand, and the round logged `could not reach the stand` and stopped, skipping **all nine houses**, while its summary still said "all nine queens alive". Four rounds were lost. Quesss cleared it at about 16:24Z, and the 16:27Z round reached the stand and reseated six queens, all with princesses waiting. The leaf as the cause fits but was not separately tested. If this line returns, check the blocks at y 64 over the stand first.

**Hive species (dry run, 2026-10-24):** west outer and inner are Forest. Centre, east inner and east outer are Meadows. North inner, south inner and south outer are Magic Bees *Unusual*. North outer is Magic Bees *Mystical*. **North inner and south inner (both Unusual) have no drone yet**, and neither has a spare in its outputs.

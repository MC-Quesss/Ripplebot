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

**Hive species (dry run, 2026-10-24):** west outer and inner are Forest. Centre, east inner and east outer are Meadows. North inner, south inner and south outer are Magic Bees *Unusual*. North outer is Magic Bees *Mystical*. **North inner and south inner (both Unusual) have no drone yet**, and neither has a spare in its outputs.

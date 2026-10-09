---
type: procedure
name: apiary_tending
confirmed: true
---

# Tending the Wintry Apiaries

Taught by [[../bots/operator|Quesss]] at the lighthouse bee cross, 2026-09-29.
**Keep the bees going** (Quesss's name for it; as important as keeping the fire going). First live run 2026-09-29: 5 princesses placed, all verified.

## Where

The **bee cross** by the lighthouse, centred at (-404, 68, 256), west of the
farm across the water (reached by boat to the frozen cove, ~(-420, 63, 283)).
It has four arms of spruce planks. Each arm carries an **apiary (block type 622)**
and a **bee house (block type 623)**, and there is another bee house on the
stacked planks in the middle. Both block types are in `SOLID_MODDED_TYPES`: an
apiary suffocated Roz here once.

**Four trees frame the cross** (Quesss planted them, 2026-10-08): **alders** at the
north-east and south-west corners, **common larches** at the south-east and
north-west. Alders carry leaves very close to the ground. Once they grow, watch
for the keeper stalling between hives on low modded leaves (empty-name blocks
get zero collision unless listed in `SOLID_MODDED_TYPES`).
**This happened the same day (2026-10-08):** the south-east larch reads as a
two-tall **type 383** at (-399, 68–69, 261). It was walk-through, so the
pathfinder routed the south bee house → east bee house leg straight through it,
and Roz stuck there ("east bee house: no window opened" three rounds running).
383 is now in `SOLID_MODDED_TYPES`, and the leg goes around it (verified live).
As the other three trees grow, any new type that shows up in a "no window opened" or
a stalled leg likely needs the same treatment.

### Update 2026-10-09: the trees grew, and Roz died at the SE corner
All four corner trees are now full grown. Saplings and grown trees use different
block ids, so the 383 entry was not enough. In keeper round 7 the south → east leg
walked Roz into the **SE trunk (type 388)** at (-399, 68–70, 261). She suffocated
at 1 HP per 0.5 s with no attacker; the keeper aborted at HP 5 (too late) and she
respawned in the cabin bed. She lost her whole pack at the death spot.
Corner probe (`block_at`, same day):

| Corner | Trunk (x, z) | Trunk type | Notes |
|---|---|---|---|
| NE | (-399, 251) | 688 | 587 leaves down to y 68 (ground level) |
| SE | (-399, 261) | 388 | canopy 587 at y 70 |
| SW | (-409, 261) | 383 | canopy 587 at y 70–71 |
| NW | (-409, 251) | 388 | 1176 (unknown, one block) at (-410, 68, 251) |

All leaves read **587**. 383, 388, 587 and 688 are now in `SOLID_MODDED_TYPES`.
The bees pollinate these leaves (Quesss), so treat them as part of the apiary, not
as scenery to walk through. **Rule:** a planted tree is a block id that changes when
it grows. Re-probe the corners whenever a leg stalls.

## Reading an apiary

`open_container` refuses it. Use **`activate_and_read`** on the block. The window
has 48 slots: the first **36 are the bot's own inventory**, and the last **12 are
the apiary**:

| Apiary slot | Window slot | Holds |
|---|---|---|
| 0 ("slot 1") | 36 | queen, or a princess waiting to become one |
| 1 ("slot 2") | 37 | drone(s) |
| 2–4 | 38–40 | frames (empty so far) |
| 5–11 | 41–47 | output: honeycomb, plus any new princesses and drones |

## The bees (items, not mobs)

The bees fly on players' screens, but the bot receives **no bee entities**. As
items, every bee reads `name: unknown`, so identify them by item ID and NBT
(the `inventory` action now reports `type`, `metadata` and `nbt`):

| Item | ID | Tell |
|---|---|---|
| Wintry drone | **4971** | NBT species `forestry.speciesWintry` |
| Wintry princess | **4972** | same species, plus a `GEN` (generation) field |
| Wintry queen | **4970** | a living queen in slot 1 |
| Honeycomb (probably) | **4986** | the usual output; not a bee |

## Bee houses (block 623)

Same as an apiary but smaller: a **45-slot** window (36 inventory + 9 of its own:
queen, drone, 7 outputs, **no frames**). There is one on the outer end of each arm,
at (-410,69,256), (-398,69,256), (-404,69,250) and (-404,69,262), and one on the
stacked middle planks at (-404,70,256). **All five bee houses were queenless on
2026-09-29**, while all four apiaries had living queens.

## The ctl: `tend_apiary`

`{"action":"tend_apiary","args":{"x":..,"y":..,"z":..,"dry_run":true}}` works on both
kinds (it tells them apart by window size). It opens the window, reports
queen/drone/outputs by id and species, and **only then** acts:
- queen slot empty → move a wintry princess (4972) from the outputs into it;
- drone slot empty → move wintry drones (4971) into it;
- drone stack at 64 → pick it up, put 1 back, drop the rest outside the window
  (Quesss asked for the extras to be discarded into the world, like the poison potatoes). Untested live.
- **Extra drones → one pack slot, dropped when full (Dad, 2026-10-05):** slots 1 and 2 are the
  breeding pair (princess/queen + drone). Every other slot is an output and can hold
  **drones or combs**. After the pair is refilled, `tendApiary` moves any remaining **wintry
  drones** from the outputs into one pack slot, `BEE_DRONE_PACK_SLOT` (hive-window slot 26 =
  player-window slot 35, the last main-pack slot). When that stack reaches 64, it is dropped.
  **Combs and other species are never touched.** If that pack slot holds something else, it
  leaves the drones and logs a note. Drones that don't stack (a swap) or overflow go back
  to their output slot.
  - **Dropping in place does not work (2026-10-05):** a full stack dropped with a click outside the
    window lands next to Roz, and she **picks it straight back up** about 2 s later. So the keeper
    **holds at 64** while a round is running; when the stack is full, extra drones stay in the outputs.
  - **Full stacks go behind the bee cabin (Dad, 2026-10-05):** it works like the poison potatoes:
    throw the stack where the work ends, then walk away at once. At the end of a round, if
    the drone slot holds 64, `dumpDronesBehindCabin` runs these legs:
    1. Path to the lane start (-399.5, 66, 245.5), east of the front door.
    2. North on a fixed leg up the clear 2-wide **east lane** (x -400/-399) to z 232.5.
    3. West to (-403.5, 232.5).
    4. Face north, `tossStack`.
    5. Walk straight back east, then south to the lane start.
    These are fixed `walk_until` legs, never the pathfinder: the cabin's windows are no way
    through. Ctl `dump_drones` runs it by hand.
    **Verified 2026-10-05:** all four legs OK (~9 s). The stack landed at (-403.9, 66, 229.1),
    3 blocks past the throw spot, and stayed there.
  - Stray drone stacks anywhere else in the pack are folded into the drone slot on each visit.
  - **Counts come from the window as it opened**, not from mineflayer's copy after clicks.
    Mineflayer will not merge drone stacks locally (their NBT), while the server does, so after
    a merge the local copy shows a swap. The first version checked "full?" on that copy and
    never dropped. After each merge it always clicks the source slot again, which puts any
    overflow back; on an empty cursor that click does nothing.
  - **Inventory model fix:** our Forge window adoption tells mineflayer the hive comes first, so
    `bot.closeWindow` copies the window back into the inventory with the wrong offset. The
    results were phantom queens and combs on the hotbar, and real items under wrong slot numbers.
    In one case eating "the baked potato in slot 35" actually moved the drone stack to the hotbar.
    `resyncPackFromHiveWindow` now rewrites player slots 9–44 from the window's own pack slots
    **after** the close. If any clicks happened, it re-opens the hive once first, so the copy
    comes from the server. Verified live: the model matched the server after both kinds of visit.
  - *Why it works inside the hive window:* the first version (same day) treated pack drones as
    trash and tossed them with `tossTrash()` after each round. That aimed at a **phantom**: the
    hive window lists the pack first (0–35), so after a hive window mineflayer's own inventory is
    off by 9. It "saw" the last bee house's slot-2 drones as pack slot 37 and clicked there
    (server rejected it, twice). A misaligned click could have picked up and dropped real food.
    Now every drone move is done in the open hive window, whose slot numbers are right.
    Drones are no longer trash, and stash-all skips them.
- **Phantom pack items:** after hive rounds, mineflayer's inventory can list drones and a
  princess that the server does not have. A fresh login on 2026-10-05 showed none of them.
  Re-read the inventory before trusting it for chest moves. A `deposit_slot` run into the bee
  cabin double chest that day reported `ok` for every stack, yet the stacks ended up on the
  floor in front of Roz. Do not use `deposit_slot` there until that is understood.

Stand within about 3 blocks, on the ground beside the arm. A princess from the bot's
**own pack** needs a manual move: `activate_block`, then `click_slot` on her
window slot (inventory slot minus 9), then `click_slot` 36, then `close_window`.
Done once for the south bee house.

**Gotcha:** after these windows, mineflayer's own inventory list includes the hive's
slots (the window puts the player inventory first). Restart before trusting item
counts.

## The job

When a queen dies, the apiary needs a new pair:

1. Look in the **output slots** for a **wintry princess (4972)** and a **wintry
   drone (4971)**. Check the species in the NBT.
2. Put the princess in **slot 1** (apiary slot 0) and the drone in **slot 2**
   (apiary slot 1).
3. **Leave every other item alone.** Honeycomb and other species stay where
   they are.

## The routine: `keep_bees` (built 2026-09-30)

Dad asked for the procedure to be baked into a routine, with one rule: **never
start it unless Dad has brought Roz to the lighthouse by boat.** So it has no
chat trigger and never starts on its own. The operator starts it:

| ctl | does |
|---|---|
| `{"action":"keep_bees"}` | start; **refused** unless Roz is within 30 blocks of the bee cross |
| `{"action":"keep_bees_status"}` | `active`, `rounds`, `moves`, `lastRoundAt`, `nearBeeCross` |
| `{"action":"keep_bees_stop"}` | stop |

Every 5 minutes it walks to each of the nine hives (`BEE_HIVES` in bot.js, with
the standing spot for each), runs `tendApiary`, and logs one `[bees] round N
done: …` line. After each round it feeds Roz if food is 14 or less, retrying
once, because auto-eat stays quiet while hive windows cycle.

It stops itself on `stop` / `stand down` (ctl or chat), and **stops rather than
walks back** if Roz is ever more than 30 blocks from the bee cross (she was
given a ride home). A round is skipped while another task holds the bot, and
cut short below 16 HP.

**Night (since 2026-10-01, Dad asked):** the keeper does not stop at bedtime. A
round breaks off at bedtime, auto-sleep walks her from the cross to the
[[../places/bee-cabin|bee cabin]] front door and into bed, and the first round after
dawn walks her out through the door (the entry reversed) and carries on. Before
this she just stopped at night and had to be restarted by hand.
**Verified the first night (2026-10-01):** after round 1 she walked from the cross into bed in 13 s, the
night skipped, and round 2 walked her out through the door and tended all nine hives.

**Rhythm seen over the first long watch (2026-09-29/30, ~9 hours):** the four
apiary queens die together about every 20 minutes of real time; the bee houses
die one or two at a time, a round or so apart. A new queen uses up the drones,
so the drone slot needs refilling a round later. The 64-drone reset never
fired.

**Update 2026-10-06: apiary queen lifespan re-measured.** 58 alive/dead brackets were taken from
`[apiary] tend` lines over keeper rounds 1–45 (14:39–18:53Z). A princess placed at time *t* was
alive at most *t* + 11.14 min and dead by *t* + **15.79** min at the earliest. So the lifespan
is **between 11.1 and 15.8 real minutes**, and the session log's "nearly fixed ~16.4–16.5 min"
from 2026-10-05 does not hold today. Server TPS measured **19.97** (1200 ticks in 60.09 s). The
lifespan is probably fixed in ticks, and a laggier server on 10-05 (~19.2 TPS) would explain the
gap, but that was not measured. Time apiary queens in **ticks** (`time.age`), not minutes. Bee
houses: 33–64 min this session. See [[../observations/_log]].

## Later

- **Paddle over alone.** Dad plans a dock in the frozen cove, so one day Roz
  can boat to the bees herself. Until then, only by Dad's boat.

## Open questions

- ~~How does the bot tell that a queen has died?~~ An empty queen slot. Verified
  dozens of times; the princess moves straight in.
- ~~Moving items inside a modded window needs raw window clicks.~~ Built:
  `clickWindow` pick-up / place works in both hive windows.
- The drone-64 reset is still untested live.

## Gap seen 2026-10-04: a hive with no princess of its own stays empty

Round 139 (08:24Z, day ~54390) was the first time this happened. The **south bee house** queen died and its own outputs held no
wintry princess, so the keeper logged "queen slot empty but no wintry princess in the outputs" and moved on.
Round 140 found the same thing. `tendApiary` only refills a hive from **that hive's own** outputs. A queenless hive produces nothing,
so it can't recover by itself. Roz's pack had no spare princesses, only six stacks of wintry drones.
Not fixed: moving a princess from another hive's outputs breaks "leave every other item alone", so it's waiting for Dad.
Options: (a) Dad hands Roz a few spare wintry princesses, which go in via the manual pack move above, or (b) the keeper
pockets one spare princess when a hive's outputs hold more than it needs, and uses it for queenless hives.
Round 143 (08:45Z): the **west bee house** went queenless the same way, so two of five bee houses are down. Bee houses seem to run out first. Apiaries (with frames) have kept their own princesses so far.

**2026-10-04 14:52Z:** Dad asked Roz to start keeping the bees again. There are now **lemon and cherry trees** near the hives that need pollinating; the aim is to cross-breed them into **plum**. The bees pollinate on their own. The keeper only keeps the queens alive.
Round 10 after the restart (15:42Z): the **west bee house** had a wintry princess and drones in its outputs again and was refilled. Something put them there. Probably Dad, after hearing the report; not confirmed. The south bee house is still queenless.
Round 11 (15:47Z): the **south bee house** had a princess and drones in its outputs too and was refilled. All nine hives are queened again. Someone, almost certainly Dad, restocked both houses by hand.

## "Tend the bees" and "come home": the whole trip as one routine (Dad, 2026-10-05)

Dad asked for a general skill like "keep the fire going", so any bot can get itself to the bees and back. bot.js `runBeeVoyage` / `runBeeVoyageHome`.
- **To the bees:** chat **"tend the bees"** (also keep / look after / go to / back to the bees), or ctl `bee_voyage` {force?}.
- **Stop the keeper:** **"take a break from / stop the bees"**.
- **Home:** **"come home" / "come back to the farm"** said at the cove, or ctl `bee_voyage_home` {force?}.
- **Treading water:** both trips switch the tread-water reflex on first. Every docking leans on it.

**To the bees:**
1. **Where am I?** (`beeVoyageWhere`) One of: boat, bee dock (x -420…-412, z 276…293), bee cross (within 30, or in the cabin), farm (within HOME_RADIUS), or unknown. Unknown means it refuses and says so.
2. **Farm:** go outside → farm port boardwalk → `mountNearestBoat(10)` → due east out of the slip on its own z → the charted legs
   (-246, 518) / (-239, 497) / (-272, 454) @0.7 → (-401, 351) / (-421, 319) @0.8 → (-418.5, 298) @0.3. Already in a boat on the route: carry on from the nearest leg.
   It sets off only in daylight before tick 9000 (force overrides).
3. **Landing** (worked 2026-10-03): push north up the dock's west side to (-418.4, 285.5) @0.2. The boat grounds by the z 289 torch post.
   Then face east → dismount → **at once** walk east to x ≥ -416.0 onto the planks. If she slips in, the reflex treads and the walk east climbs her out (up to 3 tries). Then north to the stone (z ≤ 280.6).
4. **Walk up:** over the citrus stairs to the sand (-416, 64, 274) → the east apiary stand (-401, 68, 258), inside the bee-cabin sleep radius.
5. **Keeper starts.** Sleeping at the cabin and walking out at dawn come with it.

**Home** (worked 2026-10-01 and 2026-10-05):
1. Stop the keeper.
2. Leave the cabin if inside → shore point → dock centre line x -415.6 → south to the dock end z 290.2 → board the moored boat (radius 4).
3. Return legs (-418.5, 298) / (-421, 319) @0.4 → (-401, 351) / (-272, 454) @0.8 → (-239, 497) / (-246, 518) @0.7 → (-246, 524.5) @0.4 → slip (-251.5, 524.5) @0.25.
4. `exit_boat` to the boardwalk. If she lands in the water (2026-10-05), swim due west to x ≤ -254.2 onto the boardwalk.
5. Walk to the wheat field centre.

The walk-home reflex no longer takes the igloo road from more than 40 blocks off it. That road started from the bee cross on 2026-10-05, 330 blocks away across the sea.

**Chat trace (Dad, 2026-10-05):** the other bots' logs live on other machines, so both voyages report each step in chat as `[voyage] …`:
- start (where from)
- boarding (boat id)
- every leg (result, position, corrections)
- the dock push
- each step onto the planks
- any treading water (at most one line every 8 s)
- the shore and sand
- the arrival and whether the keeper started, or the stop reason

All bots ignore `[voyage]` lines in chat routing. **Since the first round trip worked, the chat trace is off by default.** Set `VOYAGE_CHAT_TRACE=1` in .env to turn it back on for a debugging session. bot.log always keeps it.

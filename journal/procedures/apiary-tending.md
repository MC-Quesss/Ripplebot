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

## Later

- **Paddle over alone.** Dad plans a dock in the frozen cove, so one day Roz
  can boat to the bees herself. Until then, only by Dad's boat.

## Open questions

- ~~How does the bot tell that a queen has died?~~ An empty queen slot. Verified
  dozens of times; the princess moves straight in.
- ~~Moving items inside a modded window needs raw window clicks.~~ Built:
  `clickWindow` pick-up / place works in both hive windows.
- The drone-64 reset is still untested live.

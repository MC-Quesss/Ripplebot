---
type: procedure
name: bake_potatoes
location: house_furnace
trigger: chat
chat_phrase: "Roz, bake the potatoes"
control_command: bake_potatoes
confirmed: true
---

# Bake Potatoes

Convert raw `potato` into `baked_potato` using the [[../places/house-furnace]]. `runBakePotatoes` never stashes — the only baked-potato auto-deposit happens in `tryCollectBake`, which caps on-hand at 128 and deposits the excess into [[../chests/house-kitchen-chest]].

## Triggers

- **Chat:** `Roz, bake the potatoes` / `cook the potatoes` / `smelt potatoes`
- **Control socket:** `./bot-ctl '{"action":"bake_potatoes"}'`

## Steps (executed by `runBakePotatoes` in bot.js)

1. Enter house if outside.
2. **Walk to the kitchen chest and pull all raw `potato` stacks from it into inventory.** Added 2026-05-14 — raw potatoes harvested by [[harvest-potatoes-right-click]] are deposited in the chest, so "bake the potatoes" implies *take them out and put them in the furnace*, not just smelt what's in pocket.
3. Bail if neither source has any raw potatoes — logs `no raw potatoes to bake` (no chat message).
4. Pathfind to within 2 blocks of [[../places/house-furnace]] at (-265, 65, 571).
5. **Open furnace, dump all `potato` stacks into the input slot, close furnace.** Input stacks
   cap at **64** — a larger harvest leaves the remainder (e.g. 76 → 64 in, 12 left) in inventory
   for the next run.
6. **Record when the batch finishes** (`(N × 10s) + 8s buffer`) in `pendingBake` and **return —
   non-blocking.** The bot does NOT stand at the furnace; the furnace cooks server-side on its
   own. Changed 2026-05-30 (see below).
7. **Collection is a separate background step** — `tryCollectBake()` on the 5s timer (the same one
   as auto-sleep). When the batch is due and the bot is free, it walks to the furnace, drains the
   output, and (if fuel ran low and raw remains) reschedules to come back for the rest.
8. **Baked potatoes stay in inventory.**

## Non-blocking bake (2026-05-30)

Originally the bake **blocked the bot at the furnace** for the whole smelt (`N × 10s` — ~13 min
for a full batch), with an in-line bedtime-sleep loop. That tied the bot up doing nothing while
it had a "keep the fire going" wheat field to tend.

Now the bake is **fire-and-forget**: `runBakePotatoes` loads the furnace, sets
`pendingBake = {active, doneAt}`, and returns (releasing its task). The bot is free to harvest
wheat or idle. `tryCollectBake()` collects later, and **defers to the wheat cycle**: if the
sustain loop is active and the field is ripe, it lets the wheat harvest + deposit go first, then
collects the potatoes. Bedtime is handled for free — collection just waits for morning + an idle
moment (the furnace cooks through the night). Manual / recovery trigger: ctl `collect_bake`
(also recovers a batch orphaned by a restart, since `pendingBake` is in-memory only).

## User rule (2026-05-14): no auto-stash after bake

**The bake routine does NOT auto-stash baked potatoes.** They stay in inventory after the smelt finishes — the bot keeps food in pocket for eating. The post-bake auto-deposit step was removed from `runBakePotatoes` on 2026-05-14.

This rule is about *automatic* behavior. **Manual deposit via chat is fully supported** — see [[deposit-named]]. `Roz, stash the baked potatoes` will deposit everything beyond a keep-on-hand of 16.

## Why "load + walk away + take all" beats polling

Earlier version (pre-2026-05-14) opened the furnace every 3s, took whatever was in output, and stopped after two consecutive empty polls. Two problems:
- **Noisy:** dozens of `[bake-potato] poll` lines per bake. Hard to find real events in the log.
- **Fragile early exit:** if the furnace momentarily had `input=0, output=0` between transitions (during a smelt tick that consumed the last raw before producing the next baked), the two-empty-polls condition could fire prematurely. **Confirmed mode: 2026-05-14 — 62 raw → only 30 pulled before the polling loop exited; 23 raw + 9 baked were left in the furnace until manually drained.**

New approach loads everything, sleeps for the predictable smelt time, and pulls once. Predictable, quiet, robust. **Output stack caps at 64**, so this works for batches up to 64 raw at a time. Larger batches need to be split (the new code drains the output up to 3 times defensively, which covers up to 192 raw, but going beyond 64 is unusual).

## Furnace mechanics (vanilla 1.12.2 confirmed on Marcadia)

- Smelt time per item: **10 seconds**.
- Output stack size: 64.
- Fuel: charcoal in current setup. ~48 charcoal observed in fuel slot during last bake — plenty.
- Input/fuel/output slots are addressable via `bot-ctl` action `furnace_state` and `furnace_take`.

## Failure modes

- **Out of fuel mid-bake:** smelt halts; some raw remains in input. New code logs `[bake-potato] incomplete: input_left=N` and chats a warning so the user knows to refill.
- **Bot can't reach furnace:** throws "furnace block not loaded".
- **Bot displaced from chest reach after bake:** stash skipped; baked items remain in inventory (caught by `[bake-potato] stash skip`).

## Related
- [[../items/potato]]
- [[../items/baked-potato]]
- [[../places/house-furnace]]
- [[../chests/house-kitchen-chest]] — general food/item storage; baked potatoes stay on hand

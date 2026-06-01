---
type: procedure
name: right_click_harvest
aliases: [right_click, activate_harvest]
location: wheat_field
status: confirmed
confirmed: true
first_tested: 2026-05-14
---

# Right-Click Harvest

A single-action harvest+replant technique. **Confirmed working** on the SE corner wheat at (-279, 64, 565), day 41328. The only wheat harvest method (brute dig+replant removed 2026-05-14).

> **Status:** technique is proven and **wired as the sole chat handler** (2026-05-14). When the user says "Roz, harvest the wheat / north / south," the bot runs `runHarvestRightClick`.

## Implementation in bot.js

`runHarvestRightClick({ half = 'all', user })` mirrors the structure of `runHarvest` but:
- Uses `bot.activateBlock(block)` instead of `bot.dig(block)`.
- **Does not filter by metadata** — immature wheat is a safe no-op.
- **Walks tiles in clockwise nautilus order from the SE corner** via the helper `orderNautilusCCW(tiles)` (added 2026-05-14; named "CCW" but the actual path is clockwise — west along south, north up west, east across north, south down east). `findBlocks` returns distance-sorted results, which walks the field randomly and creates more drop misses; the nautilus pass keeps the bot moving along contiguous neighbors.
- Pathfinds **range=1** (adjacent) before each activation so drops land in pickup radius. Drops still escape sometimes; the sweep catches them.
- Replaces the 8-point sweep with a **full-coverage boustrophedon** sweep of the harvested half (every farmland tile).
- No separate replant phase — the activation handles it.

## CCW nautilus ordering

`orderNautilusCCW(tiles)` produces this walking sequence (south-half wheat shown):

```
1.  Walk west along south edge (z=565):  (-279,565) → ... → (-287,565)
2.  Walk north along west edge (x=-287): (-287,564) (-287,563) (-287,562)
3.  Walk east along north edge (z=562):  (-286,562) → ... → (-279,562)
4.  Walk south along east edge (x=-279): (-279,563) (-279,564)  (← inner ring)
5.  Walk west along inner south (z=564): (-280,564) → ... → (-286,564)
6.  Inner z=563 row east: (-280,563) → ... → (-286,563)
7.  Spiral exhausted — ordering complete.
```

For the south half (9 wide × 4 tall, z=562..565), this visits 36 tiles in a single connected path.

Control command: `./bot-ctl '{"action":"harvest_right_click","args":{"half":"north"}}'`.

Chat trigger: any phrase matching the existing `harvest` rule (`harvest the wheat`, `harvest the south half`, etc.) routes here.

## What it does

One `activate_block` (right-click) on a mature wheat crop:
- Drops **1 wheat** directly into inventory (no ground drop — bypasses pickup logic).
- Drops **2 wheat_seeds** directly into inventory.
- Replants the crop in place at age 0 (block name stays `wheat`, but it resets to growing).

A single `activate_block` harvests **and** replants in one call — no separate dig or replant phase needed.

## First-test evidence (2026-05-14, day 41328)

Pre-activation inventory: `wheat=0, wheat_seeds=79`.
Action: `./bot-ctl '{"action":"activate_block","args":{"x":-279,"y":64,"z":565}}'` → server reply `{"ok":true,"name":"wheat"}`.
Post-activation: `wheat=1, wheat_seeds=81`. Block at (-279, 64, 565) still reports `name: wheat`. Item entities within radius 4: **none** (drops went straight to inventory).

## Server-side mechanism

This is mod behavior, not vanilla 1.12.2 — vanilla wheat doesn't respond to right-click. One of the 227 Forge mods on Marcadia binds a "harvest crop" handler to the use-block event for mature crops.

## Confirmed behaviors (after south-half nautilus run, 2026-05-14)

- **Right-click on immature wheat is a safe no-op.** Activating a block with `metadata != 7` returns `{ok: true, name: "wheat"}` with no inventory change and no block-state change. **The harvest loop does NOT need to filter by metadata — just activate every wheat tile. Mature tiles harvest, immature tiles do nothing.** Confirmed by user, 2026-05-14.
- **Drops DO sometimes hit the ground.** The earlier "no ground drop" observation from the single-tile SE corner test was a special case — the bot was standing right on top of it. In a moving harvest run, the bot activates a tile faster than its pickup radius covers each drop, and some land on dirt. **A post-harvest sweep is still required** to reconcile the missing drops.
- **No rate limit observed.** 27 activations across the south half, ~1.2s per tile (mostly pathfind time, not activation). No server rejects, no transaction errors.

## Resolved questions

- **Potatoes:** confirmed working — see [[harvest-potatoes-right-click]].
- **Range=1 stand-spot:** implemented; the harvest pathfinds range=1 before each activation, which keeps most drops in pickup radius. A full-coverage sweep still runs after.

## Open questions

- Does it work on **carrots**? (Field unknown — we haven't seen carrots yet.)

## Post-harvest disposition (updated 2026-05-30)

The harvest tail changed twice:

1. **2026-05-29 — keeps wheat on hand.** Previously it walked back inside and deposited all
   wheat into the kitchen chest. Now it tosses trash, tallies wheat, reports, and **stays
   outside with the wheat on hand** (it's needed for sheep/crafting tasks). No auto-deposit.
2. **2026-05-30 — asks hopper or chest.** After the done message, if it has wheat it asks
   `WHEAT_ASK_LINES` ("hopper or chest?") and waits **30s** via `waitForChatReply`:
   - "hopper" → deposits into the [[house-hopper|hopper]] (-266,65,573).
   - "chest"/"stash"/"store"/"deposit" → the [[../chests/house-kitchen-chest|kitchen chest]] (-266,67,569).
   - **No answer in 30s → "Ok, I'll just hang on to it I guess"**, keeps wheat on hand.
   - Deposit path: come inside → pathfind `chest_approach` (-267,65,570), within reach of
     both targets.
3. **2026-05-30 — robust deposit + seed management.** Two fixes after the hopper deposit was
   found to silently fail (it reported "didn't fit" while wheat had actually moved):
   - **Wheat deposit now uses `depositQuickMove()`** (server-side quick-move + retry +
     verify-by-inventory-delta) instead of `win.deposit()`. The [[house-hopper|hopper]] drains
     continuously into the bio-fuel machine, which desyncs `win.deposit()`'s client-side slot
     prediction. See [[deposit-wheat]] for the full mechanism. Reports `backedUp` if the
     machine is jammed rather than looping.
   - **Surplus seeds auto-deposit.** After the wheat step, if `wheat_seeds > 16` the bot
     stashes the excess into the kitchen chest, keeping 16 (see [[deposit-seeds]]). Seeds are
     pure surplus since the right-click harvest auto-replants.

Mirrors the [[harvest-potatoes-right-click|potato bake/stash question]].

## Related
- [[nautilus-sweep-pattern]] — companion movement pattern
- [[house-hopper]] / [[../chests/house-kitchen-chest]] — wheat destinations
- [[../observations/_log]] — session log

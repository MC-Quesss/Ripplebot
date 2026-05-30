---
type: procedure
name: deposit_seeds
target_chest: house_kitchen_chest
keep_on_hand: 16
confirmed: true
---

# Deposit Seeds (surplus management)

Wheat seeds are **pure surplus**. The modded right-click harvest auto-replants without
consuming inventory seeds (see [[right-click-harvest]]), so every harvest dumps seeds into the
bot with nothing pulling them back out. Left alone, the bot's inventory fills with seed stacks
(observed 351 seeds = 5×64 + 31 after accumulation).

## Policy (user directive, 2026-05-30)

**Keep a minimum of 16 seeds on hand; deposit the rest into the
[[../chests/house-kitchen-chest|kitchen chest]].** 16 is a small manual-planting buffer.

## How it works

- `bot.js`: `runDepositNamed(['wheat_seeds'])` with `KEEP_SEEDS = 16`.
- The chest is **stable (no drain)**, so the plain `win.deposit(type, meta, exactCount)` path
  is reliable here — no quick-move needed (contrast [[deposit-wheat]], where the draining
  hopper forces quick-move + delta verification).
- Deposits exactly `onHand − 16`, leaving precisely 16 on hand.
- Wired into `runHarvestRightClick`: after the wheat→hopper step, if `wheat_seeds > 16` it
  auto-runs the seed deposit.

## Tested 2026-05-30

351 seeds on hand → deposited **335**, kept **16**. Chest held 5×64 + 15 = 335 confirmed by
re-opening it. Log: `wheat_seeds: 335 (kept 16)`.

## Related
- [[deposit-wheat]] — the draining-hopper sibling (different mechanism)
- [[right-click-harvest]] — produces the surplus seeds
- [[../chests/house-kitchen-chest]]

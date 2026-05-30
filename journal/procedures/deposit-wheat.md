---
type: procedure
name: deposit_wheat
target_chest: house_kitchen_chest
target_hopper: house_hopper
confirmed: true
---

# Deposit Wheat

Two destinations: the [[../places/house-hopper|hopper]] (bio-fuel intake, the usual home for
a harvest) or the [[../chests/house-kitchen-chest|kitchen chest]] (plain storage). The hopper
**drains continuously**, which makes depositing into it the tricky part — see below.

## The robust path — `depositQuickMove()` (tested 2026-05-30)

`bot.js` helper `depositQuickMove(itemName, target, { keep })`. Used by `runHarvestRightClick`
and the `deposit_wheat` ctl action. Path: come inside → pathfind `chest_approach` (-267,65,570).

- Deposits via **server-side quick-move**: `bot.clickWindow(slot, 0, 1)` (mode 1 = shift-click)
  on each matching stack in the player-inventory portion of the open window.
- **Retries** with a freshly re-opened window each round; gives a draining hopper time to make
  room between rounds; gives up after 3 stalled rounds (reports `backedUp: true`).
- **Verifies by inventory delta**, not by the transaction confirmation. Returns
  `{ deposited, remaining, rounds, backedUp }`.

## Why naive `win.deposit()` fails on the hopper

mineflayer's `win.deposit()` picks a stack onto the cursor, then left-clicks a destination slot
it computed client-side, one slot at a time. The hopper drains that slot underneath the click,
so the server's slot state diverges from the client's prediction → server rejects the
transaction → `deposit()` throws `'destination full'` (mineflayer `inventory.js:323`). The old
harvest code caught that and reported **"didn't fit"** even when the hopper was nearly empty.

**Critical, counter-intuitive finding:** even quick-move throws *"Server rejected transaction"*
against the draining hopper — **but the items move anyway.** The rejection is the client's
mis-prediction being corrected, not a real failure. That's why the delta check (`countOnHand`
before vs after), not the thrown error, is the source of truth. Trust the inventory.

## Steps (manual)

1. `deposit_wheat target=hopper` (default) or `deposit_wheat target=chest`.
2. Verify: inventory wheat count == 0 (hopper) — the wheat drains into the bio-fuel machine.

## Related
- [[../places/house-hopper]] — the draining bio-fuel intake; drain rate, purpose
- [[../chests/house-kitchen-chest]] — the storage alternative
- [[deposit-seeds]] — surplus seed management after harvest
- [[right-click-harvest]] — the harvest that produces the wheat + seeds
- [[../items/wheat]]

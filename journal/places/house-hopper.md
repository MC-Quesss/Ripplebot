---
type: place
name: house_hopper
coords: [-266, 65, 573]
container: true
container_size: 5
confirmed: true
---

# House Hopper

A **vanilla hopper** on the house floor at **(-266, 65, 573)** — same x-column as the
[[../chests/house-kitchen-chest|kitchen chest]] but down at y=65 and ~4 tiles south
(chest is y=67, z=569). Being vanilla, the bot reads it natively as `hopper` (unlike the
modded chest contents). 5 slots.

Placed/observed 2026-05-30.

## Purpose — bio-fuel intake (user-stated)

Per the user (2026-05-30): the hopper **drains into a machine below that converts items into
energy (bio-fuel)**, which powers the neighboring town's engines and generators underground.
The farming bots aren't just farming — keeping this hopper fed is what sustains Oceanside's
power. So this hopper is an **intake buffer, not storage**: whatever lands here is consumed.

## Update — 2026-06-23: potatoes accepted as fuel

User confirmed that **potatoes work the same way as wheat** in the hopper — the bio-fuel
machine accepts both. This means surplus potatoes could also be routed here to generate power.

**It drains continuously.** Observed: 18 wheat deposited → hopper empty within ~8–10s,
consistent with a vanilla hopper's ~2.5 items/sec push rate into the block below. "Empty"
is the normal resting state; a hopper that *stays* full means the machine is off or jammed.

## Use — wheat routing after harvest

Since harvests keep the wheat on hand (see [[../procedures/right-click-harvest]]), the bot
**asks where the wheat should go: hopper or chest.** Mirrors the potato bake/stash question.

- Ask line from `WHEAT_ASK_LINES`; waits **30s** for a reply.
- "hopper" → feeds wheat here (bio-fuel); "chest"/"stash"/"store"/"deposit" → kitchen chest.
- **No answer in 30s → keeps the wheat on hand.**
- Path: come inside, pathfind to `chest_approach` (-267,65,570) — within reach of both the
  chest (~2.4) and this hopper (~3.2).

## Depositing into a draining hopper — quick-move + verify-by-delta

**The naive `win.deposit()` does NOT work reliably here, and the failure is silent.** See
[[../procedures/deposit-wheat]] for the full mechanism. Short version, tested 2026-05-30:

- `win.deposit()` picks a stack onto the cursor then clicks a slot it computed client-side.
  On this 1.12 server the hopper drains that slot underneath the click, the server rejects
  the transaction, and the deposit throws `'destination full'` — which the old code
  mislabeled as "didn't fit" even when room existed.
- The fix is `depositQuickMove()` in `bot.js`: **server-side quick-move (shift-click,
  `clickWindow(slot, 0, 1)`)** + retry with a fresh window + **verify by inventory delta**.
- Key finding: a quick-move into the draining hopper still throws *"Server rejected
  transaction"*, **but the items move anyway** (the rejection is the client's mis-prediction,
  not a real failure). Trusting the inventory delta (wheat went 18→0) — not the transaction
  confirmation — is what makes it correct. Result: `deposited=18 remaining=0 rounds=1`.

`bot.js`: `HOPPER = { x: -266, y: 65, z: 573 }`; `depositQuickMove()` helper; called from
`runHarvestRightClick` tail and the `deposit_wheat` ctl action.

## Related
- [[../chests/house-kitchen-chest]] — the alternative wheat destination
- [[../procedures/right-click-harvest]] — the harvest that triggers the question

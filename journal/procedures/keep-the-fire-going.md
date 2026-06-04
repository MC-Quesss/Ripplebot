---
type: procedure
name: keep_the_fire_going
aliases: [sustain_farm, keep_fire]
status: confirmed
confirmed: true
first_tested: 2026-05-30
last_updated: 2026-06-02
---

# Keep The Fire Going (autonomous wheat + plant-ball → bio-fuel loop)

The hands-off sustain loop. The bot watches the wheat field; when it's **fully mature**, it:

1. Harvests both halves (keeps seeds on hand)
2. Deposits wheat to the [[../places/house-hopper|bio-fuel hopper]] (keeps 7 for engine clearing)
3. Crafts **plant balls** from surplus seeds at the [[project-bench-crafting|project bench]] (keeps 16 seeds)
4. Deposits plant balls to the hopper
5. Waits for regrowth, repeats

## Trigger / stop

- **Start:** say **"keep the fire going"** (also: keep the fires burning / lit / alive / stoked).
  ctl: `{"action":"keep_fire"}`.
- **Stop:** say **"chill"**, **"stand down"**, or **"stop"**. ctl: `{"action":"sustain_stop"}`.
- **Status:** ctl `{"action":"sustain_status"}` → `{active, cycles, startedBy}`.

## How it works (`bot.js`)

- `runSustainFarm(user)` + module state `sustainState = {active, cycles, startedBy}`.
- Loop: `scanKnownWheatFields()` every `SUSTAIN_POLL_MS` (5s). When `maturePct >= 85`,
  triggers the cycle. If a cycle was **interrupted** (hostile retreat, path failure, etc.),
  the 85% gate is bypassed on the next poll via `retryAfterInterrupt` — prevents the loop
  from stalling on partially-harvested (replanted immature) wheat.
- Harvest uses `keepSeeds: true, skipDeposit: true` — seeds stay on hand, wheat stays on hand.
  The sustain loop handles all deposits itself.
- **Wheat deposit:** `depositQuickMove('wheat', HOPPER, { keep: SUSTAIN_KEEP_WHEAT })`.
  `SUSTAIN_KEEP_WHEAT = 7` — reserved for 1-at-a-time engine clearing (deferred).
- **Plant ball crafting:** `craftPlantBalls({ keepSeeds: SUSTAIN_KEEP_SEEDS })` where
  `SUSTAIN_KEEP_SEEDS = 16`. Uses the close/reopen trick on the project bench
  (see [[project-bench-crafting]]).
- **Plant ball deposit:** `depositQuickMove('unknown', HOPPER, { keep: 0 })`.
- The **harvest is the task** (one-at-a-time, bedtime-aware). The sustain loop holds **no task
  between cycles**, so the bot stays responsive.
- Stop is cooperative: `sustainState.active = false` + `abortGen++`.

## Constants

| Name | Value | Purpose |
|------|-------|---------|
| `SUSTAIN_POLL_MS` | 5000 | Field scan interval |
| `SUSTAIN_KEEP_WHEAT` | 7 | Wheat reserved for engine partial-batch clearing |
| `SUSTAIN_KEEP_SEEDS` | 16 | Seeds kept as replanting buffer |

## Deferred work

- **1-at-a-time wheat feeding** to clear the engine's partial batch remainder. Not yet coded or
  proven. The kept 7 wheat is the raw material for this step once the technique is worked out.
- **depositQuickMove partial-stack limitation:** with a single stack of 64 wheat, `keep:7` won't
  split — it skips the stack entirely. Only works when multiple stacks allow keeping 7 across
  the remainder. Needs a split-first approach for single stacks.

## Tested

- **2026-05-30 (day 42933):** Original loop (auto-deposit wheat to hopper, seeds to chest).
  107 wheat deposited, 101 seeds kept 16. 1 cycle, 0 deaths.
- **2026-06-02 (day 43242):** Manual end-to-end of new cycle: harvest → deposit wheat → craft
  7 plant balls from 72 seeds → deposit balls to hopper. All steps confirmed individually.
  `craftPlantBalls` function written and `runSustainFarm` rewritten.

## Related
- [[right-click-harvest]] — the per-cycle harvest (takes `keepSeeds`, `skipDeposit`)
- [[project-bench-crafting]] — the close/reopen trick for crafting plant balls
- [[deposit-wheat]] — `depositQuickMove` for hopper/chest
- [[../places/house-hopper]] — the bio-fuel intake
- [[../observations/_log]] — session log

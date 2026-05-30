---
type: procedure
name: keep_the_fire_going
aliases: [sustain_farm, keep_fire]
status: confirmed
confirmed: true
first_tested: 2026-05-30
---

# Keep The Fire Going (autonomous wheat → bio-fuel loop)

The hands-off sustain loop. The bot watches the wheat field; when it's **fully mature**, it
harvests both halves, feeds the wheat into the [[../places/house-hopper|bio-fuel hopper]],
stashes surplus seeds in the [[../chests/house-kitchen-chest|kitchen chest]], then waits for
the crop to regrow and repeats — keeping Oceanside's bio-fuel line fed without a human prompting
each harvest.

## Trigger / stop

- **Start:** say **"keep the fire going"** (also: keep the fires burning / lit / alive / stoked).
  ctl: `{"action":"keep_fire"}`.
- **Stop:** say **"chill"**, **"stand down"**, or **"stop"**. ctl: `{"action":"sustain_stop"}`.
- **Status:** ctl `{"action":"sustain_status"}` → `{active, cycles, startedBy}`.

## How it works (`bot.js`)

- `runSustainFarm(user)` + module state `sustainState = {active, cycles, startedBy}`.
- Loop: `scanKnownWheatFields()` every `SUSTAIN_POLL_MS` (15s). When `scan.ready`
  (all 108 tiles mature), it calls `runHarvestRightClick({half:'all', autoDeposit:'hopper'})`.
- **`autoDeposit:'hopper'`** is a new flag on the harvest: it skips the interactive
  "hopper or chest?" question and feeds the hopper directly via
  [[deposit-wheat|depositQuickMove]]. Seeds overflow to the chest automatically
  ([[deposit-seeds]], keep 16).
- The **harvest is the task** (one-at-a-time, bedtime-aware — sleeps mid-harvest and resumes at
  dawn). The sustain loop holds **no task between cycles**, so the bot stays responsive and
  conflict-protected only while actively harvesting.
- Stop is cooperative: the `stop` / `stand_down` chat rules set `sustainState.active = false`
  and `abortGen++` (which aborts an in-flight harvest via `checkAbort`). The loop checks the
  flag each poll and between cycles.

## Tested 2026-05-30 (day 42933)

Said "keep the fire going" → `field ready (mature=108/108) — cycle 1` → harvested both fields →
**`deposited 107 wheat to hopper (quick-move, 2 rounds)`** (no prompt) → **`wheat_seeds: 101
(kept 16)`** → returned to waiting (`busy:false`, `active:true`). `sustain_stop` → `stopped after
1 cycle(s)`. Zero deaths, HP healthy throughout.

## Known dependency / risk

The loop re-harvests only when the field reaches **100% mature** (`mature === expected`, the same
signal the [[../places/wheat-field|wheat-ready alert]] uses). This relies on every tile
replanting after each harvest. If some tiles fail to replant (e.g. trampled farmland leaving bare
dirt), the field never returns to 108/108 and the loop waits indefinitely. Heartbeat log line
`waiting (mature=x/expected loaded=…)` (every ~5 min) surfaces a stall.

## Related
- [[right-click-harvest]] — the per-cycle harvest (now takes `autoDeposit`)
- [[deposit-wheat]] / [[deposit-seeds]] — the two auto-deposit destinations
- [[../places/house-hopper]] — the bio-fuel intake
- [[../observations/_log]] — session log

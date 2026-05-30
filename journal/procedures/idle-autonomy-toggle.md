---
type: procedure
name: idle_autonomy_toggle
trigger: chat
flag: idleWanderEnabled
confirmed: true
---

# Idle Autonomy Toggle ("stand down" / "do your thing")

Chat commands to suspend and resume the bot's **idle autonomy** — the self-directed
behaviors that move it around or make it chatter on a timer. Added & confirmed
2026-05-29. The bot must be addressed by nickname (e.g. "Muse, stand down"); these
go through the normal directed-command path in `CHAT_HANDLERS`.

## Phrases

| Intent | Phrases | Handler |
|---|---|---|
| **Off** (stay put, go quiet) | `stand down`, `just chill`, `chill out`, `at ease`, `settle down` | `stand_down` |
| **On** (resume) | `do your thing`, `as you were`, `carry on`, `go on then` | `as_you_were` |

## What "stand down" does

1. `abortGen++` — cancels any in-progress idle action (wander pathing, pen/field trip).
2. `bot.pathfinder.setGoal(null)` + clears all control states → the bot **freezes where it is**.
3. Drops any active follow.
4. Sets `idleWanderEnabled = false`.
5. An in-progress **musing** is ended by the existing directed-command path
   (`endMusingConversation`, since the command is addressed to the bot).

## What the flag (`idleWanderEnabled`) gates

- **Idle wandering** — `tryIdleWander` early-returns when false.
- **Pen / field auto-joins** — `canJoinFieldWanderNow` returns false.
- **Musings** — gate added in `isMusingInitiationBlocked` (covers idle + farming musings).

## What stays ON during "stand down" (by design)

- **Auto-sleep** — runs on its own 5s interval (`tryAutoSleep`) and independently walks
  the bot indoors at bedtime, so a chilling bot still goes to bed. Gated only by
  `autoSleepEnabled`, not this flag.
- **Auto-eat** — plugin-driven (`mineflayer-auto-eat`).
- **Explicit commands** — go inside, harvest, shear, stash, etc. all still obey; their
  handlers don't check the flag.
- **Wheat-ready alerts** — left un-gated (functional alert, not idle chatter/movement).

## Resume

"do your thing" / "as you were" just flips `idleWanderEnabled = true`. The wander and
musing timers never stopped, so autonomy resumes on the next tick — no relaunch needed.

## Persistence — intentionally none (decided 2026-05-29)

The flag is in-memory only; a restart resets it to the default (`true`, wandering on).
This is **by design**, not a gap: a fresh login is the droid waking up and resuming its
life. Verified after a crash — on relaunch the bot wandered and mused again until told
"stand down" anew. Do not add disk persistence unless that decision is revisited.

## Code references (bot.js)

- Flag: `idleWanderEnabled` (declared ~line 789, default `true`).
- Handlers: `stand_down` / `as_you_were` rules in `CHAT_HANDLERS` (right after `stop`).
- Musing gate: first line of `isMusingInitiationBlocked`.

## Related

- [[../places/south-fenced-area]] — the pen whose auto-join is suppressed
- [[../places/wheat-field]] — the field whose auto-join is suppressed

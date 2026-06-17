---
type: todo
name: activity_system_refactor
priority: high
confirmed: true
created: 2026-06-07
status: done
completed: 2026-06-11
---

# TODO: Refactor activity/musing/comment system

## Update (2026-06-11) — DONE

Completed as part of the LLM voice migration. The single output gate exists
(`expressiveGateOpen`/`speakExpressive`: one global gap + per-kind cooldown
table), the musing system is deleted entirely, and all expressive output is
persona-first LLM generation. See [[persona-llm-migration]] and the 2026-06-11
entry in [[_log]]. Original analysis kept below for history.

The bot now has multiple independent timers and cooldowns governing chat output, and they've grown organically. With the persona-based communication style now established, the system needs a unified pass to clean up overlap, simplify cooldowns, and make the whole thing easier to reason about.

## Current state (as of 2026-06-07)

Separate systems that produce chat output:

1. **Ambient action timer** — 90–240s interval, `lastAmbientActionAt` cooldown (90s), 40% chance to try wildlife comment first
2. **Musing timer** — 30–90s interval, `musingState.suppressUntil` cooldown, triggers conversational topics between bots
3. **Squirrel watcher** — 7s interval, `lastSquirrelCommentAt` cooldown (90s), also checks `lastWildlifeCommentAt` (30s)
4. **Wildlife comments** — called from ambient action timer, `lastWildlifeCommentAt` cooldown (300s)
5. **Hostile watchdog victory lines** — op kill success triggers a `pickLine` comment
6. **Follow bedtime lines** — `followBedtimeCooldown` (2min), persona-flavored night suggestions
7. **Idle wander** — 20–70s interval, can produce movement + optional comment
8. **Auto-greet** — 3s interval, 10min per-player cooldown

Each of these independently suppresses some-but-not-all of the others via `lastAmbientActionAt`, `lastWildlifeCommentAt`, `musingState.suppressUntil`, etc. The cross-suppression is ad-hoc and easy to miss (e.g., squirrel comments weren't resetting the musing timer until today's fix).

## Goals for refactor

- **Single output gate**: one "last bot chat" timestamp that all systems check before speaking, so nothing fires back-to-back
- **Unified cooldown model**: replace the web of per-system cooldowns with a clear priority/cooldown hierarchy
- **Persona-first design**: now that every output channel uses persona pools, the system should be structured around "the bot wants to say something" → "what's the most relevant thing to say right now?" rather than N independent timers racing
- **Easier to add new behaviors**: adding a new comment trigger (e.g., weather, new wildlife type, player interaction) shouldn't require manually wiring suppressions into every other system

## Related notes

- [[WILDLIFE_LINES]] pools expanded 2026-06-07 (squirrel: 5→11 protocol, 4→9 roz/unikitty, 5→10 private)
- Follow mode guards added 2026-06-07 (sustain, auto-sleep, hostile watchdog)
- Follow bedtime suggestion lines added 2026-06-07

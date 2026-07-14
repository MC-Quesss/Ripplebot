---
type: procedure
name: quiet-hours
confirmed: false
---

# Quiet Hours

Silent-working mode for overnight runs (added 2026-07-12, requested by Quesss):
the bots keep **working** — fire duty, dot-code coordination, reflex commands,
auto-sleep — but make **zero LLM/API engagements**. No chat replies, no ambient
musings, no music-journal notes, no nightly diary, no fun-RPS banter. The town
stays warm; the token meter reads zero.

## Triggers (deterministic, no API needed)

Spoken by any **human** in chat — no need to address each bot; every bot in
earshot obeys and acks once with a canned line:

| Phrase | Effect | Ack |
|---|---|---|
| **"quiet hours"** | quiet ON | "Quiet hours. Keeping the fire going, silently." |
| **"rise and shine"** | quiet OFF | "Good morning. I am listening again." |

- Matched by plain regex in the chat handler, before any routing — works even
  with the API/Ollama unreachable, costs nothing.
- Bot-spoken lines never trigger it (human-only).
- Phrases tunable per bot via `QUIET_ON_PHRASE` / `QUIET_OFF_PHRASE` in `.env`.

## What still works during quiet hours

- Keep-the-fire-going loop, hopper duty, harvests, RPS **duty** protocol (dot codes)
- The 13 reflex commands (stop, stand down, follow, keep fire, …) — canned replies
- Auto-sleep, auto-eat, auto-greet (canned), hostile watchdog
- Control API (`bot-ctl`)

## What is silenced

- All Claude API calls (brainChat routing, claude-super ambient voice, diary)
- All local-model calls too (classify, generated replies, qwen musings) — quiet is quiet
- Fun-RPS challenges (banter game, not duty)

## State & ops

- Persists to `data/quiet.json` — a crash-relaunch at 4am comes back **still
  quiet** (otherwise a restart would silently re-arm the bill).
- ctl: `./bot-ctl '{"action":"quiet"}'` → status;
  `'{"action":"quiet","args":{"enabled":true}}'` → set.
  `brain` status also reports `quiet`.
- **Crew sync**: each bot obeys only once its machine runs this bot.js — not
  protocol-breaking, but Muse/Private won't hear the phrase until they pull
  and restart.

See [[keep-the-fire-going]], [[claude-brain-mode]].

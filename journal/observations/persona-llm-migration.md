---
type: design
name: persona_llm_migration
created: 2026-06-10
confirmed: true
status: implemented 2026-06-11 (in-game test pending)
---

# Persona/LLM migration — design decisions

Companion to [[todo-activity-system-refactor]]. Discussion of 2026-06-10.

## Decisions (user-confirmed)

- **All musings get chopped** — all three generations (48 classical + 22 farming + 3 recursive,
  catalog preserved in [[musings-catalog-review]]). Event reactions made them redundant; the
  scripted dialogue protocol doesn't survive LLM free-form text anyway.
- **gemma4 (Ollama, local) becomes the line generator** behind the refactored single output
  gate. Verified: Ollama 0.30.7 running, 0.9s/line warm, Node 26 fetch, 24 GB RAM.
- **Persona comes from `.env`** (`PERSONA=roz`), replacing nickname substring inference
  (`botPersonaKey()` bot.js:571). Inference is a footgun — `includes('rain')` matches
  "Brainbot" → unikitty. Drop inference entirely, no fallback chain.
- **One bot per computer** (login credentials constraint) — the local Ollama is never shared
  between bots; no queue/mutex in the generator. Bot-to-bot coordination is purely via
  in-game chat across machines.
- **Bot-to-bot chat: both modes.** (a) independent event reactions always on; (b) LLM-driven
  exchanges controlled by a single `.env` variable: `BOT_CHAT_DEPTH` — per-bot turn cap for
  an exchange, **0 = off entirely**. Start at 3 (~6 lines max per exchange). No separate
  on/off toggle.
- **Reply timing**: minimum 5s before responding, sometimes longer (jittered). While waiting,
  the bot keeps processing incoming chat; if the topic has moved on, the comment is
  suppressed. Mechanism: *delay first, generate at fire time* — prompt includes all chat up
  to the moment of speaking, and the model may output PASS to stay silent. No stale lines
  exist because lines are never written from stale context.

## Keeper influences (user-flagged for persona specs)

- **protocol**: "I am fluent in over six million forms of communication, and not one prevents
  rust." — canonical self-importance vs. mundane farm problems, genuinely felt.
- **private**: the fun-facts series as a *format rule* (real penguin facts, slightly beside the
  point, delivered with pride) + best exemplars: secret knees, "Like a name, but screamy",
  the molt, egg-balancing dads.
- **Overall principle: genuine over performative.** The persona reacts honestly as themselves
  to what's actually happening — never recites bits. This goes in every spec as a top rule.

- **Full `.env` surface**: `PERSONA`, `LLM_CHAT` (on/off), `LLM_URL` (Ollama server,
  default `http://127.0.0.1:11434`), `LLM_MODEL` (e.g. `gemma4`), `BOT_CHAT_DEPTH`.
  No model file paths anywhere — the bot only speaks to the Ollama HTTP API by model
  name; on-disk model location is Ollama's concern (its own `OLLAMA_MODELS` setting),
  invisible to bot.js. Per-machine model/host differences are just .env differences.

## Proposed (not yet confirmed)

- **Persona-as-data**: `personas/<key>.json` files holding system prompt, voice rules,
  few-shot exemplars, AND the functional line pools (bedtime, morning, greet, death...).
  Functional speech stays persona-voiced but scripted/deterministic — it must work without
  the LLM. bot.js ends up with zero persona text; `.env` selects the file; new characters
  = one new file, no code.
- **No-Ollama failure mode: silence, not fallback.** Speech splits into *functional*
  (task/status announcements — stays scripted, always works) and *expressive* (ambient,
  wildlife, bot-to-bot — LLM only). Ollama unreachable → expressive speech simply doesn't
  happen; no crash, bot keeps working. No canned-line fallback (that would reinstate the
  recitation problem); once the LLM path is proven, expressive pools get deleted from
  bot.js. Startup health check logs LLM status; periodic recheck restores the voice if
  Ollama comes up later without a bot restart.
- Output gate: impulse sources → single priority gate + one last-chat timestamp → generator.

## Implementation notes (2026-06-11)

- All of the above shipped; see the 2026-06-11 entry in [[_log]] for specifics.
- Depth-cap accounting (resolved): each bot counts its own spoken turns; the exchange resets
  on 60s bot-silence OR any human message; a 5-minute cooldown gates the next exchange start.
- Converted to LLM impulses: ambient /me, wildlife, squirrel, victory lines, follow-bedtime
  suggestion, bot-to-bot replies. Stayed scripted (functional, persona-voiced from spec
  files): greet, greeting/farewell, goOutside/comeInside/bedtime, retry, fireKeeper, whatsUp,
  idunno, harvest/task announcements.
- **gemma4 requires `think: false`** — it's a thinking model; without the flag every reply
  comes back as empty content (budget consumed by `message.thinking`).

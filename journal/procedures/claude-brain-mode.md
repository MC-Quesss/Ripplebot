---
type: procedure
name: claude-brain-mode
confirmed: true
---

# Claude Brain Mode

Runtime-switchable mode where Claude Opus 4.6 replaces local Qwen as Roz's decision-making brain.

## Modes (`BRAIN_MODE` in `.env`, or the `brain` ctl action)

| Mode | Chat + actions | Idle/ambient voice + diary | Local model running? |
|---|---|---|---|
| `local` | local Qwen | local Qwen | yes |
| `remote` | driven via bot-ctl | local Qwen | yes (classify) |
| `claude` | Claude | **local Qwen** | yes (prefilter + voice) |
| `claude-super` | Claude (every surviving line — model decides) | **Claude, special circumstances only** | **no** |
| `claude-private` | Claude, **addressed-only (enforced in code)** | **silent** + diary silent | **no** |

**Special circumstances** (user policy 2026-07-11, `claudeAmbientAllowed`):
timer/scan-driven musings (idle `ambient`, `wildlife`) never call the API;
event-driven musings (`music`, `craft`, `victory`, `bedtime_suggest`, `rps`,
`bot_chat`) fire only when a **human** player is within 16 blocks
(`humanNearby` — crew bots don't count as an audience). Empty farm = $0.
Local modes are unaffected — qwen musings stay chatty. The nightly diary in
claude-super is exempt (once per day, bounded).

**claude-private "addressed"** = nickname match or the followed player speaking
— checked in `routeChat` before any API call, so overheard human conversations
and unnamed bot chatter cost nothing.

**Bot-to-bot cost bounds** (all claude modes): a bot line reaching `brainChat`
arms the same `botExchange` bookkeeping as the local path (`beginBotExchangeTurn`
/ `recordBotExchangeTurn`), so `BOT_CHAT_DEPTH` and the 5-min exchange-start
cooldown hold everywhere; replies to bots are paced ≥5s. An auth error (401/403)
mutes ALL Claude calls until restart or a `brain` ctl switch (`claude.revive()`),
and the voice has a single-flight lock — concurrent impulses don't stack calls.

The `claude-super`/`claude-private` pair (added 2026-07-11) exist so a
resource-starved box can turn the local model **completely off** and let the
Claude API do all the heavy lifting — classification, responses, control. The
box then has enough headroom to run both the game client and the bot. The local
model is never even started in those two modes (`ensureLocalInited` is gated on
`!localOff()`), so `llm.*` returns null and no local server is contacted.

- `claude-super` — Claude also produces the autonomous/ambient one-liners
  (idle-wander remarks, greet flavour, music-journal notes) and the nightly
  diary. Feels as alive as a local bot, but every timer-driven impulse is an API
  call.
- `claude-private` — the minimal tier: the bot speaks only when spoken to or
  commanded (all via Claude). Ambient impulses and the nightly diary are silent
  (no timer-driven API cost). Reactive **story requests still work** — a bedtime
  story reaches Claude because it's a response, not an ambient impulse.

## Toggle

```
./bot-ctl '{"action":"brain","args":{"mode":"claude"}}'          # Claude chat, local ambient voice
./bot-ctl '{"action":"brain","args":{"mode":"claude-super"}}'    # Claude everything, local off
./bot-ctl '{"action":"brain","args":{"mode":"claude-private"}}'  # Claude reactive-only, local off
./bot-ctl '{"action":"brain","args":{"mode":"local"}}'           # switch back to Qwen
./bot-ctl '{"action":"brain"}'                                   # check current mode
```

Switching *to* a mode that needs the local model (`local`, `remote`, `claude`)
lazily starts it if it was never initialised at boot.

## How it works

- Single Claude API call simultaneously classifies chat, generates a persona-voiced reply, and picks actions.
- Returns `{chat, actions, emote}` — all executed in order: chat first, actions second, emote last.
- Local Qwen prefilter runs first (cheap, fast) to skip noise before calling Claude API.
- Reflex tier ([[stop]], [[stand-down]], [[follow]]) always fires instantly regardless of brain mode.
- Actions restricted to [[CHAT_INTENTS]] whitelist — Claude cannot run arbitrary bot commands.
- Falls back to local Qwen automatically if Claude API unreachable.

## Config

- `BOT_API_KEY` in `.env` (also accepts `CLAUDE_API_KEY` / `ANTHROPIC_API_KEY`)
- `CLAUDE_MODEL` env var overrides default (`claude-opus-4-6`)
- `CLAUDE_PREFILTER=local` (default) uses Qwen to filter before Claude; `none` sends everything to Claude

## Files

- `claude.js` — API client module; `brainChat` (chat/actions) + `generateLine`/`generateStory` (persona voice twins of `llm.js`, used when the local model is off)
- `bot.js` — `routeChat`, `routeChatLocal`, `executeClaudeResponse`, `buildClaudeBrainSystemPrompt`; predicates `usesClaudeBrain()`/`localOff()`/`ambientViaClaude()`; shims `expressiveGenerate`/`expressiveStory`

## Limitations

- Bot-to-bot commands blocked by design — Roz cannot command Muse, only converse.
- API latency ~2-3s per call (vs ~200ms local Qwen classify).
- Costs money per API call — prefilter keeps costs down by filtering noise locally.

## Update

2026-06-18: initial implementation and testing. Chat splitting added for long Opus responses (230-char chunks at sentence boundaries).

2026-07-11: added `claude-super` and `claude-private` modes so the local model can be turned off entirely (for boxes that can't run both a local model and the game — e.g. Private). Added Claude-backed `generateLine`/`generateStory` to `claude.js`. Voice functions unit-tested against a mocked API (sanitize, PASS→null, refusal→null, slash/emoji strip, story splitting). Not yet run live on the server. Per-bot config, **not** cross-bot protocol-breaking — Private can adopt a no-local mode without the others restarting.

2026-07-11 (later, same day): full code review (10 findings) + fix pass, all verified by mocked-API tests (16/16):
- **Voice dedup**: prompt rules + sanitize + story cleaning now live ONCE in `llm.js` (exported `buildSystemPrompt`/`buildStorySystem`/`sanitize`/`cleanStoryLines`); `claude.js` imports them — the backends cannot drift. Fixed the sanitize divergence (leading digits no longer eaten from single lines; `/`-story-lines dropped, not garbled).
- **Cost bounds**: bot-exchange depth cap armed on the Claude path (was dead — unbounded bot-to-bot Opus loops possible); claude-private addressed-only gate in code; claude-super ambient gated to events + human audience; single-flight voice lock; auth-error mute with `claude.revive()` escape hatch; `callApi` shared request core (brainChat + voice).
- **Robustness**: unknown `BRAIN_MODE` fails loudly to local; runtime switch into claude-private now truly silences ambient local speech (`expressiveGenerate`/`expressiveStory` check `localOff()` explicitly); `llm` ctl reports `off:true` instead of a fake crash; RPS canned fallback only fires while the challenge is still open; CLAUDE.md Key Constraints corrected.
Still pending: live test (planned: this box first, then Private).

---
type: procedure
name: claude-brain-mode
confirmed: true
---

# Claude Brain Mode

Runtime-switchable mode where Claude Opus 4.6 replaces local Qwen as Roz's decision-making brain.

## Toggle

```
./bot-ctl '{"action":"brain","args":{"mode":"claude"}}'   # switch to Claude
./bot-ctl '{"action":"brain","args":{"mode":"local"}}'    # switch back to Qwen
./bot-ctl '{"action":"brain"}'                            # check current mode
```

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

- `claude.js` — API client module
- `bot.js` — `routeChat`, `routeChatLocal`, `executeClaudeResponse`, `buildClaudeBrainSystemPrompt`

## Limitations

- Bot-to-bot commands blocked by design — Roz cannot command Muse, only converse.
- API latency ~2-3s per call (vs ~200ms local Qwen classify).
- Costs money per API call — prefilter keeps costs down by filtering noise locally.

## Update

2026-06-18: initial implementation and testing. Chat splitting added for long Opus responses (230-char chunks at sentence boundaries).

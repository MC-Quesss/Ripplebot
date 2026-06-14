---
type: procedure
name: ambient-actions
confirmed: true
---

# Ambient /me Actions

Quiet signs of inner life emitted as action text via Minecraft's `/me` command. Renders as `* BotName does something` — not conversational, doesn't trigger responses from other bots.

## Mechanism (current — LLM-driven, since 2026-06-10)

1. **Timer** (`AMBIENT_ACTION_MIN_MS`=180s, `AMBIENT_ACTION_MAX_MS`=420s): self-rescheduling random interval fires `tryAmbientAction()`.
2. **Guards**: no active task, not sleeping, not traversing doors/pen, idle wander enabled, and `expressiveGateOpen('ambient')` (90s cooldown since last ambient, 30s since any expressive line).
3. **Wildlife shortcut**: 40% chance to attempt a wildlife comment instead (squirrel/butterfly classification of unknown entities).
4. **Location context** (coarse, 4 zones): picks one of:
   - Inside house: "walls, beds, chests, the furnace, a door. CANNOT see sheep, wheat field, sky, sun, clouds, wildlife."
   - In sheep pen: "sheep, the fence, grass, the sky. Cannot see wheat field or house interior."
   - In wheat field: "wheat rows, the sky, the farmhouse in the distance. Cannot see sheep pen or house interior."
   - Outside (fallback): "farmhouse, the field, the sky, trees. Cannot see house interior."
5. **LLM generation** via `impulseExpressive('ambient', situation, {me: true})`:
   - Builds full context (`buildExpressiveContext`): time of day, rain, whereabouts, vitals, inventory, active task/sustain state, follow target, online players, recent chat.
   - Appends `actionTextFormatNote()`: instructs LLM to write one short third-person present-tense stage direction ("watches...", "frets over...").
   - Uses persona's `systemPrompt` + `exemplars` for voice.
6. **Format enforcement** (`asActionText`): strips first-person openers, name echoes, `/me` prefix. Rejects lines starting with I/me/my/oh/ah/etc. Retries once on failure, then drops.
7. **Output**: `speakExpressive` sends `/me <line>` to chat. Logged as `[ambient]`.

## Known issues (as of 2026-06-14)

### Location context too coarse
Only 4 zones. LLM can hallucinate details not actually present — e.g. "leans on the fence" when inside the house. Finer-grained position awareness (near door, near bench, near bed, near hopper, near fence gate, north/south field half) would improve accuracy.

### No emote paired with actions
The `sendEmote()` system exists (valid: no, yes, wave, salute, cheer, clap, think, point, shrug, headbang, weep, facepalm) but ambient actions never trigger one. A relevant emote alongside the `/me` text would add physicality.

### No activity-state detail
The prompt knows `activeTask.name` and `followTarget`, but doesn't distinguish "standing still for 2 minutes" vs "just arrived" vs "about to leave." The bot's immediate physical state (idle duration, facing direction, what block it's standing on) could inform more grounded observations.

## Desired improvement

Have the LLM return structured JSON: `{action: "watches a cloud drift overhead", emote: "think"}` — validate the emote against the whitelist, fire `sendEmote()` alongside the `/me` line. Enrich location context with finer-grained position data so musings are accurate to what the bot is actually near.

## Gates (must all pass)

- `activeTask.name === null`
- `!bot.isSleeping`
- `!goInsideBusy && !penTraversalBusy`
- `idleWanderEnabled` (stand-down silences ambient chatter)
- `expressiveGateOpen('ambient')` — 90s per-kind cooldown + 30s global gap

## Related

- [[emotes]] — protocol-level emotes via autoreglib custom_payload (separate from /me text)
- [[idle-autonomy-toggle]] — stand-down controls wandering + ambient chatter
- [[keep-the-fire-going]] — sustain state is included in the LLM context

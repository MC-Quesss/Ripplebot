# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ripplebot ("Roz") is a Mineflayer bot (`bot.js`, ~6500 lines, plus `llm.js` for the Ollama-backed voice and chat router) for a modded Minecraft 1.12.2 Forge server. It connects via Microsoft auth, runs autonomous behaviors (auto-sleep, auto-eat, auto-greet, idle wander, ambient actions, hostile retreat), and exposes a TCP JSON control API on `127.0.0.1:25580` for external orchestration. Each bot instance pairs with its own Ollama box (`LLM_URL`/`LLM_MODEL` in `.env`); the LLM is both the bot's conversational voice and its chat router.

## Commands

```bash
node bot.js          # Start the bot (requires .env with MC_HOST, MC_USERNAME)
./bot-ctl '<json>'   # Send a command to the running bot, e.g. ./bot-ctl '{"action":"pos"}'
./stop               # Gracefully stop the bot (quit over control socket, fallback pkill)
```

There is no build step, no linter, and no test suite.

## Architecture

Everything lives in `bot.js` — a single CommonJS module. Key sections (top to bottom):

1. **Connection & error resilience** (lines 1–150) — env config, Forge handshake, `FullPacketParser` patch to survive malformed modded packets, `rawState` shadow for protocol-level position tracking, synthetic `open_window` injection for Forge mod GUIs.

2. **Bot initialization & plugins** (~155–300) — mineflayer createBot, pathfinder (canDig=false, no towers/scaffolding), auto-eat with leak-patched listener, Movements configured for modded terrain (lily-pad solidity, zero-collision patches for specific blocks).

3. **Autonomous behaviors** (~300–850) — auto-sleep (multi-bed fallback), auto-greet (proximity + cooldown), phrase de-duplication across bots, persona system (protocol/roz/unikitty/private line pools with weighted selection), idle wander, ambient actions.

4. **Task system** (~760–810) — `activeTask` singleton; `startTask`/`endTask`/`taskBusy` prevent concurrent long-running operations; tasks can yield to bedtime and resume.

5. **Farming & crafting routines** (~3000–5700) — harvest wheat/potatoes (right-click replant), shear sheep, bake bread/potatoes (raw window_click crafting for modded GUIs), deposit/stash routines, food-safety sustain loop.

   **Multi-bot fire-duty coordination** (`FIRE_*` constants near `runSustainFarm`; overhauled 2026-07-03, design in `FIRE_OVERHAUL_NOTES.md`): bots coordinate over in-game chat — the only channel shared across machines — using `/me` lines that are either bare dot-codes (`.n`) or persona prose with a trailing parseable core (`* Roz glances north — all golden. (.c n)`); `parseFireCoord` is the single grammar. Chat carries *claims and liveness only*; the world (blocks, containers) is the shared database, which is why every duty stage is idempotent and can be resumed or handed to another bot. Work follows a priority ladder: hopper health → baked-potato pipeline → potato field → wheat (bonus tier, never a priority). Duty claims (`.n`/`.s`/`.p`) tie-break alphabetically; dead keepers are caught by wellness checks (`.c <f>` when a claimed field sits 100% mature; a claim refresh answers it; 60s silence frees the duty via `.q <f>`). Bench (`.b`/`.f`) and hopper (`.k`/`.l`) are chat-locks with collision tie-breaks — **every hopper write goes through `depositToHopper()` (which refuses raw wheat/seeds — plantballs and potatoes only); the hopper lock is held ONLY by the un-jam routine (`clearJammedHopper`: plantballs sitting with no potato → one potato at a time, 20s wait each, lock held through the waits). Checks and ordinary deposits are lock-free (2026-07-07).** Potato duty is decided by RPS (never alphabetical): the challenger's chant carries a reveal tick on the shared server clock (`.t<round> @<tick>`), throws are round-tagged, `.a` aborts mutually. Quick commands (follow, music) pause the loop (`sustainState.paused`) and resume on completion; stop/stand-down are hard kills. Protocol changes are cross-bot breaking — all bots must restart onto the same bot.js together.

6. **Chat handling: reflex tier + LLM router** (~4800–5500) — two-stage pipeline (refactored 2026-06-11):
   - **Reflex tier (`CHAT_HANDLERS`)**: 13 deterministic regex commands that fire only when the bot is addressed by nickname — follow, stop, stand_down, as_you_were, stash-all, inventory, shear_sheep, bake, harvest-potato, keep_fire, emote, dance, joke. Safety commands live here so they never wait on inference.
   - **LLM router (`routeChat`)**: every other chat line gets one JSON classification call (`llm.classify`) returning `{audience, kind, intent, args, relevance}`. Commands map to the `CHAT_INTENTS` whitelist (harvest_wheat, go_inside, eat, sleep, deposit_items, stop_follow, …) which call the same `run*` routines as the ctl API. Conversation goes to `llm.generateLine` in persona voice; `buildExpressiveContext` injects live vitals/inventory/sustain state so questions like "how are you" are answered truthfully. Unaddressed lines only get a reply when `relevance >= CHAT_RELEVANCE_MIN` (.env, 0–10, default 7). Bot-to-bot replies are capped by `BOT_CHAT_DEPTH` per exchange. No canned fallbacks: Ollama down = the bot doesn't engage.

7. **Control server** (end of file) — TCP socket accepting JSON commands. Each `case` in `handleCommand` is a bot action (movement, containers, farming tasks, toggles). Commands return JSON responses; async commands return Promises.

## Control API

Commands are JSON objects: `{"action":"<name>", "args":{...}}`. Key actions:

- **Movement:** `pos`, `look`, `pathfind`, `pathfind_status`, `pathfind_stop`, `walk_until`, `walk_blocks`, `control`, `goto`
- **World:** `nearby_entities`, `nearby_players`, `find_blocks`, `block_at`, `time`
- **Containers:** `open_container`, `deposit`, `deposit_slot`, `withdraw_slot`, `activate_and_read`, `inventory`
- **Tasks:** `harvest_right_click`, `harvest_potatoes`, `bake`, `stash_wheat`, `deposit_named`, `shear_sheep`, `keep_fire`
- **Toggles:** `auto_sleep`, `auto_eat`, `idle_wander`, `look_at`, `follow`
- **Lifecycle:** `stop`, `task_status`, `quit`

## Data & Journal

- `data/mods.json` — Forge mod list (required for connection)
- `data/places.md` — Coordinate waypoints, drive rules, and multi-step procedures (door traversal, harvesting, depositing). This is the primary reference for world-interaction logic.
- `journal/` — Obsidian vault with places, procedures, observations, recipes, creatures. Updated as the bot learns new things about the world.

## Key Constraints

- **Near-single-file architecture.** All bot logic is in `bot.js`; the only extracted module is `llm.js` (Ollama health-check, `generateLine`, `classify`).
- **Chat requires the LLM.** Since the 2026-06-11 router refactor, only the 13 named reflex commands work without Ollama. Everything else (natural-language commands, conversation) needs the bot's Ollama box reachable.
- **Modded 1.12.2 Forge.** Many blocks report empty names, GUIs don't fire standard mineflayer events, and protocol-level workarounds are required throughout.
- **No combat.** The bot has no weapons/armor logic — Don't panic - hostile detection triggers a kill command to eliminate the hostile mob.
- **Door traversal uses `walk_until` with axis-target stopping.** Pathfinder cannot navigate through doors on this server. See `data/places.md` for the exact procedure.
- **`rawState` vs mineflayer position.** Mineflayer's `bot.entity.position` gets stuck at (0,0,0) on this server; `rawState` tracks protocol-level position as fallback.

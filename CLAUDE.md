# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ripplebot ("Roz") is a single-file Mineflayer bot (`bot.js`, ~9600 lines) for a modded Minecraft 1.12.2 Forge server. It connects via Microsoft auth, runs autonomous behaviors (auto-sleep, auto-eat, auto-greet, idle wander, ambient chat/musings, hostile retreat), and exposes a TCP JSON control API on `127.0.0.1:25580` for external orchestration.

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

6. **Chat handling & musing system** (~5700–8840) — nickname regex matching, mention extraction/logging, "musing" conversations (classical multi-line pools and recursive topic trees with branching/partner awareness), farming musings.

7. **Control server** (~8841–9644) — TCP socket accepting JSON commands. Each `case` in `handleCommand` is a bot action (movement, containers, farming tasks, toggles). Commands return JSON responses; async commands return Promises.

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

- **Single-file architecture.** All bot logic is in `bot.js`. No module splitting exists.
- **Modded 1.12.2 Forge.** Many blocks report empty names, GUIs don't fire standard mineflayer events, and protocol-level workarounds are required throughout.
- **No combat.** The bot has no weapons/armor logic — hostile detection triggers retreat to the house.
- **Door traversal uses `walk_until` with axis-target stopping.** Pathfinder cannot navigate through doors on this server. See `data/places.md` for the exact procedure.
- **`rawState` vs mineflayer position.** Mineflayer's `bot.entity.position` gets stuck at (0,0,0) on this server; `rawState` tracks protocol-level position as fallback.

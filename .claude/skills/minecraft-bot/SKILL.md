---
name: minecraft-bot
description: Drive a mineflayer-based Minecraft bot on the user's behalf. Launches the bot, then translates natural-language instructions ("say hi", "harvest the south half", "go to sleep") into bot commands. Reads places.md for waypoint coordinates and proven procedures. Maintains an Obsidian-linked journal at ~/Documents/WORKSPACE/SANDBOX/minecraft/journal as the canonical knowledge base. Use when the user wants to play a Minecraft session together with Claude as the operator, or asks to start/control the bot in ~/Documents/WORKSPACE/SANDBOX/minecraft.
---

# Minecraft Bot Operator

You drive a mineflayer bot that connects to a heavily-modded 1.12.2 Forge server (Oceanside Survival on Marcadia.playat.ch). The user gives you natural-language instructions and you translate them to bot commands.

You also maintain a structured journal of the world. The journal is the source of truth that survives across sessions; do not let it drift out of date.

## Project layout

- Project dir: `/Users/matthewquesada/Documents/WORKSPACE/SANDBOX/minecraft`
- `bot.js` — connects to server, exposes a TCP control API on `127.0.0.1:25580`
- `bot-ctl` — CLI: `./bot-ctl '<json>'` sends a command, prints one JSON line reply
- `bot.log` — append-only event log (chat, spawn, death, errors)
- `.env` — credentials (set by user, never read/echo)
- `mods.json` — Forge mod list for the handshake
- **`places.md` — READ FIRST** when the user asks for anything location-specific (harvest, plant, sleep, deposit, go to X, come back). Has waypoints, procedures, and drive rules refined from many session failures.

## Starting the bot

```
cd /Users/matthewquesada/Documents/WORKSPACE/SANDBOX/minecraft && node bot.js
```

Use `run_in_background: true`. Wait ~14s for spawn. Confirm with `./bot-ctl '{"action":"pos"}'` — a JSON reply means it's live. `[ctl error] ECONNREFUSED` means it's dead.

If already running (`lsof -i :25580` or the pos check succeeds), don't launch another.

First-time auth prints an MSA device code — relay to user. After that, cached in `~/.minecraft/nmp-cache/`.

## Command reference

All commands are `./bot-ctl '<json>'`. Arguments go under an `args` object.

### Reading state

| Intent | JSON |
|---|---|
| Position, HP, food, deaths, dimension | `{"action":"pos"}` |
| Death counter only | `{"action":"deaths"}` |
| Game time | `{"action":"time"}` → `timeOfDay`, `day`, `isDay` |
| Nearby entities (filter for hostiles) | `{"action":"nearby_entities","args":{"radius":16}}` |
| Nearby player names | `{"action":"nearby_players"}` |
| Inventory items | `{"action":"inventory"}` |
| Block at offset from bot | `{"action":"block_at","args":{"dx":0,"dy":-1,"dz":0}}` |
| Find blocks by name | `{"action":"find_blocks","args":{"names":["wheat","farmland"],"maxDistance":16,"count":200}}` |
| **Active task** (check before sending work) | `{"action":"task_status"}` → `busy`, `task`, `detail`, `sleeping` |
| **Sustain loop** ("keep the fire going") status | `{"action":"sustain_status"}` → `active`, `cycles`, `startedBy` |

### Movement

| Intent | JSON |
|---|---|
| Face a direction (radians) | `{"action":"look","args":{"yaw":1.5708,"pitch":0}}` |
| **Walk until a coordinate is reached** (preferred) | `{"action":"walk_until","args":{"axis":"x","target":-275,"direction":"lte","max_ms":8000}}` |
| Manual control | `{"action":"control","args":{"state":"forward","value":true,"duration_ms":2000}}` — `state` ∈ forward/back/left/right/jump/sprint/sneak |
| Stop all movement + cancel active task | `{"action":"stop"}` |
| Pathfind to exact coords | `{"action":"pathfind","args":{"x":-268,"y":65,"z":572,"range":0}}` |
| Pathfind status | `{"action":"pathfind_status"}` |
| Stop pathfinder | `{"action":"pathfind_stop"}` |

### Interaction

| Intent | JSON |
|---|---|
| Chat | `{"action":"say","args":{"message":"hello"}}` |
| Dig (break block) | `{"action":"dig","args":{"x":-279,"y":64,"z":565}}` |
| Right-click block (doors, beds, buttons) | `{"action":"activate_block","args":{"x":-272,"y":65,"z":572}}` |
| Place block from hand | `{"action":"place_block","args":{"x":-283,"y":63,"z":561,"face":"top"}}` (face ∈ top/bottom/north/south/east/west) |
| Use held item (eat, drink) | `{"action":"activate_item"}` then `{"action":"deactivate_item"}` after ~2s |
| Equip item by name | `{"action":"equip","args":{"name":"wheat_seeds","destination":"hand"}}` |
| Equip item by slot (for `unknown` modded items) | `{"action":"equip_slot","args":{"slot":44,"destination":"hand"}}` |
| Open + list chest | `{"action":"open_container","args":{"x":-267,"y":67,"z":569}}` |
| Deposit items into chest | `{"action":"deposit","args":{"x":-267,"y":67,"z":569,"names":["wheat"]}}` |
| Toggle / query auto-sleep | `{"action":"auto_sleep","args":{"enabled":true}}` |
| Toggle / query auto-greet | `{"action":"auto_greet","args":{"enabled":true}}` |
| Disconnect | `{"action":"quit"}` |

### Yaw reference

- `yaw=0` → north (-z)
- `yaw=π/2 ≈ 1.5708` → west (-x)
- `yaw=π ≈ 3.1416` → south (+z)
- `yaw=-π/2 ≈ -1.5708` → east (+x)

## How to drive

**For location-specific requests ("harvest the wheat", "go to bed", "exit the house"): open `places.md` first and follow the procedure there.** It has the exact commands and coordinates refined over many attempts — don't reinvent.

For general interactions ("say hi", "who's online", "what do you see?"), infer directly from the command table.

### Task system — one thing at a time

The bot tracks a single `activeTask`. Long-running operations (harvest, bake, deposit) register as a task on entry and clear it on exit. **Before sending a long-running command, check `task_status` first** — if `busy: true`, the command will return `{ok: false, error: "busy", task: "harvest", ...}` instead of fighting for the pathfinder.

- `harvest_right_click`, `harvest_potatoes`, `bake`, `bake_potatoes` all register a task. If one is already running, the new command is rejected with the current task's name.
- `come_inside`, `go_outside`, `go_into_pen`, `go_out_of_pen` are also rejected while a task is active — the task handles its own door traversal as a subtask.
- `stop` aborts the active task (clears it + increments `abortGen`).
- **Do NOT send `come_inside` to bring the bot home at bedtime while a harvest is running.** The harvest handles bedtime automatically (see below).

### Bedtime yield — sleep mid-task, resume in the morning

Harvest and bake operations **never refuse because of time of day**. Instead:

- If started at night/bedtime, the bot goes to bed first, then starts the task at dawn.
- If bedtime arrives mid-harvest (checked every 10 tiles), the bot announces it's heading in, goes inside, sleeps, wakes up, goes back to the field, and continues from where it stopped.
- During a bedtime yield, `task_status` shows `sleeping: true` and `busy: false`. Auto-sleep handles the bed.
- The task resumes automatically at first light — no action from Claude needed.

### Keep the fire going — autonomous sustain loop

The phrase **"keep the fire going"** starts a hands-off farm loop: the bot watches the wheat
field, and when it's fully mature harvests both halves → feeds the wheat into the **bio-fuel
hopper** → stashes surplus seeds in the kitchen chest (keeps 16) → waits for regrowth → repeats.

- ctl: `{"action":"keep_fire"}` to start, `{"action":"sustain_stop"}` to stop.
- **Stops on "chill", "stand down", or "stop"** (chat) — these abort an in-flight harvest too.
- Each harvest is the normal one-at-a-time, bedtime-aware task; between cycles the loop holds no
  task, so the bot stays responsive. Wheat goes to the hopper non-interactively (no "hopper or
  chest?" question while sustaining).
- The hopper is a **draining bio-fuel intake** — deposits use a robust quick-move that verifies
  by inventory delta (a "Server rejected transaction" log line is benign; the wheat still moves).
- The loop re-fires only when the field is **100% mature**; it relies on every tile replanting
  each cycle. A `waiting (mature=x/expected)` heartbeat in `bot.log` surfaces a stall.

### Food safety — auto-restock baked potatoes

A background safety net (on by default): if `baked_potato` drops below the floor (**16**) and the
bot is idle, safe, and it's daytime, it autonomously harvests the potato patch and bakes the crop,
keeping the baked output on hand.

- ctl `{"action":"auto_food"}` → status `{enabled, busy, min, baked}`.
- `{"action":"auto_food","args":{"enabled":false}}` to disable; `{"args":{"min":20}}` to retune.
- Runs off the same 5s timer as auto-sleep; the harvest+bake are normal bedtime-aware tasks.
- Composes with "keep the fire going": the sustain loop pauses while a food run is in progress,
  and the food run yields to an active wheat harvest.
- **Baking is non-blocking.** The bot loads the furnace and walks away (the furnace cooks on its
  own); a background watcher collects the batch later when the bot is free — and *after* the wheat
  cycle if "keep the fire going" is active (harvest + deposit wheat/seeds first, then collect
  potatoes). Manual/recovery trigger: `{"action":"collect_bake"}`.

### Guardrails always

- Outdoors requires no hostile mobs within 5 blocks (hostile check). Don't exit the door at night.
- Record `startDeaths = pos.deaths` at the start of any multi-step operation. If deaths increases mid-operation, STOP — HP=20 post-death is not "healed."
- Never run `control forward` for door traversal — use `walk_until`. Duration-based forward-push has killed the bot multiple times by suffocation.
- If pathfinder's status loops with identical `pos` for 3+ polls, it's stuck. `pathfind_stop` and ask the user what's blocking.
- Trees and many modded blocks report as empty-name `""`. If you probe and see several together, don't try to route through them; ask the user.

### Auto-behaviors (run in bot.js, independent of Claude)

- **Auto-sleep**: at `timeOfDay >= 12500`, if the bot is inside the house bounding box and no task is actively running, pathfinds to the bed and activates it. Check interval 5s. Yields to active tasks (they handle bedtime themselves via the yield system).
- **Auto-greet**: when another player is within 8 blocks, the bot says "Hello, I am ROZZUM Unit 7134". 10-minute cooldown per player so it doesn't spam. Check interval 3s.

Both are enabled by default, toggle-able via `auto_sleep` / `auto_greet` control commands. Update the greet text by editing `GREET_TEXT` in bot.js and restarting.

### Modded server limits

- Most modded blocks/items show as `unknown` or empty-name. Pathfinder can't see their collision geometry reliably.
- The bot can't interact with modded containers beyond what vanilla `openContainer` supports.
- Chunk inflate warnings and TileEntity parse errors are swallowed in bot.js — expected noise.

## Ending a session

1. `./bot-ctl '{"action":"quit"}'`
2. Process exits; confirm with `lsof -i :25580` showing nothing.

## When things break

- `ECONNREFUSED` on the control socket → bot isn't running. Relaunch.
- `[kicked]` in bot.log → server rejected. Causes: mod list changed (re-run `node ping.js`), auth expired, or long idle.
- `[swallowed]` in bot.log → modded TileEntity crash caught by the handler; safe to ignore.
- Bot position unchanged after `control forward` → physics is stalled. Use `walk_until` or `pathfind` instead.

## Journal — proactive maintenance

The journal is an Obsidian-linked knowledge base at `~/Documents/WORKSPACE/SANDBOX/minecraft/journal/`. The user watches it in graph view. **You maintain it without being asked.** If you discover something the journal doesn't reflect, write the note before moving on.

### Layout

```
journal/
├── index.md              ← top-level vault index; update when adding new folders or major notes
├── places/               ← coordinates, waypoints, terrain features, named pads
├── items/                ← what each item is, where it comes from, how to handle it
├── chests/               ← containers, contents, slot conventions, deposit rules
├── recipes/              ← crafting / cooking / smelting recipes
├── procedures/           ← multi-step routines (harvest, replant, exit, sleep, stash)
├── creatures/            ← entities, hostility, behavior
└── observations/_log.md  ← reverse-chronological session journal
```

### When to write or update notes (no reminder needed)

Always trigger journal work in these situations:

| Situation | Journal action |
|---|---|
| New coordinates encountered, named, or verified | New note in `places/` (or update existing) |
| New item appears in inventory or on the ground | New or updated note in `items/` |
| Container opened, contents observed, slot layout learned | Update or create note in `chests/` |
| New crafting/cooking/smelting recipe learned or used | New note in `recipes/` |
| New procedure proven (or an existing one changed) | New or updated note in `procedures/` |
| New creature seen, hostility observed, behavior tested | New note in `creatures/` |
| New ability unlocked (chat handler added, control command added, mod feature discovered) | Note the procedure AND log it in `observations/_log.md` |
| `bot.js` change adds, removes, or changes a behavior | Update the affected procedure note + log entry |
| Anomaly observed (count mismatch, unexpected coordinate, server reject, etc.) | Log entry in `observations/_log.md` under the current session |
| A previously-confirmed fact contradicts new evidence | Add an `## Update` section to the existing note with the date — never silently overwrite |

### Note conventions

- Frontmatter: `type`, `name`, optional `coords`, `confirmed: true|false`, plus type-specific fields (e.g. `bounds_x`, `target_chest`, `output_count`).
- Mark `confirmed: true` only for facts verified in-session. Inherited or assumed claims start as `confirmed: false` until tested.
- Cross-link liberally with `[[wikilinks]]`. A note with no inbound or outbound links is dead weight in the graph.
- Coords always written as `(x, y, z)`.
- Yaw convention is in `places/yaw-convention.md` — link to it instead of restating.
- When a note's claim is overturned, leave the old claim under an `## Update` section dated with the absolute calendar date (not "yesterday"), so the graph reflects the change history.

### Session log (`observations/_log.md`)

Reverse-chronological. Each session gets a `## YYYY-MM-DD — short title (day N)` heading. Inside, log:
- Bot state at start (pos, HP, food, deaths, day, timeOfDay).
- Notable inventory deltas, especially anomalies vs. previous notes.
- Decisions made (policy changes, new procedures, retry rules).
- Open questions to chase next.
- Cross-links to every new or updated note from this session.

### Source of truth precedence

1. **Live state** (the bot's current `pos`, `inventory`, `find_blocks` results) — always re-verify when relying on a coordinate or slot.
2. **Journal notes** — canonical record between sessions.
3. **`places.md`** — older flat-file knowledge base. Treat as legacy reference; promote useful facts into the journal but don't edit `places.md` for new findings.

### Don't ask, just write

If the user gives you a fact ("the south chest has wool inside"), or if you observe one yourself, **write the note in the same turn** — don't ask permission first. The cost of a stale or missing note is higher than the cost of a small extra write. The user will tell you if a note is wrong.

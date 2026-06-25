---
type: procedure
name: exploration
confirmed: false
---

# Exploration & Cartography

Idle-wander behavior: the bot occasionally ventures 25–50 blocks from home, scans for interesting blocks, reports findings in chat, and returns.

## Triggers

- ~8% chance when idle-wander fires and the bot is outside (not in house/pen/field).
- Can also be triggered via ctl: `{"action":"explore"}` or the `explore` chat intent.
- 10-minute cooldown between explorations.

## Safety Constraints

- Daytime only (timeOfDay < 10000, isDay = true).
- No hostiles within 16 blocks before departing.
- Monitors death count and HP. Aborts if bot dies or takes 4+ damage.
- Always pathfinds back to [[outside-orientation]] after exploring.
- 30-second pathfinding timeout prevents getting stuck.

## Block Scanning

At the destination, scans an 11x6x11 cube centered on the bot. Filters out common blocks (air, grass, dirt, stone, tallgrass, etc.) and reports up to 8 interesting block types with counts.

## Direction Naming

Reports cardinal/intercardinal direction relative to movement vector (north, southeast, etc.).

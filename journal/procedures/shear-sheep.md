---
type: procedure
name: shear_sheep
location: south_fenced_area
tool: shears
slot_canonical: 40
status: confirmed
confirmed: true
first_tested: 2026-05-14
---

# Shear Sheep

Walk the **outside of the fence** along [[../places/south-fenced-area]] with shears equipped, right-clicking sheep on the other side. **Do NOT hop the fence** — the pen holds 28 sheep on land that ends at the pond ([[../places/water-hazard-west-of-potatoes]]) and the bot has no reliable way to extract itself once inside.

## How it works (vanilla 1.12.2)

- Hold `shears` in the active hotbar slot.
- Right-click (mineflayer: `bot.activateEntity(ent)`) on any sheep with wool.
- The sheep drops 1-3 wool blocks (color depends on the sheep) and becomes "naked" until it eats grass.
- Right-clicking a naked sheep is a **harmless no-op** — same pattern as right-clicking immature wheat.

## Packet mode: double > single

Vanilla 1.12.2 clients fire **two USE_ENTITY packets per right-click**: `mouse=0` (interact) followed by `mouse=2` (interact_at). mineflayer's `bot.activateEntity()` only sends the first; `bot.activateEntityAt()` adds the second. The server's sheep handler is more reliable when it receives both.

A/B test (2026-05-14, ~115 activations each pass, same flock):

| Mode | Activations | Wool picked up | Yield/activation |
|---|---|---|---|
| single | 115 | 1 | 0.009 |
| double | 119 | 3 | 0.025 |

Default in `bot-ctl` action `activate_entity` is now `mode=double`. Pass `mode: 'single'` to opt back into the older behavior.

## The walk

From [[../places/outside-orientation]] (-275, 64, 572):
1. Equip shears: `equip name=shears destination=hand`.
2. Face south: `look yaw=π pitch=0` so the bot is oriented toward the pen.
3. Walk west along **z=573** (one tile north of the fence's north edge at z=574). The fence keeps the bot out, but right-click still reaches sheep on the other side at z=575.
4. At each x in the range -274..-282, right-click every sheep within radius 4. **Don't filter for unsheared** — the no-op is harmless.

## First-test results (2026-05-14)

- 28 sheep in the pen, 9 walking spots covered.
- ~135 right-click activations across all spots.
- **30 wool collected by the user** from drops that landed inside the pen (out of pickup range from the bot at z=573).
- **Bot picked up 2 wool itself** — drops that bounced within ~1.5 blocks of z=573.
- HP unchanged, deaths 0, no damage.

## Why drops escaped the bot (historical — outside-fence approach)

When shearing from outside the fence (z=573), wool dropped near the south edge of the pen (z=576+) was out of pickup radius. The user collected those manually.

## Update (2026-06-05)

The bot now **enters the pen via the door** and shears from inside, eliminating the drop-pickup gap. See [[pen-door-traversal]] for entry/exit.

## Fence-hop attempts (2026-05-14, abandoned)

Tried multiple sprint/jump/forward combinations to clear the spruce fence at (-278, 64, 574). The bot always landed at z=574.08 (on top of the fence, not over it). Abandoned in favor of a door entrance — see update above.

## Update (2026-06-05)

The pen entrance is now a **real wooden door** at (-278, 64, 574), not a fence gate. Traversal uses the same pressure-plate pad + door-state-verify pattern as the house front door. See [[pen-door-traversal]] for the procedure.

## Current implementation

**Wired into bot.js** as `runShearSheep()` with chat trigger and pen door traversal. The bot enters the pen via the door at (-278, 64, 574), shears from inside, and exits. See [[pen-door-traversal]].

## Related
- [[../places/south-fenced-area]] — the pen
- [[../items/shears]] — the tool
- [[../items/wool]] — the drop (TBD note)
- [[right-click-harvest]] — same right-click mechanic, different domain (crops)

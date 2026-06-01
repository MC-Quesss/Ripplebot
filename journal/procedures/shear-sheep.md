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

## Why drops escape the bot

The pen is 5 wide (z=574..578) but the bot stays at z=573. Wool dropped near the south edge of the pen (z=576+) is well beyond the bot's auto-pickup radius. **The user has been collecting drops from inside the pen.**

## Open questions

- Could the bot **pause longer at each x** (e.g. 2s) to let auto-pickup catch drifting drops?
- Does shearing yield different wool colors? Need to inspect the inventory after a few passes — vanilla sheep are mostly white but ~5% are colored.

## Fence-hop attempts (2026-05-14, deferred)

Tried multiple sprint/jump/forward combinations to clear the spruce fence at (-278, 64, 574). The bot would **always land at exactly z=574.08** — meaning it lands *on top* of the fence, not over it. Variants tried:

- jump+forward simultaneously (no sprint)
- forward first, then jump after 250ms while walking
- sprint+forward+jump all held simultaneously, 1-tile and 2-tile runways
- holding jump longer (1.5s) while walking forward

Outcome in every case: bot reaches z=574.08, stops. Fence collision blocks horizontal travel even when bot is on top. Without a step-down on the south side, sprint-jumping over a single fence isn't enough.

**User decided to put a `spruce_fence_gate` back at (-278, 64, 574)** as the canonical bot entrance. Gate-traversal is the next thing to implement: `activate_block` to open, walk through, `activate_block` again to close so sheep stay penned.

See [[../places/south-fenced-area]] for the gate location.

## Implementation hint for a chat handler

A `runShearWalk()` could:
1. Verify shears in inventory; equip; face south.
2. Walk z=573 from x=-274 west to x=-282, stopping at each x.
3. At each stop: nearby_entities radius=4, filter to sheep, activate each.
4. Wait 1-2s at each spot for drift.
5. Optionally repeat the walk eastward to catch sheep that moved into range during the west pass.

**Wired into bot.js** as `runShearSheep()` with chat trigger and pen door traversal. The bot enters the pen via the door at (-278, 64, 574), shears from inside, and exits. See [[pen-door-traversal]].

## Related
- [[../places/south-fenced-area]] — the pen
- [[../items/shears]] — the tool
- [[../items/wool]] — the drop (TBD note)
- [[right-click-harvest]] — same right-click mechanic, different domain (crops)

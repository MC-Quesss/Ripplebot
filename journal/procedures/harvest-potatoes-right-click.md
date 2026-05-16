---
type: procedure
name: harvest_potatoes_right_click
location: potato_patch
status: confirmed_single_tile
confirmed: true
first_tested: 2026-05-14
companion_to: right_click_harvest
---

# Right-Click Harvest — Potatoes

The same `activate_block` technique that works for [[../places/wheat-field|wheat]] also works for [[../places/potato-patch|potatoes]]. Confirmed today on a single mature tile.

## First test (2026-05-14, day 41330)

- **Stand spot:** (-284.5, 63, 577.5), range=1 from target
- **Target:** mature potato block at (-285, 63, 578), `metadata: 7`
- **Action:** `./bot-ctl '{"action":"activate_block","args":{"x":-285,"y":63,"z":578}}'`
- **Server reply:** `{"ok":true,"name":"potatoes"}`

| | Before | After | Δ |
|---|---|---|---|
| potato (inv) | 8 | 10 | **+2** |
| baked_potato | 14 | 14 | 0 |
| Block at target | potatoes (md=7) | potatoes (replanted) | replanted |

## What this means

The mod's right-click harvest behavior generalizes from wheat to potatoes — block name changes, mechanic doesn't. **Each mature potato yields 2 raw potatoes** (consistent with vanilla's 2-3 drop range, but only 2 in this instance — may need more samples to confirm distribution).

## Full water-safe strip run (2026-05-14, day 41330)

10 tiles in the water-safe subset (x=-287..-284, z=576..579), boustrophedon, range=1 pathfind before each activation, no metadata filter.

| | Before | After | Δ |
|---|---|---|---|
| potato (inv) | 10 | 25 | **+15** |
| HP / food / deaths | 20 / 19 / 0 | 20 / 19 / 0 | unchanged |

10 activations → 8 produced drops (immature tiles were the no-op). +15 potato is consistent with 7×2 + 1×1 = 15, so 7 tiles yielded 2 potatoes and 1 yielded 1 (vanilla potato drop is 1-4, but 2 was modal in this run).

**Post-harvest sweep yielded +0.** Range=1 stand-spot discipline kept every drop in pickup radius. For a compact patch (10 tiles), the sweep was redundant — confirming the hypothesis from [[nautilus-sweep-pattern#Future improvement]].

## Outstanding for next session

- **Map the western strip** (x ≤ -288, z ≥ 580): 33 potato blocks are unmapped, same area as the water hazard. Need to find safe stand-spots tile by tile, not bulk pathfind.
- **Carrots** — we have not seen carrots yet. Same mechanic likely.
- **Wire `runHarvestPotatoesRightClick` into bot.js + chat handler** — currently the technique only works via Python driver or hand-issued `bot-ctl` calls.

## Implementation status (2026-05-14)

**Wired into bot.js as the chat default.** `runHarvestPotatoesRightClick({ user })`:
- Pre-flight: daylight check, hostiles check, baseline pos/HP/deaths.
- Exits house if needed (via `runGoOutside` retry-wrapper).
- Pathfinds to `potato_approach` (-284, 63, 577).
- `find_blocks names=["potatoes"]` → filter to `x >= -286` (water-safe clip from [[../places/water-hazard-west-of-potatoes]]).
- Boustrophedon by z, range=1 pathfind before each tile, `activate_block` per tile, no metadata filter.
- Full-coverage sweep over the same boustrophedon path.
- Re-enter house, then ask the user in chat: "bake or stash?" If bake → hands off to [[bake-potatoes]]. If stash → deposits to [[../chests/house-kitchen-chest]]. If no reply after 60s → keeps potatoes in inventory.

Chat trigger: any "harvest potatoes" / "go get potatoes" phrase (existing `harvest-potato` rule, now dispatching to right-click).
Control socket: `./bot-ctl '{"action":"harvest_potatoes"}'` (right-click). Legacy brute is preserved as `harvest_potatoes_brute` for fallback if right-click ever misbehaves.

The legacy `runHarvestPotatoes` (left-click + replant + sweep) is still in bot.js, no longer the chat default. Will likely be deleted in a future cleanup pass once right-click has more flight time.

## Related
- [[right-click-harvest]] — wheat version, the original
- [[../places/potato-patch]]
- [[../items/potato]]

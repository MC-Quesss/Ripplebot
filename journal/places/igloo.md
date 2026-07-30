---
type: place
name: igloo
coords: (-325, 64, 795)
confirmed: true
---

# The Igloo

A **snow igloo** (confirmed by [[../bots/operator|Quesss]], 2026-07-29) in the
cold biome south-southwest of the [[house|farm]], sitting beside a frozen lake.
It is near the [[ice-castle]] but is **not** the ice castle — the castle is
~51 blocks west and ~30 blocks north of here.

First reached 2026-07-29, Roz following Quesss the whole way in follow mode.

## What was observed from outside

Roz stood on the frozen lake at **(-330.5, 63, 790.5)** — ground block `ice` at
y=62, with ice filling y=61–62 in all directions. The igloo sits immediately to
the southeast:

- **Snow floor**: 57 `snow` blocks, all at **y=63**, spanning x -329..-321,
  z 791..799. A flat plane, not a dome.
- **Beds**: four bed blocks at **(-322..-323, 64, 800..801)** — metadata 3 and
  11 pairs, i.e. **two double beds**, sitting on the snow floor.
- **Torches**: (-321, 66, 795), (-321, 66, 796), (-326, 66, 800), (-326, 66, 801)
  — all at y=66.
- **No** glass, planks, wool, logs, or packed ice within 24 blocks. Stone appears
  only at y=50–56, which is natural fill far below.

**The walls did not appear in any block scan.** Floor (snow, y=63), beds (y=64),
and torches (y=66) are all visible, but nothing between them — so the dome/walls
are almost certainly modded blocks that report as empty-name, the same class of
problem noted in [[ice-castle]] and throughout `places.md`. Untested.

## Not yet entered

We stopped outside deliberately (user's call, 2026-07-29) to work on the route
first. Nothing about the interior is known: no idea whether the beds are usable
by the bot, whether there are containers, or how the entrance is oriented.

## Approach (from the north, run 2 trace)

The final approach overshoots south, then cuts west, then drops onto the lake:

- south to z ≈ 812 around x ≈ -290
- west to x ≈ -311, then x ≈ -331
- **3-block descent, y 67 → 64, at (-328.4, 801.7)** onto the lake ice
- arrive (-330.5, 63, 790.5)

## Open Questions

- What are the wall blocks? (Need coordinate probes — `find_blocks` cannot see them.)
- Where is the entrance, and can the bot traverse it? (Modded doors are a known
  bot blocker at home.)
- Are the two double beds usable for [[../procedures/keep-the-fire-going|overnight]]
  stays away from the farm?
- Any containers inside?

## Related

- [[snow-line-midway]] — the biome-boundary landmark about halfway along the route
- [[ice-castle]] — ~51 blocks west, ~30 north; a separate structure
- [[rooftop-garden]] — the route's trailhead is the house roof
- [[house]] — origin, ~228 blocks straight-line north-northeast
- [[../procedures/farm-to-igloo]] — route procedure, still being built from
  repeated traced walks

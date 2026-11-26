---
type: recipe
name: natura_trees
confirmed: true
source: natura-1.12.2-4.3.2.69.jar (BlockOverworldSapling, OverworldTreeGenerator bytecode) + config/natura.cfg from the oceanside modpack, read 2026-11-24
---

# Natura trees: what a sapling needs to grow

Quesss asked about **tigerwood** saplings on 2026-11-24. Tigerwood is from **Natura**, not Forestry, so the genome reading in [[forestry-tree-mutations]] does not apply: Natura saplings have no genes. The rules below come straight from the jar the server runs (version 4.3.2.69, the same as in `data/mods.json`).

Tigerwood is the `tiger` variant of the `natura:overworld_sapling` block, along with maple, silverbell and amaranth. Its in-game name is "Tigerwood Sapling", with the tooltip "Wild Grain".

## The four conditions

1. **Light 9 or more above it.** The sapling class does not override vanilla `BlockSapling.updateTick`. Each random tick with light ≥ 9 has a 1-in-7 chance to advance; the first advance sets stage 1, the second grows the tree. **Bone meal works** (vanilla `IGrowable`).
2. **Plain vanilla dirt or a vanilla grass block.** `findGround` compares the block itself against `Blocks.DIRT` and `Blocks.GRASS`. Anything else does not count, even if a sapling can be planted on it: modded grass or dirt (such as the bee cove's type 1058 "silty grass"), farmland, podzol, coarse dirt. The block above the soil must not be opaque.
3. **The soil block must sit at y 65 or higher.** `findGround` scans down from the sapling while `y > seaLevel`, and the modpack's `config/natura.cfg` sets `"Sea level"=64` (its comment: "Controls what the lowest Y level trees can grow at, make lower if the tree will not grow"). So soil at y 64 or lower is never found, the generator returns y 0, and the tree silently does not grow. **The farm's ground is at y 63–64, so a tigerwood planted there never grows.** (In a flat world it uses `"Flat Sea level"=1`.)
4. **Room.** Tigerwood is built with `OverworldTreeGenerator(6, 4, …)`: trunk height 6 + random(0..3) = **6–9 blocks**. `checkIfCanGrow` scans from the sapling up to height + 1, about 1 block around the trunk, 2 blocks at the top two layers, and fails on anything that is not leaves or the sapling itself. Keep that column clear. (This part of the reading is approximate.)

The same four rules hold for **maple** (4 + random 2), **silverbell** (4 + random 2) and **amaranth** (9 + random 8, a tall tree) from the same sapling block.

## The other Natura trees (same jar, same day)

Every overworld Natura sapling grows on the vanilla tick: **light ≥ 9 above it, 1 in 7 per random tick, two stages; bone meal works.** What differs is the soil search, the shape, and in one case a whole forest of saplings.

| Sapling | Tree size (code) | Soil the grower looks for | Sea-level rule (soil at y ≥ 65)? |
|---|---|---|---|
| Maple, Silverbell | trunk 4–5 | vanilla dirt or grass | **yes** |
| Tigerwood | trunk 6–9 | vanilla dirt or grass | **yes** |
| Amaranth | trunk 9–16, a tall tree | vanilla dirt or grass | **yes** |
| Willow | 4–8 | vanilla dirt, grass **or sand**; the code handles water around it | **yes** |
| Sakura | its own shape | vanilla dirt or grass | **yes** |
| Eucalyptus | 6–8 | whatever the sapling sits on (plain plant check, no exact-block search) | **no**: grows at any height |
| Hopseed | 2–4, a small tree | whatever the sapling sits on (plain plant check) | **no**: grows at any height |
| **Redwood** | enormous | vanilla dirt or grass | **yes** |

- **Redwood needs a crowd.** When a redwood sapling tries to grow, it counts redwood saplings in the **7 × 7 square** centred on itself (`checkRedwoodSaplings`, offsets −3..+3). Fewer than **40 of the 49** and nothing happens. With 40 or more, it clears the saplings and builds the giant. So: plant a full 7 × 7 (or nearly) and bone-meal the middle. Also, `"Generate Redwood Trees"=false` in this modpack, so no wild redwoods exist; saplings must come from somewhere else.
- **Easy pick for low ground:** eucalyptus and hopseed ignore the sea-level rule, so they will grow on the farm's y 63–64 ground where tigerwood would not.

## Nether trees

`BlockNetherSapling` (bloodwood, ghostwood, fusewood, darkwood) will only sit on **soul sand, netherrack, or Natura's tainted soil** (`canGrowOnBlock`). It does not override the vanilla growth tick, so it still wants **light ≥ 9**; the Nether has no daylight, so that means torches or glowstone beside it. (Read from the code; not yet tried.)

## Berry bushes

`BlockOverworldBerryBush` (raspberry, blueberry, blackberry, maloberry):
- Each random tick: **1 in 20** chance to grow, and only with **light ≥ 8** at the bush.
- Four ages, 0–3; **age 3 is ripe**.
- A ripe bush has a 1 in 3 chance per growth to put a **new bush on top**, if the space above is air, up to **3 bushes tall**.
- The constructor registers it with fire (flammable).

## Crops

Barley and cotton are Natura crops. In this modpack `"Drop barley seeds from grass"=true` and `"Drop cotton seeds from grass"=true`, so their seeds come from breaking tall grass, like wheat seeds. `"Enable wheat to flour recipe"=true` too. (Growth rules not read yet.)

## Confirmed in the world — 2026-11-24
Quesss's tigerwood sat on soil at **y 63** and never grew. They raised it a couple of blocks, and **then it grew**. That is condition 3 seen from outside: same sapling, same light, only the height changed. The rule read from the code matched what happened.

## Still to learn
- Where the grown tigerwood stands; Roz has not seen it herself.
- What a Natura sapling reads as in Roz's inventory (item id). Quesss could hand her one.

Related: [[forestry-tree-mutations]], [[../places/bee-cabin]]

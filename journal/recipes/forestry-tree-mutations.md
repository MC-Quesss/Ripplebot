---
type: recipe
name: forestry_tree_mutations
confirmed: true
source: forestry_1.12.2-5.8.2.422.jar (TreeDefinition bytecode, read 2026-10-23)
---

# Forestry tree mutations (conifers)

Read directly out of the server modpack's Forestry jar, not from a wiki. The FTB wiki page is paywalled.

| Result | Parents | Chance |
|---|---|---|
| **Coast Sequoia** (`forestry.treeSequoia`) | Larch × Pine | 5% |
| Larch | Spruce × Birch, or Spruce × Oak | 10% each |
| Pine | Spruce × Larch | 10% |
| Maple | Spruce × Larch | 5% |

- **Balsam fir is not in Forestry's table at all.** It's an Extra Trees species (UID `balsamfir`, no `forestry.` prefix), so pine × fir can never give a sequoia. It is the first step toward cedar, though (see below).
- A mutation needs pollen from one species to land on the leaves of the other. Both species have to be growing side by side, and bees carry the pollen. One sapling (2026-10-23) carried a **dark oak** gene, so pollen is reaching these trees from outside the pine and fir group.
- Every sapling has two copies of each gene: an active one and an inactive, hidden one. The server sends the whole genome as item NBT **even for unanalyzed saplings**. Roz reads it with `inventory` (species only, because the NBT is cut off at 400 characters) or with the `ground_items` ctl (full genome for every dropped item nearby).

## Extra Trees (binnie-mods-1.12.2-2.5.1.203.jar, ExtraTreeMutation bytecode)

| Result | Parents | Chance | Condition |
|---|---|---|---|
| **Silver Fir** (*Abies alba*; the code calls it `Fir`) | Pine × Balsam Fir | 10% | — |
| **Great Cedar** | Silver Fir × Larch | 10% | at least 60 blocks above bedrock |
| Douglas Fir | Silver Fir × Spruce | 10% | at least 60 |
| Hemlock | Pine × Silver Fir | 10% | at least 80 |
| Juniper | Raspberry × Silver Fir | 10% | — |

- **Path to cedar: pine + balsam fir → silver fir, then silver fir + larch → Great Cedar.** Balsam fir (*Abies balsamea*, UID `balsamfir`) and silver fir are different species.
- 2026-10-23: none of the ~200 saplings read at the bee cabin had silver fir (or larch, or cedar) in either gene copy.
- **Why: the climate gate.** `ExtraTreeMutation.getChance` returns **0** unless the biome at the tree has temperature 0–2 and rainfall 0–2. The silver fir and cedar mutations leave those defaults in place, and all of the Extra Trees mutations go through this check. The bee cove is BoP **snowy_forest** (biome id 86 per `config/biomesoplenty/biome_ids.json`), which BoP defines with **temperature −0.25** and rainfall 0.5. So **no Extra Trees mutation can ever happen at the cove.** Forestry's own mutations (sequoia, larch, pine) have no climate check, which is why sequoias appeared there. Breed silver fir and cedar in a biome at 0 or warmer.
- **Great Cedar is the end of its line** (checked in the `ExtraTreeMutation` bytecode, 2026-10-25). Cedar shows up only as a result (silver fir × larch); no Extra Trees mutation takes it as a parent, and Forestry's table doesn't mention it. Great cedars first grew on 2026-10-25 (Quesss).
- Mineflayer has no data for modded biome ids. `block_at_abs` now returns a `biome` object, but for id 86 it only shows the defaults (temperature 0), so look the biome up in BoP's code instead.

Related: [[../places/bee-cabin]], [[../observations/_log]]

## Update — 2026-10-24: a warm cross

Quesss built a second pine and balsam fir cross in **BoP meadow (id 69)**, north-west of the farmhouse: [[../places/meadow-bee-cross]]. The mod jar defines meadow with **temperature 0.4 and rainfall 0.7** (`BiomeGenMeadow` constants), which passes the Extra Trees 0–2 gate. So the **pine × balsam fir → silver fir** mutation (10%) can happen there. The BoP config and jar are in the local FTB instance at `~/Library/Application Support/.ftba/instances/oceanside/`.

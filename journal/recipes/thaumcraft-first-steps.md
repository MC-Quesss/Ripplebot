---
type: recipe
name: thaumcraft_first_steps
confirmed: true
source: Thaumcraft-1.12.2-6.1.BETA26.jar from the oceanside modpack (research/basics.json, lang/en_us.lang, ConfigRecipes, RecipeMagicDust, PlayerEvents bytecode), read 2026-11-24
---

# Thaumcraft: the first steps

Quesss asked Roz on 2026-11-24 to "become a wizard". This is the start: how a player gets into Thaumcraft 6, read out of the jar the server runs, not from a wiki. **Research is per player**: it lives on the player (a capability), so each person walks this path for themselves. Roz can read the rules, but not research on anyone's behalf.

## 1. The dream

- **Pick up a vis crystal** (`ItemCrystalEssence`, shown as "<Aspect> Vis Crystal"). The first pickup quietly records `!gotcrystals` on you (`PlayerEvents.pickupItem`).
- **Then sleep in a bed.** On waking (`PlayerEvents.wakeUp`) you get a book, *Strange Dreams*, and the message "You awaken from a strange dream". A night skipped by the crew still counts as waking.
- The book describes the next step.

## 2. Salis Mundus (the magic dust)

A special recipe (`RecipeMagicDust`) in an ordinary crafting grid, any arrangement. It needs exactly:
- 1 **bowl**
- 1 **flint**
- 1 **redstone dust**
- 3 **vis crystals of three different aspects** (two of the same aspect fails)

Nothing else may be in the grid.

## 3. What the dust does when sprinkled (right-click a block with it)

| Sprinkle on | Becomes | Needs |
|---|---|---|
| A **bookshelf** (vanilla, or any `bookshelf` ore-dict) | the **Thaumonomicon** | the dream |
| A **crafting table** (or any `workbench` ore-dict) | the **Arcane Workbench** | First Steps stage 1 (from the book) |
| A **cauldron** | the **Crucible** | Discovering Alchemy stage 1 |
| Certain multiblocks | Infernal Furnace, Infusion Altar, Thaumatorium, … | later research |

## 4. The opening research path (the book's Basics tab)

1. **First Steps:** make the Arcane Workbench, then a **Thaumometer**, and scan things (gives Observation knowledge in Basics).
2. **Types of Knowledge:** *Observations* come from scanning the world; *Theories* come from working at a Research Table.
3. **Theorycrafting:** craft **scribing tools** and a **research table**. Research uses paper and ink, and "inspiration" (light bulbs) per session; some cards consume items (marked with a gold !).
4. **Discovering Alchemy** → Crucible → first crucible recipe is **Nitor** (a floating, endless light from glowstone plus essentia). The crucible sits over heat, filled with water.
5. From there the book branches: **Auromancy** (vis, casting), **Artifice** (devices), **Infusion** (altar crafting), **Golemancy** (needs all three), and **Eldritch**.

## Dangers the book itself warns about

- **Flux:** spilled essentia becomes Flux in the local aura (purple puffs). It clogs the aura so vis stops refilling, and can overflow. Flux Rifts can open later; there is research to close them.
- **Warp:** forbidden research and some crafted objects give Warp: lapses, pain, hallucinations, some of them real. Some fades; **permanent Warp never goes away.**

## Where to find vis crystals
- **Underneath the [[../places/mtac|MTAC]]: many of them** (Quesss, 2026-11-24). Roz has not been down to see them.

## Who is studying
- Quesss, 2026-11-24: two students are working with a cauldron on the **Yacht**. They have found every crystal variety; how far their research has gone is unknown. Roz has not seen the Yacht workspace.

## Still to learn
- How far the Yacht students have taken it; Roz cannot see anyone's research.
- The rest of the tree (alchemy, artifice, infusion, golemancy, eldritch), branch by branch, when someone needs it.

Related: [[natura-trees]], [[forestry-tree-mutations]]

---
title: Marcadia Journal — Index
maintained_by: Roz (ROZZUM Unit 7134)
world: Marcadia (Oceanside Survival, 1.12.2 Forge)
---

# Marcadia Journal

A network of notes mapping the known parts of this world. Each note is a single concept (place, item, chest, recipe, creature, procedure, observation) and links to its neighbors with `[[wikilinks]]`. Open this folder as an Obsidian vault to see the graph.

## Folders

- **[[places/]]** — coordinates, named locations, terrain features
- **[[items/]]** — what each item does, where it comes from, how to handle it
- **[[chests/]]** — every container's contents, slot conventions, deposit rules
- **[[recipes/]]** — crafting and cooking recipes (bread first, more later)
- **[[procedures/]]** — multi-step routines (exit house, sleep, [[procedures/right-click-harvest|right-click harvest]], [[procedures/harvest-potatoes-right-click|potato harvest]], [[procedures/stash-wheat|stash wheat]], [[procedures/deposit-named|deposit named]], [[procedures/bake-potatoes|bake potatoes]], [[procedures/project-bench-crafting|3×3 bench crafting]], [[procedures/shear-sheep|shear sheep]], [[procedures/tell-joke|jokes]], [[procedures/emotes|emotes]], [[procedures/idle-autonomy-toggle|stand down / chill]], [[procedures/claude-brain-mode|Claude brain mode]], [[procedures/storytelling-nights|storytelling nights]], [[procedures/exploration|exploration]])
- **[[creatures/]]** — entities encountered, hostility, behavior, [[creatures/named-sheep|named sheep (Frue & Fluffy)]]
- **[[observations/]]** — session-by-session journal entries; raw notes that may later promote to canonical entries
- **[[bots/]]** — each bot's own first-person diary, written **by the bot itself** (via its LLM voice) once per in-game day at bedtime; one file per persona, newest entry last

## Conventions

- **Coordinates** are always written `(x, y, z)` and are world coordinates from `pos`.
- **Yaw**: 0 = north (-z), π/2 = west (-x), π = south (+z), -π/2 = east (+x). See [[places/yaw-convention]].
- **Status fields** in frontmatter:
  - `confirmed: true` — verified in-session
  - `confirmed: false` — inferred or copied from someone else's notes; needs verification
- Every claim should be either confirmed or marked as a hypothesis.
- When a note contradicts something I previously believed, leave the old claim in an `## Update` section with the date — don't silently overwrite.

## Entry points

- [[places/house]] — the safe space
- [[places/wheat-field]] — primary work site
- [[places/potato-patch]] — secondary work site
- [[places/water-hazard-west-of-potatoes]] — oval pond west of the potato patch, keep out
- [[procedures/right-click-harvest]] — current main loop (wheat)
- [[procedures/harvest-potatoes-right-click]] — confirmed for potatoes (single-tile)
- [[recipes/bread]] — first recipe learned
- [[observations/_log]] — session log

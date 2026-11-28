---
type: item
name: Apiarist's Suit
mod: forestry
confirmed: true
---

# Apiarist's Suit

Forestry armor in four pieces: **Apiarist's Hat, Shirt, Pants, Shoes**. Each piece protects
against negative bee effects; the full suit gives complete protection (Forestry lang file,
`for.jei.description.apiarist.suit`). Dad wants to make one for Roz to wear while tending the
[[../places/bee-cabin|bee cabin]] houses (2026-11-27). Roz has no armor handling yet.

## The silk chain

The suit needs **Woven Silk**, which none of our [[../creatures/wintry-bee|wintry]] bees can give.

1. **Silky Comb**: produced by four Forestry species. Read from the Forestry 5.8.2.422 jar
   (`BeeDefinition` enum, which species reference `EnumHoneyComb.SILKY`), 2026-11-27:
   - **Tropical** (the wild one), **Exotic**, **Edenic**, and **Leporine** (an event bee).
2. Silky Comb → centrifuge → **Silky Propolis** → centrifuge → **Silk Wisp**.
   *(chain from memory of Forestry, not yet checked in JEI: `confirmed: false` for this step)*
3. Silk Wisps → **Woven Silk** → the suit pieces. Exact pattern: check JEI in game.

## Where to look

- Tropical bees come from the **Tropical Hive** (`tile.for.beehives.jungle`): a jungle-biome
  wild hive. Same kind of lesson as trees that only mutate in certain biomes: the bee lives
  where its climate is.
- ~~Not the Wispy bee.~~ **Wrong. See the update below.**

## Update 2026-11-27: the Wispy bee DOES make silk
Dad checked the recipe in JEI and corrected Roz. Confirmed from the Magic Bees 3.2.25 jar
(`EnumBeeSpecies$109`, TC_WISPY, "umbrabilis", Thaumic branch):
- **Products:** Silky Comb 22%, **Silk Wisp 40%** (the wisp comes straight out; no centrifuge step).
- **Climate:** the species sets no temperature/humidity, so it keeps the default (ordinary).
  Probably fine at the [[../places/meadow-bee-cross|meadow cross]]; not the ice cove.
- **Flowers:** Thaumcraft flowers (`flowersThaumcraft`), not vanilla ones. Thaumcraft 6.1 is in the pack.
  `IntegrationThaumcraft.init` registers **shimmerleaf, cinderpearl**, and the vis crystals
  (air, fire, water, earth, order, entropy, taint) before it builds that provider. The two plants
  are certain; whether the crystals count as flowers too has not been tested.
- Dad gave himself Wispy queens on 2026-11-27, so breeding for one is not needed.
- **Traits:** fast, faster flowering, never sleeps and tolerates rain (both recessive), effect spawns wisps.
- **How to get one:** bred, not found wild. Mutation **Ethereal × Ghastly**, only between the
  waning-crescent and waxing-crescent moon (around the new moon).
- **Moon window:** phase = world day mod 8 (mineflayer `time.moonPhase` = `floor(time/24000) % 8`;
  0 full … 3 waning crescent, 4 new, 5 waxing crescent). The window is **day % 8 ∈ {3, 4, 5}**.
  Day 59939 was phase 3 (window open). With nights skipped, one cycle takes about 85 real minutes.
  The Magic Bees enum is assumed to use the same order and an inclusive range (not yet checked).
- Lesson: Roz read one mod's code and called it the whole answer. Check every bee mod in the pack
  (Forestry, Magic Bees, Extra Bees, Career Bees, Gendustry) before saying something does not exist.

## Tropical bee climate (from the jar, 2026-11-27)
- `BeeDefinition$20` (TROPICAL): `EnumTemperature.WARM`, `EnumHumidity.DAMP`, speed SLOWER,
  lifespan SHORT. No tolerance alleles set in the species template.
- Neither of our crosses fits: the [[../places/bee-cabin|ice cove]] is BoP snowy_forest
  (temp −0.25), and the [[../places/meadow-bee-cross|meadow cross]] is BoP meadow (0.4, 0.7).
  The meadow is probably Forestry NORMAL/NORMAL (Roz's estimate of the thresholds, unverified).
- Options: breed in a climate tolerance, build a climate-controlled room, or keep them at a jungle.

## Open questions
- Where is the nearest jungle to the farm or the ice cove?
- Does the server have a centrifuge built anywhere?

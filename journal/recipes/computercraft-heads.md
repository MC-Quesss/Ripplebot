---
type: recipe
name: computercraft_heads
source: cc-tweaked-1.12.2-1.89.2.jar from the oceanside modpack (assets/computercraft/recipes/skull_cloudy.json, skull_dan200.json, normal_monitor.json), read 2026-11-25
confirmed: true
---

# ComputerCraft player heads

Quesss had a **Cloudhunter's Head** and asked on 2026-11-25 whether it could be crafted. It can. CC: Tweaked ships two easter-egg recipes. Both turn a mob head into a modder's player head. The rules below come straight from the jar the server runs, not from a wiki.

| Result | Recipe (shapeless, 2 items) |
|---|---|
| **Cloudhunter's Head** (`minecraft:skull:3`, SkullOwner `Cloudhunter`) | any mob head (`minecraft:skull`, any type) + **Monitor** (`computercraft:peripheral:2`) |
| **dan200's Head** (`minecraft:skull:3`, SkullOwner `dan200`) | any mob head + **Computer** (`computercraft:computer:0`) |

**Monitor:** 8 stone (ore-dict `stone`) around 1 glass pane. Shaped `###/#G#/###`.

The peripheral metadata, read from the same jar: 0 disk drive, 1 wireless modem, **2 monitor**, 3 printer.

## Who they are

- **Cloudhunter** is a mod author. In this pack he wrote LetsEncryptCraft (package `uk.co.cloudhunter`) and co-wrote MineTogether.
- **dan200** wrote the original ComputerCraft.
- Actually Additions has its own Cloudhunter easter egg: a Smiley Cloud named `cloudhunter` (or `cloudy`) renders something extra. That class (`SmileyCloudEasterEggs`) has not been read in detail. *Update 2026-11-26:* read now. Every egg is a cosmetic `renderExtra` only, with no gifts; see [[../items/smiley-cloud]].

Related: [[thaumcraft-first-steps]], [[natura-trees]] (other answers read from the modpack jars).

## Other head recipes in the pack (checked 2026-11-25)

Every recipe JSON in every mod jar was scanned for `SkullOwner`. Only the two CC: Tweaked recipes above make a player head. The pack's own CraftTweaker script (`scripts/00_recipe_changes.zs`) adds one more head recipe:

- **Wither skeleton skull** (`minecraft:skull:1`): a skeleton skull (`minecraft:skull:0`) in the centre, ringed by 8 Quark **black ash**. Shaped.
- Wither skeleton skulls are then an ingredient in Magic Bees' *Essence of Scornful Oblivion* (`magicbees:resource:11`): 4 wither skulls with `magicbees:resource:8` and `:9` at the corners.

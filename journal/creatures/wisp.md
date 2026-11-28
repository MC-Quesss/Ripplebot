---
type: creature
name: Wisp
mod: thaumcraft
entity: thaumcraft:wisp
confirmed: true
---

# Wisp

A small hostile Thaumcraft spirit. **Wispy bees** (Magic Bees, see
[[../items/apiarist-suit|apiarist suit]]) spawn them near their hives as the species effect.

## What the code says (Thaumcraft 6.1.BETA26, `EntityWisp`, read 2026-11-27)
- Flying mob (`EntityFlying`, `IMob`). Base stats include 22.0 and 3.0, probably
  max health and attack damage (not confirmed which is which).
- **Targeting:** every so often it calls `World.getClosestPlayerToEntity(this, 16.0)`.
  That search skips only spectators. It does **not** check invisibility, so a Botania
  Invisibility Cloak (which just applies the vanilla Invisibility effect while it has mana)
  does nothing against wisps. Vanilla mobs use a different search that does respect it.
- It drops its target if the player is in creative mode (`capabilities.disableDamage`) or dead.
- It despawns itself on Peaceful.
- Taking damage makes it target the attacker.

## Bots and wisps
- Wisps come in through the Forge mod channel, so they never show up in a bot's
  `bot.entities`. The watchdog cannot see them.
- Defense: every 20 s the bot sends `/kill @e[type=thaumcraft:wisp]` (the whole world, any
  distance). It skips this while asleep. Toggle it with ctl `wisp_sweep`
  (`{"enabled":false}`). The Wispy queens are untouched; only their wisps die.
- Each kill shows as a `Killed Wisp` admin notice. Other bots' chat routers react to those
  notices. `/gamerule logAdminCommands false` hides them.

---
type: creature
name: blizz
hostile: true
mod: Thermal Foundation
confirmed: true
---

# Blizz

Hostile mob from [[Thermal Foundation]]. Ice-themed variant of the Blaze — shoots
ice shard projectiles. Killed both Muse and Roz on 2026-06-26.

## Detection

Reports `name: 'unknown'` in mineflayer (modded entity, not in vanilla
minecraft-data). Cannot be proactively detected by the hostile watchdog's
`HOSTILE_NAMES` check.

**Damage-reactive kill** added 2026-06-26: when the bot takes damage and no
vanilla hostile is nearby, but `unknown` entities are within 16 blocks, fires
`/kill @e[type=thermalfoundation:blizz,r=16]` (plus [[blitz]] and [[basalz]]).
5-second cooldown between triggers.

## Related mobs

Other Thermal Foundation hostiles with the same detection problem:
- [[blitz]] — lightning variant (`thermalfoundation:blitz`)
- [[basalz]] — earth variant (`thermalfoundation:basalz`)

---
type: creature
name: squirrel
hostile: false
confirmed: true
---

# Squirrel

Modded ambient critter. Reports an **empty entity name** over protocol, like all
modded mobs — indistinguishable from [[butterfly]] or static field hardware by
name alone.

## Detection (bot.js classifier, 2026-06-11)

A real squirrel is a **fast ground mover**: observed darting ~13.5 blocks in one
7s watcher sample (entity id 110267911, near the wheat field), staying at ground
level (solid block under feet, no vertical wobble).

Classifier rules in `classifyUnknownEntity` (bot.js ~1707):
- No horizontal displacement ≥1.5 blocks between 7s samples → not wildlife at
  all (filters the stationary empty-name entities ringing the farm).
- Mover at y > bot+2, or with vertical wobble ≥0.5, or air under feet →
  [[butterfly]], not squirrel.
- Darting ≥3 blocks/sample at ground level → squirrel.
- One comment per individual entity id per 10 min (dedupe map).

## History

Before 2026-06-11 the detector treated *any* nearby empty-name entity as a
squirrel, including a stationary 3×4 grid of unknown entities in the wheat
field (ids 110268990–995, 110269010–015, block-centered coords, never move —
presumed mod field hardware, see [[observations/_log]]). This caused squirrel
chatter every ~97s and complaints from Dad to both bots.

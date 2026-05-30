---
type: place
name: house_hopper
coords: [-266, 65, 573]
container: true
container_size: 5
confirmed: true
---

# House Hopper

A **vanilla hopper** on the house floor at **(-266, 65, 573)** — same x-column as the
[[../chests/house-kitchen-chest|kitchen chest]] but down at y=65 and ~4 tiles south
(chest is y=67, z=569). Being vanilla, the bot reads it natively as `hopper` (unlike the
modded chest contents). 5 slots.

Placed/observed 2026-05-30. Presumably feeds whatever sits below or beside it (a hopper
pipes its contents into the container it points at) — the user is building something here.

## Use — wheat routing after harvest

Since harvests now keep the wheat on hand (see [[../procedures/right-click-harvest]] update),
the bot **asks where the wheat should go: hopper or chest.** Mirrors the potato bake/stash
question.

- Ask line from `WHEAT_ASK_LINES`; waits **30s** for a reply.
- "hopper" → deposits wheat here; "chest"/"stash"/"store"/"deposit" → kitchen chest.
- **No answer in 30s → "Ok, I'll just hang on to it I guess"** and keeps the wheat on hand.
- Deposit path: come inside, pathfind to `chest_approach` (-267,65,570) — within reach of
  both the chest (~2.4) and this hopper (~3.2) — then `openContainer` + `win.deposit`.

`bot.js`: `HOPPER = { x: -266, y: 65, z: 573 }`; logic in `runHarvestRightClick` tail.

## Related
- [[../chests/house-kitchen-chest]] — the alternative wheat destination
- [[../procedures/right-click-harvest]] — the harvest that triggers the question

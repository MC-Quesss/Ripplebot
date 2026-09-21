---
type: place
name: spawn-station
coords: (242, 69, 214)
confirmed: true
---

# Spawn Station (Train Station at World Spawn)

Train station near world spawn. The rail line connects here to the ocean cabin area. **When the bot dies and respawns, come here and wait for pickup.**

## Coordinates

- **Wooden path start**: (230, 62, 227) — ground level, start of the wooden path Dad built
- **Station platform**: (242, 69, 214) — up on the platform where the train stops; wait here after dying
- **World spawn**: ~(200, 70, 260)

## How to get here after respawn

1. Pathfind to (230, 62, 227) range=2 — the wooden path
2. Pathfind to (242, 69, 214) range=2 — follow the path up to the platform
3. Board the **southernmost cart** (highest z among the unnamed entities at y≈69.1 on the platform) — `activate_entity` to mount
4. Wait for the train to depart

## Related

- [[house]] — ocean cabin, the other end of the rail line
- [[boat-route-new-home]] — water route from new home to ocean cabin

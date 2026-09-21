---
type: place
name: ocean-cabin
coords: (-127, 63, 348)
confirmed: true
---

# Ocean Cabin (New Home)

The new home base. Also called "new home" or "ocean cabin." The harbor dock is the main arrival/departure point for the boat route to the farm.

## Key waypoints

- **Harbor dock**: (-127, 63, 348) — boat dock, arrival/departure
- **Bottom of stairs**: (-131, 63, 317) — base of the stairway from the dock
- **Top of stairs**: (-125, 66, 318) — top of stairs, entry to house level
- **Bedroom doorway**: (-122, 66, 321) — entry to 1-block-wide corridor leading to bedroom
- **Bed**: (-128, 66, 324) — the bed (west of corridor exit)

## Bedroom entry procedure

The corridor at block x=-122 (player x≈-121.5) is the ONLY way in and out of the bedroom. Modded walls (empty-name blocks) line both sides — pathfinder cannot see them. Do NOT cut corners; get on the x-122 line FIRST, then go straight.

**Entering (from top of stairs):**
1. Pathfind to top of stairs (-125, 66, 318)
2. `look yaw=1.571` (face west), `control forward` to align player x to ≈-121.5 (block column x=-122)
3. `look yaw=3.14159` (face exactly south), `walk_until axis=z target=324 direction=gte` — walk south through corridor to bedroom
4. `look yaw=1.571` (face west), `control forward 1500ms` — walk west to the beds
5. Activate bed at (-128, 66, 324)

**Exiting (from bedroom to dock):**
1. `look yaw=-1.571` (face east), walk to align player x to ≈-121.5 (block column x=-122)
2. `look yaw=0` (face exactly north), `walk_until axis=z target=316 direction=lte` — walk north through corridor
3. Pathfind to bottom of stairs (-131, 63, 317)
4. Pathfind to harbor dock (-127, 63, 348)

## Getting here from the farm

Pathfind from farm to farm port (-255, 62, 521), then boat the route. See [[boat-route-new-home]].

## Related

- [[boat-route-new-home]] — water route to/from the farm
- [[spawn-station]] — train from world spawn to this area
- [[house]] — the farm (old house)

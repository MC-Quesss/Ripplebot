---
type: place
name: ice_castle
coords: (-381, 66, 760)
confirmed: true
---

# Ice Castle

A packed-ice structure roughly 190 blocks south-southwest of the [[house|farm
house]]. Roz mentions it frequently in diary entries as "the ice castle to the
south."

## Location & Approach

- Center: approximately (-381, 66, 760)
- Approach: grass path from the north (z≈758)
- From home: pathfind south; the bot reached the exterior via follow mode
  without difficulty

## Structure

- **Material**: entirely packed ice
- **Footprint**: 7 wide (x: -384 to -378) × 12 deep (z: 755 to 766)
- **Height**: 8 blocks (y: 64 to 71), tapering upward:
  - y=64: 51 blocks (broad base/foundation)
  - y=65: 48 blocks (ground floor)
  - y=66–67: 25 blocks each (walls narrow)
  - y=68–69: 15–16 blocks (upper level)
  - y=70: 18 blocks (roof/turret)
  - y=71: 2 blocks (spire peak at x=-382/-381, z=761)

## Interior — Ground Floor (confirmed inside, 2026-07-07)

The bot entered the ground floor without issue. Observed:
- Packed ice floor at y=64–65
- Item frames on walls (multiple, at y=66–69 on walls around x=-353, z=763
  and x=-265 range — display contents not identified)
- **Modded stair blocks** at z=761–762 (block types 2287, 1546, 2959) leading
  to the upper level — the bot cannot traverse these; pathfinder refuses and
  manual walk/jump fail

## Upper Level

Not reached. The stairway uses modded blocks that the bot's physics engine
cannot cross (same class of problem as modded doors at home, but jumping
doesn't help here either).

## Open Questions

- What's displayed in the item frames?
- What's on the upper level?
- Who built this? (Player-built structure)
- Are there any containers (chests) inside?
- Can the stair traversal be solved with a specific approach angle? (User
  suggested face due south + strafe left + walk forward — untested successfully)

## Related

- [[house]] — home base, ~190 blocks north-northeast
- [[../bots/roz]] — references "ice castle to the south" frequently in diary
- [[../bots/operator]] — first visit documented 2026-07-07

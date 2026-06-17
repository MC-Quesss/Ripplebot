# Marcadia — places and procedures

This is the knowledge base for driving the bot. It's a lookup, not a script — always command-by-command with position/HP/deaths checkpoints between steps.

## Bot identity

- **Mojang/MS account name:** `Ripplebot` (this is what mineflayer reports as `bot.username` and what the server uses for auth/whitelist/OP)
- **Display nickname:** `Roz` (set via `/nick Roz`, requires OP, persists across sessions)
- Chat messages from the bot appear under the nickname. Tab list and `nearby_players` may show either name depending on the source.

## Yaw convention (confirmed in play)

- `yaw=0` → faces **north** (-z)
- `yaw=π/2 ≈ 1.5708` → faces **west** (-x)
- `yaw=π ≈ 3.1416` → faces **south** (+z)
- `yaw=-π/2 ≈ -1.5708` → faces **east** (+x)

## Orientation blocks

Door traversals use two **orientation blocks** — canonical pads the bot must be standing on before it sets a heading or opens a door. A door crossing always starts on one orientation block and ends on the other. If we're not on the pad, we abort; drift-by-half-a-block matters because the wrong yaw + forward-push plants the bot in the furnace at (-265, 65, 571).

- **`house_center` (-268, 65, 572)** — inside orientation block. Required before facing west to exit. Pressure plate inside opens the door automatically.
- **`outside_orientation` (-275, 64, 572)** — outside orientation block. Required before facing east to enter. No pressure plate — must `activate_block` the door first.

Every new routine that crosses the door must:
1. Pathfind to the appropriate orientation block with `range=0`.
2. Verify arrival (within ~1.5 xz, ~0.6 y) before proceeding.
3. Face the required yaw and **confirm the server echoed the rotation** (rawState.yaw) before pushing forward — **refuse to push forward on yaw-convergence failure**. Walking the wrong direction is lethal.
4. Drive with `walk_until` (axis-target stopping), bailing on HP drop or death.
5. Land on the target orientation block on the other side.

## Waypoints

| Name | Coords | Notes |
|---|---|---|
| `house_bed` | (-268, 65, 569) | Right-click to sleep. Approach via pathfind to (-268, 65, 570) range=1. |
| `house_kitchen_chest` | (-266, 67, 569) | **Deposit wheat here.** Single chest right of bed. Approach via pathfind to (-266, 65, 570) range=1 — reach works from y=65 up to the y=67 chest. |
| `house_crafting_chest` | (-270, 67, 569) | Above crafting table. NOT for wheat. |
| `house_crafting_table` | (-270, 65, 569) | — |
| `house_furnace` | (-265, 65, 571) | East wall. |
| `house_door` | (-272, 65, 572) | Spruce door. `activate_block` right-clicks it to open. |
| `house_center` | (-268, 65, 572) | Room center — pathfinder lands at (-267.3, 65, 572.5). Exit origin. |
| `outside_orientation` | (-275, 64, 572) | Just outside the door. Entry origin. |
| `field_center` | (-283, 64, 562) | Middle of wheat field. |
| `field_east_approach` | (-278, 64, 567) | Detour waypoint — south-east of the tree. Use when routing from door to field. |

## Known obstacles (mineflayer reports these as empty-name blocks)

| Feature | Location | How to avoid |
|---|---|---|
| Tree west of door | around (-288..-289, 63..68, 568..572) | Going door → field: detour via `field_east_approach` first. Going field → door from west of the field: straight east to `outside_orientation` is safe (we come in from the south side of the tree). |

## Wheat field

- Bounds: x = -287..-279, z = 559..565. Crop at y=64, farmland at y=63.
- Total farmland squares: 54.
- **North half:** z = 559..561 (3 rows)
- **South half:** z = 562..565 (4 rows)

## Procedure: exit house → outside_orientation

Starts on inside orientation block, ends on outside orientation block. Pressure plate on the inside auto-opens the door. Do NOT `activate_block` on exit (toggles the door closed).

1. Pathfind to `house_center` (-268, 65, 572), range=0
2. **Verify on the orientation block.** y must be ≈ 65.0 and xz within 1.5 of (-268, 572). If y≥65.5, pathfinder put the bot on a chest — re-pathfind via bedside (-268, 65, 570) range=1, then to center. If xz is off, abort.
3. `look yaw=1.5708 pitch=0` (west) AND wait for `rawState.yaw` to converge within 0.25 rad. **Abort if it doesn't** — do not proceed on hope.
4. `walk_until axis=x target=-275 direction=lte max_ms=8000`, bail on HP drop or death
5. Verify: x ≈ -275, y=64, deaths unchanged. Should be standing on `outside_orientation`.

## Procedure: enter house → house_center

Starts on outside orientation block, ends on inside orientation block. No pressure plate outside — must activate the door.

1. Pathfind to `outside_orientation` (-275, 64, 572), range=0
2. **Verify on the orientation block** (xz within 1.5 of (-275, 572), y ≈ 64). Abort if off-pad — activating the door from the wrong angle misses and the forward-push walks past.
3. `look yaw=-1.5708 pitch=0` (east) AND wait for `rawState.yaw` to converge. Abort on failure.
4. `activate_block` on `house_door` (-272, 65, 572); pause ~300ms for the open packet
5. `walk_until axis=x target=-268 direction=gte max_ms=8000` (momentum lands at ≈ -267.3), bail on HP drop or death
6. Verify: x ≈ -268, z ≈ 572.5, deaths unchanged. Should be standing on `house_center`.

## Procedure: travel to wheat field (from outside)

1. Pathfind to `field_east_approach` (-278, 64, 567), range=1
2. Pathfind to `field_center` (-283, 64, 562), range=1 (or a specific row like z=561 for north half)
3. Verify: HP unchanged, deaths unchanged

Return path (field → door) can skip the detour when approaching from west of the field — pathfind straight to `outside_orientation`.

## Procedure: harvest wheat (subset or whole)

1. Pre-check: `time` → must be `isDay: true` and `timeOfDay < 11500`. `nearby_entities radius=16` → no hostiles.
2. Record `startDeaths = pos.deaths`
3. `find_blocks names=["wheat"] maxDistance=16 count=200` → filter client-side to target subset (e.g. `z >= 562` = south half)
4. For each wheat block: `dig`
   - Every 10 digs: re-pathfind to a block in the current work area, range=2. Check pos.deaths and pos.health. Abort if deaths > startDeaths or health < 15.
5. After all digs: **ALWAYS sweep the whole field**, not just the area you harvested. Drops live for ~5 minutes and can be anywhere wheat was broken. Use all 8 sweep points below in order so every cell ends up within ~1.5 blocks of the bot at some point:
   - (-279, 64, 559), (-283, 64, 559), (-287, 64, 559)
   - (-287, 64, 562), (-283, 64, 562), (-279, 64, 562)
   - (-279, 64, 565), (-283, 64, 565), (-287, 64, 565)
6. Verify: inventory wheat count grew; remaining `find_blocks wheat` should be 0 in the targeted z-range

## Procedure: replant seeds (subset or whole)

1. `equip wheat_seeds hand`
2. `find_blocks names=["farmland"] maxDistance=20 count=300` → filter to bounds AND target subset
3. For each farmland: `place_block x,y,z face=top`
   - Every 10 placements: re-pathfind into reach, range=2, AND re-equip seeds (equipping drops during pathfind sometimes)
4. Verify: `find_blocks wheat` count in targeted z-range == expected

## Procedure: deposit wheat → kitchen chest

1. Pathfind to (-266, 65, 570), range=1
2. `deposit x=-266 y=67 z=569 names=["wheat"]`
3. Verify: inventory wheat count == 0

## Procedure: sleep

Normally you don't need to — **the bot auto-sleeps** at `timeOfDay >= 12500` when inside the house bounding box (x=-271..-264, z=568..575, y=65). Checks run every 15s.

If you need to force it manually:
1. Pathfind to (-268, 65, 570), range=1
2. `activate_block x=-268 y=65 z=569`

To disable auto-sleep (e.g. during practice or mining expeditions that should run overnight): `{"action":"auto_sleep","args":{"enabled":false}}`. Query current state with `{"action":"auto_sleep"}`.

## Drive rules

### Outdoor safety

- **Never go outdoors at night.** `time.isDay` must be `true` and `timeOfDay < 11500`. Refuse even brief door practice if those aren't met.
- **Check `nearby_entities radius=16` for hostiles before any outdoor pathfind.** Hostile names: zombie, skeleton, spider, creeper, witch, enderman, slime, husk, drowned, phantom. If any are within 5 blocks, warn the user — bot has no combat and will die.
- **Monitor HP every ~10 actions outdoors.** Drop below 15 → abort, eat bread or baked potatoes, or pathfind home. The bot can craft bread from wheat and bake potatoes autonomously via the food-safety system.
- **Eat when food < 12.** Below that, hunger regen stops and the bot starts taking damage.

### Movement

- **Door traversal: use `walk_until`, never `control forward` with a duration.** Forward-push velocity varies wildly on this server. Position-target stopping is bulletproof. Obsolete approaches (duration-based control, pathfinder through the door, forward+strafe slide) left in place.md history — don't use them.
- **Pathfinder cannot cross a vanilla door as a walkable path.** It routes onto chests or walls. Only use `walk_until` for the door crossing; pathfinder for everything else.
- **Pathfinder is safe inside and outside, just not *through* the door.** Trust it for interior bed/chest approach and outdoor field travel.
- **Pathfinder is configured with `canDig=false`, `allow1by1towers=false`, `scafoldingBlocks=[]`** so it won't mine or place blocks to "bridge" gaps. This is in bot.js's spawn handler.

### Observability

- **`pos` returns a `deaths` field.** Start every multi-step operation with `startDeaths = pos.deaths`. Any increase means the bot died and respawned — abort the operation; HP=20 after death is not "healed."
- **Trees, logs, leaves, signs, and many modded blocks report as empty-name `""`.** Several consecutive `""` blocks near known terrain = probably a tree. Don't walk/jump through; ask the user what's there.
- **If pathfinder's status loops with identical `pos` for 3+ polls, it's stuck.** `pathfind_stop` and reassess. Don't keep issuing forward commands on top of a stuck pathfinder.

### Interaction

- **The kitchen chest ((-266, 67, 569)) is a single chest.** `open_container` + `deposit` commands already filter out player inventory (last 36 slots of the window).
- **Modded items show as `unknown`.** Use `equip_slot` with a slot number instead of `equip` with a name when the user points at a specific item.
- **`place_block` / `activate_block` / `dig` all require being within ~4 blocks of the target.** Re-pathfind before each batch of 10-ish operations.

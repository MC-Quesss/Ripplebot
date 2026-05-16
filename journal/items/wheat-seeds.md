---
type: item
name: wheat_seeds
slot_canonical: [37, 39]
confirmed: true
---

# Wheat Seeds

Replanting fuel. Drops from broken wheat crops. Place on tilled [[farmland]] with `place_block face=top`.

## Stock (day 41325)
- Slot 37: 20
- Slot 39: 12
- **Total:** 32 — enough for the 54-square field with margin if drops are decent.

## Equip rule

Pathfinding sometimes drops the seed equip — re-equip every ~10 placements during a replant batch:

```
{"action":"equip","args":{"name":"wheat_seeds","destination":"hand"}}
```

## Related
- [[wheat]]
- [[farmland]]
- [[../procedures/right-click-harvest]]

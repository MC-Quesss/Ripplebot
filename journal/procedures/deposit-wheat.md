---
type: procedure
name: deposit_wheat
target_chest: house_kitchen_chest
confirmed: true
---

# Deposit Wheat

Move all wheat from the bot into [[../chests/house-kitchen-chest]].

## Steps

1. Pathfind to (-267, 65, 570), `range=1`.
2. `deposit x=-267 y=67 z=569 names=["wheat"]`.
3. Verify: inventory wheat count == 0.

## Related
- [[../items/wheat]]
- [[right-click-harvest]]

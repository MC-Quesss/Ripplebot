---
type: procedure
name: stash_wheat
target_chest: house_kitchen_chest
trigger: chat
chat_phrase: "Roz, stash the wheat"
control_command: stash_wheat
confirmed: false
---

# Stash Wheat

Move all wheat from the bot's inventory into [[../chests/house-kitchen-chest]]. Invokable standalone — useful when a harvest exited gracefully without completing the deposit phase (see [[../observations/_log#Recovery — south-half harvest aftermath|the south-half recovery]]).

## Triggers

- **Chat:** `Roz, stash the wheat` (also `deposit/dump/put/store/empty/clear ... wheat`)
- **Control socket:** `./bot-ctl '{"action":"stash_wheat"}'`

## Steps (executed by `runStashWheat` in bot.js)

1. Read inventory for `wheat`. If none → chat `"No wheat in my pockets."` and return.
2. If outside, run [[enter-house]] (`runGoInside`).
3. Pathfind to [[../chests/house-kitchen-chest|chest_approach]] (-267, 65, 570) range=1.
4. Open the chest at (-266, 67, 569).
5. `win.deposit` each wheat stack — vanilla item registry, so `deposit` works (no two-click trick required as in [[../items/unknown|unknown]]-stack stashing).
6. Close window. Chat the result (`Stashed N wheat.`).

## Why a separate handler

If a harvest aborts before reaching the deposit step (graceful recovery, snag on door re-entry, etc.), wheat sits in inventory until the next full harvest. This handler covers that gap with a one-word command.

## Chat routing

Routing is handled by an **LLM classifier**, not ordered regex rules. `routeChat` calls `llm.classify` and dispatches via `CHAT_INTENTS[intent]` (keys like `stash_wheat`, `harvest_wheat`). "Stash the wheat" classifies to the `stash_wheat` intent, which runs this procedure; harvest phrases classify to `harvest_wheat` separately.

## Related
- [[../chests/house-kitchen-chest]]
- [[deposit-wheat]] — older note describing the same end-state; this procedure is the runtime implementation
- [[right-click-harvest]] — harvest procedure (deposits wheat as its final step)
- [[../observations/_log#Recovery — south-half harvest aftermath|gap that motivated this procedure]]

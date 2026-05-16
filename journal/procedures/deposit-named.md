---
type: procedure
name: deposit_named
target_chest: house_kitchen_chest
trigger: chat
chat_phrase: "Roz, deposit bread, wheat, and seeds"
control_command: deposit_named
confirmed: true
first_added: 2026-05-14
---

# Deposit Named

Multi-item deposit into [[../chests/house-kitchen-chest]]. Names any combination of `bread`, `wheat`, and/or `wheat_seeds`. Items not present in inventory are silently skipped — the routine never aborts because one of the requested names isn't on hand.

## Triggers

- **Chat:** `Roz, deposit bread`, `deposit seeds`, `stash bread and seeds`, `stash the baked potatoes`, `deposit bread, wheat, seeds, and baked potatoes`. Pattern accepts any combination of `bread` / `wheat` / `seeds` / `baked potato(es)`.
- **Control socket:** `./bot-ctl '{"action":"deposit_named","args":{"names":["bread","wheat_seeds","baked_potato"]}}'`

Note: raw `potato` is **not** in the deposit list — raw potatoes go in the furnace, not the chest.

## Keep-on-hand rules

| Item | Keep | Reason |
|---|---|---|
| `bread` | 64 | Auto-eat needs ready food. |
| `wheat_seeds` | 32 | Replanting reserve. |
| `wheat` | 0 | Pure storage item. |
| `baked_potato` | 16 | Manual deposit only — never **auto**-stashed after bake (see [[bake-potatoes#User rule]]). When the user asks "stash the baked potatoes", deposit everything beyond 16. |

If the bot has 128 bread, "deposit bread" stashes 64 and keeps 64.
If the bot has 60 bread, the routine reports `bread: 60 on hand, all kept` and deposits nothing for that name.

## Steps (executed by `runDepositNamed(names)` in bot.js)

1. Filter `names` to items actually on hand. If none match → chat `"Nothing to deposit"` and return.
2. If outside, run [[enter-house]] (`runGoInside`).
3. Pathfind to [[../chests/house-kitchen-chest|chest_approach]] (-267, 65, 570) range=1.
4. Open the chest at (-267, 67, 569).
5. For each requested name:
   - Compute `toDeposit = max(0, onHand - keep)`.
   - Iterate stacks, calling `win.deposit(type, metadata, take)` until `toDeposit` is exhausted.
6. Close window. Chat a per-item summary (e.g. `Deposited — bread: 64 (kept 64); wheat_seeds: 67 (kept 32).`).

## Edge cases

- **No matching items:** chats "Nothing to deposit — none of X, Y, Z on hand." Doesn't move the bot.
- **Item present but below keep-threshold:** logged as kept; bot still moves to chest if other names need depositing.
- **Mixed request, some absent:** "deposit bread, wheat, and seeds" with no wheat → deposits bread + seeds, no error.

## Pattern precedence

Registered **before** [[stash-wheat]] in the chat dispatcher. If the user says only "stash the wheat" (no bread, no seeds), the multi-item handler defers to [[stash-wheat]] internally to preserve the wheat-only behavior. This keeps the dedicated "stash the wheat" path untouched while letting "deposit bread and seeds" also work.

## Related
- [[stash-wheat]] — single-item version, still works for wheat-only phrases.
- [[../chests/house-kitchen-chest]]
- [[../items/bread]], [[../items/wheat]], [[../items/wheat-seeds]]

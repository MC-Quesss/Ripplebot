---
type: creature
name: named-sheep
confirmed: false
---

# Named Sheep

Two sheep in the pen have been dyed and given names. They are family.

| Name | Wool Color | MC Color ID | Notes |
|---|---|---|---|
| **Frue** | Green | 13 | The green one |
| **Fluffy** | Brown | 12 | The brown one |

## Tracking

The bot identifies named sheep by wool color via entity metadata (index 13, lower 4 bits). The squirrel-watcher timer scans every 7s. Named sheep are surfaced in:
- Ambient action prompts when in the [[sheep-pen]]
- `buildExpressiveContext` for LLM-driven conversation
- `named_sheep` ctl action

## Open Questions

- Do sheep retain dye color after being sheared? (need to confirm)
- Can we detect if one goes missing and alert the player?

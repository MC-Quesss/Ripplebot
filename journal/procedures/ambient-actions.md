---
type: procedure
name: ambient-actions
confirmed: true
---

# Ambient /me Actions

Quiet signs of inner life emitted as action text via Minecraft's `/me` command. Renders as `* BotName does something` — not conversational, doesn't trigger responses from other bots.

## Behavior

- Self-rescheduling timer: fires every 90–240 seconds
- Picks a persona-flavored line from `AMBIENT_ACTION_LINES` + `AMBIENT_ACTION_LINES_PERSONA`
- Sends `bot.chat('/me ' + line)`
- Logged as `[ambient-action]`

## Gates (must all pass)

- `musingState.status === 'idle'` (not mid-conversation)
- `activeTask.name === null` (not harvesting/baking)
- `!bot.isSleeping`
- `!goInsideBusy && !penTraversalBusy`
- 90s cooldown since last ambient action

## NOT gated by

- **Stand-down mode** — a bot told to "chill" standing still is the ideal time for idle thoughts
- **Bedtime** — if awake at night (inside, waiting), still has thoughts

## Persona flavors

| Persona | Style |
|---------|-------|
| Roz | Nature observation, quiet patience — kneels to examine a wildflower, listens to wheat |
| Muse (protocol) | Anxious checks, fidgeting — nervously checks perimeter, mutters about protocol |
| Rain (unikitty) | Bubbly energy — bounces on toes, does a tiny spin, wiggles at butterflies |
| Private | Tactical awareness — scans treeline, practices semaphore, checks six |

## Related

- [[../procedures/idle-autonomy-toggle]] — stand-down controls wandering/musings but not ambient actions
- [[../procedures/emotes]] — protocol-level emotes (separate from /me text)

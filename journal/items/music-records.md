---
type: item
name: music_records
confirmed: false
---

# Music Records

The farm's disc collection — six vanilla C418 tracks, kept in the record home block
of the [[../chests/house-kitchen-chest|kitchen chest]] (slots 3, 4, 12, 13, 21, 22)
and played on the jukebox at (-274, 64, 565). Metadata mirrored in `RECORD_INFO`
in `bot.js` — keep the two in sync. Roz announces title + color when she puts a
disc on and shares the factoid as a follow-up line.

`confirmed: false` — titles are from item display names (verified in-chest
2026-07-02); colors and factoids are prefilled from vanilla Minecraft knowledge,
pending disc-by-disc review with the user.

| Item | Title | Label color | Length | Factoid |
|---|---|---|---|---|
| `record_cat` | Cat | green | 3:05 (185s) | **Quesss's favorite disc.** Like all our records it came from a dungeon chest — though legend tells of an older world where discs were farmed in a long dungeon corridor: a creeper baited behind doors and gates, skeleton arrows doing the rest. *(reviewed 2026-07-02)* |
| `record_far` | Far | lime | 2:54 (174s) | A calm, drifting C418 melody — good for long afternoons out in the field. |
| `record_mall` | Mall | purple | 3:17 (197s) | C418 wrote this one to feel like wandering an empty shopping mall — spacious and a little mysterious. |
| `record_wait` | Wait | blue | 3:58 (238s) | C418 originally titled this one "Where are we now" — the most upbeat disc in the collection. |
| `record_chirp` | Chirp | red | 3:05 (185s) | A funky retro C418 groove that sounds like a broadcast from another decade. |
| `record_mellohi` | Mellohi | magenta | 1:36 (96s) | A short, melancholy waltz in three-four time — C418 at his most wistful. |

Durations drive end-of-song awareness (`durationSec` in `RECORD_INFO`): every bot
that hears a `Now playing:` announce tracks the same countdown, notices when the
track runs out, and knows the difference between "playing" and "disc still in the
jukebox but finished". Now-playing state is in-memory — lost on bot restart.

## Per-bot music memories (added 2026-07-02)

Beyond this shared table, **each bot keeps its own memories** of the collection in
`journal/bots/<persona>.music.json`, rendered as a `## Music` section in its diary:
times heard, last heard (in-game day), and up to 3 private impressions the bot's own
LLM writes at listen time — this is where per-bot lore comes from, and each bot's
differs. "Heard" counts both playing a disc and hearing another bot's `Now playing:`
announce in chat (chat is the only cross-machine channel).

Music is also a bot-to-bot topic: an idle bot may ask a nearby bot
`<nick>, have you heard "Title"?` — a **No** answer prompts the asker to put the
record on for them; a **Yes** answer comes back with the responder's last-heard day
and latest impression. Answers are deterministic (work without Ollama) and start
with Yes/No so the asker can parse them.

## Provenance

**All six records came from dungeon chests** on this world — none were mob drops.

The collection also carries an older legend, from a world before this one: the
disc farm. Deep in a dungeon where skeletons spawned without end, a long corridor
was built leading out into the dark. Doors and gates were placed just so — a
creeper could be baited down the corridor and trapped where the skeletons' arrows
had to pass, while the farmer stood safe behind the gates. And when a skeleton's
arrow fells a creeper, the creeper always leaves a music disc behind. Song after
song was gathered that way in the old world; on Marcadia, the discs were found
waiting in dungeon chests instead.

Per-disc stories still welcome — reviewed so far: **Cat** (Quesss's favorite).

## Related

- [[../chests/house-kitchen-chest]] — record home slots
- Requesting a specific disc works by title or color: "play Cat", "put on the green one"
  (`play_record` intent, `args.title` / `args.color`)

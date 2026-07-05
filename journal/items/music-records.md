---
type: item
name: music_records
confirmed: false
---

# Music Records

The farm's disc collection — six vanilla C418 tracks, each with its **own assigned
slot** in the record home block of the [[../chests/house-kitchen-chest|kitchen chest]]
(per-disc map in `RECORD_HOME_SLOTS`, bot.js) and played on the jukebox at
(-274, 64, 565). Metadata mirrored in `RECORD_INFO` in `bot.js` — keep the two in
sync. The bot announces title + color when it puts a disc on; the follow-up line is
the bot's **own feeling about the song** (LLM, persona voice, drawing on its music
memory — changed 2026-07-03). The factoid is background lore fed to the LLM context,
**never recited verbatim** at play time anymore.

`confirmed: false` — titles are from item display names (verified in-chest
2026-07-02); **durations live-verified 2026-07-04** (see below); colors and
factoids are prefilled from vanilla Minecraft knowledge, pending disc-by-disc
review with the user.

| Item | Title | Label color | Length | Home slot | Factoid (background lore) |
|---|---|---|---|---|---|
| `record_cat` | Cat | green | 3:05 (185s) | 3 | **Quesss's favorite disc.** Like all our records it came from a dungeon chest — though legend tells of an older world where discs were farmed in a long dungeon corridor: a creeper baited behind doors and gates, skeleton arrows doing the rest. *(reviewed 2026-07-02)* |
| `record_far` | Far | lime | 2:54 (174s) | 4 | A calm, drifting C418 melody — good for long afternoons out in the field. |
| `record_mall` | Mall | purple | 3:17 (197s) | 12 | C418 wrote this one to feel like wandering an empty shopping mall — spacious and a little mysterious. |
| `record_wait` | Wait | blue | 3:58 (238s) | 13 | C418 originally titled this one "Where are we now" — the most upbeat disc in the collection. |
| `record_chirp` | Chirp | red | 3:05 (185s) | 21 | A funky retro C418 groove that sounds like a broadcast from another decade. |
| `record_mellohi` | Mellohi | magenta | 1:36 (96s) | 22 | A short, melancholy waltz in three-four time — C418 at his most wistful. |

Durations drive end-of-song awareness (`durationSec` in `RECORD_INFO`): every bot
that hears a `Now playing:` announce tracks the same countdown, notices when the
track runs out, and knows the difference between "playing" and "disc still in the
jukebox but finished". Now-playing state is in-memory — lost on bot restart.
**Durations verified against this server 2026-07-04** (live calibration: bot puts
the disc on, start = the `[jukebox] playing` log timestamp, operator reports the
audible end). All six nominal values hold. Method spread: reports run **+1 to
+13s long** (human report latency plus a small systematic lag between the log
line and audio), never short — safely inside the auto-return's 60s grace.
Measured: Cat ≤198s, Far ≤192s, Mall 209.7s, Wait **239.0s (exact, ±1s)**,
Chirp 190.2s, Mellohi 102.6s. Mall's first measurement read +37s but re-measured
at +12.7s — the outlier was a slow report, not the song.

## Bedtime record (added 2026-07-04)

Some nights, one bot puts a record on as the crew heads in — a lullaby over the
farm while everyone falls asleep. **Mutually exclusive with story time**: the
story request rolls first (window 9500–10500); any story signal tonight marks
`storyNightDay` and the DJ stands down. The record window is 10600–11800, 25%
chance, **one DJ per night rotating by day** (roz → unikitty → private), so bots
never race each other to the chest. The DJ sleeps like everyone else; the disc
plays into the night and the lazy auto-return files it at sunrise.

## Lazy auto-return (added 2026-07-03)

The DJ bot — only the bot that put the disc on (`nowPlayingMine`) — returns the
disc to its home slot **once the song is over and the bot is next free**: song end
+ 30s grace, then the first 5s poll where the bot is idle (no active task, not
bedtime) triggers `runStopRecord` as a `return_record` task. "That time or after"
semantics: the bot never waits by the jukebox — fire duty, idle wander, and sleep
all take precedence, and a busy poll just retries later (90s retry backoff on
failure). A disc a **player** put on is never touched. If the jukebox turns out
empty when the bot arrives (someone pulled the disc), tracking is cleared so the
bot doesn't keep coming back for a ghost.

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

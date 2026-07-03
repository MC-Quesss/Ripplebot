# Bot Memory Overhaul — Design Notes

Designed 2026-07-03 in conversation with the user; written to seed a fresh-context
implementation pass (same pattern as FIRE_OVERHAUL_NOTES.md, which worked). Read
this whole file before touching diary/journal code in bot.js.

## The problem (observed, not theorized)

The per-bot diary (`journal/bots/<persona>.md`) appends one LLM-written entry per
in-game day, forever. Evidence of failure, seen live 2026-07-03:

- Days 45899, 45900, 45901 are **byte-for-byte identical** entries — the LLM,
  given an empty event buffer, converges on the same invented prose every night
  ("fifty-four potatoes" — the chest actually held 73 baked).
- `DIARY_MAX_EVENTS = 40` silently discards every event after the 40th
  (`diaryNote` returns early) — a busy day loses its afternoon.
- The day buffer is in-memory only — a crash at dusk erases the whole day.
- File grows without bound; old entries are unreachable noise.

## User directives (the requirements)

1. **No unbounded append.** The Day-N log format dies. The diary becomes a
   fixed-shape file: scoreboard + short-term + capped topic sections.
2. **Scoreboard, not log** — live state (baked in chest, raw on hand, deaths,
   streaks, fire-duty status) in one managed block, overwritten in place.
3. **Topic sections** (long-term memory), each a managed block like the existing
   `<!-- music:start -->` (that pattern is liked — generalize it):
   - **Music** (exists, keeps its table)
   - **Things I made** (creative)
   - **Puzzles I solved** (problem-solving wins; the bot's engineering notebook)
   - **Frustrations** (stuck/angry, unresolved — an item may later "move" to
     Puzzles I solved; the dream can narrate that arc)
   - **Hard lessons** (deaths/near-misses in actionable form: "never push
     forward through the spruce door — walk_until only")
   - **The family** (impressions of other bots and players)
4. **Short-term = yesterday, complete, overwritten daily.** Descriptive and
   FULL fidelity — capture must be complete; only interpretation is deferred.
   "Dumb now means dumb later": detail not recorded is unrecoverable. No
   filtering at capture time, no LLM at capture time.
5. **Dreaming at dawn.** Nights are skipped on this server, so consolidation
   runs first thing on wake — before eating, before anything — simulating
   dreaming: review short-term from yesterday, coalesce into long-term topics.
6. **Memories evolve.** Similar/repeated events MERGE and STRENGTHEN. Repetition
   turns episodes into beliefs/traits ("(×43) I keep the fire; the family
   eats"). Merge-rewrites let wording drift and generalize over time —
   deliberate; matches the house myth-and-legend culture (and the no-verbatim-
   player-quotes rule, which applies here too).
7. **Pinned tier — never decays, never evicted:** hard lessons AND happy
   memories (favorites, core memories, friendships). Scars and favorites are
   permanent; ordinary days compete for space. Identity = what never fades.
   **Pinned in existence, not in content** (user, 2026-07-03): "best friend"
   is never forgotten, but its VALUE may change — the dream may rewrite,
   re-weight, or re-assign a pinned memory (who the best friend is can shift;
   a friendship can cool and the entry says so). Eviction-exempt ≠ edit-exempt.
   The validation contract checks pinned entries are PRESENT, not unchanged.
8. **Display cap 42** (user's number) on the rendered short-term block — top-
   scored 42 lines, then an honest `...and N more (see the day record)`. The
   cap is a display window, NOT a memory limit; the capture stream is uncapped.

## Architecture

### Capture (all day, deterministic, complete)

- `diaryNote(...)` becomes `recordEvent(type, data)`: every event is enriched
  at the source with a world snapshot the LLM could never reconstruct —
  `{day, tick, type, ...data, at:[x,y,z], hp, food, nearby:[...], counts:{...}}`.
- Events stream append-only to `journal/bots/<persona>.day.jsonl` as they
  happen (crash-safe; a day is a few KB — storage is free, only long-term
  attention is scarce). No cap. `DIARY_MAX_EVENTS` deleted.
- The code records exact truth (real inventory counts, coordinates); prose
  comes later, anchored to these numbers.

### Bedtime (fast render, then sleep)

- Hold the bed until the short-term block is written (this gates auto-sleep
  AND the harvest bedtime-yield path). Write is deterministic rendering of the
  day stream — milliseconds; the family's night-skip is never held hostage to
  an LLM call (night skips only when ALL players sleep).
- Short-term block (`<!-- shortterm:start -->`): the complete day, rendered
  human-readable, display-capped at 42 lines by dream-time-style score order,
  with the ellipsis line if truncated. OVERWRITES yesterday's block.
- The jsonl is kept until the dream consumes it (it, not the rendered block,
  is the dream's input).

### Dream (dawn, one guarded LLM call)

- Wake hook (`bot.on('wake')`), registered as a task ('dreaming') so nothing
  steals the pathfinder; runs before eating. If the bot never slept (stranded),
  the dawn check dreams over whatever unconsolidated stream exists — fixes the
  current skipped-day bug.
- **Scoring happens here, not at capture** (pre-judging significance at 2pm
  loses the third occurrence a pattern needs). significance = impact × novelty:
  - impact fixed per category: harm high, first-of-kind high (novelty=1),
    prompted-action high, routine chores near zero.
  - novelty = 1/√(timesSeen(kindKey)) from a persistent counts file
    `journal/bots/<persona>.counts.json` (generalizes the music times-heard
    pattern). kindKeys like `death`, `rps-loss:musebot`, `new-item:record_cat`.
  - rehearsal bonus: events retold in stories / asked about / echoed in a
    housemate's diary arrive with a score bump.
- One LLM call: input = scored day events + current topic sections; output =
  updated topic sections. Per item the model may **add** (new, starts ×1),
  **merge** (combine wording with an existing entry, ×N+1, update last-day),
  or **drop**. Quiet day → often a no-op dream, or a strength tick on an
  identity trait.
- Entry format carries evidence inline: `- (×7, last day 45890) <memory>`.
- **Eviction is code, not model:** when a section exceeds its cap (5–8), code
  evicts the worst `strength × freshness` — weak AND stale loses. Pinned
  entries (hard lessons; entries marked favorite/core/friendship) are exempt.
  No explicit ×N decay — staleness in the eviction score is the only fading
  (decided by default; revisit if sections ossify).
- **A bad dream must not eat the childhood (validation contract):**
  - strict output format (JSON per section or exact block markers), parsed and
    validated before any write: markers intact, caps respected, every ×N
    preserved-or-incremented, no section vanishing, pinned entries present.
  - validation fails → keep yesterday's long-term untouched, log, leave the
    stream unconsumed; tomorrow's dream retries. Worst case: a day behind on
    filing, never amnesia.
  - the LLM proposes content; code enforces the conservation laws.

### Scoreboard (always current)

- `<!-- state:start -->` block: day, baked in chest, raw on hand, deaths
  (lifetime), days-since-last-death, fire-duty status/cycles, records known.
  Overwritten at each bedtime and on significant change. Git history is the
  time series if ever wanted.

### Behavior feedback (the payoff)

- **Hard lessons are injected into `buildExpressiveContext`** (alongside
  vitals/brain-mode) so memory changes behavior — learning from mistakes,
  literally. Consider also surfacing to the chat-router context.

## File shape after the change

```
journal/bots/roz.md:
  frontmatter + title
  <!-- state:start -->      scoreboard (overwritten)
  <!-- shortterm:start -->  yesterday, complete, display-capped 42 (overwritten)
  <!-- music:start -->      (existing table, unchanged)
  <!-- made:start -->       capped, strength-annotated
  <!-- puzzles:start -->    capped, strength-annotated
  <!-- frustrations:start --> capped
  <!-- lessons:start -->    PINNED (no eviction)
  <!-- family:start -->     capped; friendship entries pinnable
journal/bots/roz.day.jsonl    (today's uncapped capture stream)
journal/bots/roz.counts.json  (kind-key frequency table = the novelty model)
```

## Migration

- One-time "first dream": distill the existing 522-line Day-N history into
  initial topic sections (bootstrap call over the whole file), then remove the
  Day-N entries. Old text survives in git history.

## Multi-machine reality

- Each bot writes only its own `journal/bots/<persona>.*` files → three
  writers never conflict. For the shared vault (and for peer-diary
  cross-referencing, which reads the local filesystem only), each machine
  needs commit+push after the nightly write and a pull to see housemates —
  e.g. post-dream: `git pull --rebase && git add journal/bots && git commit
  && git push` with failure tolerance. `observations/_log.md` stays
  operator-only.

## Open questions

1. **Which model dreams?** The dream is the highest-leverage call in the
   system — one call/day shaping permanent memory, and the exact task
   (faithful section rewriting with bookkeeping) is where the local Qwen is
   weakest (it invented potato counts at bedtime). Recommend Claude brain mode
   for the dream if budget allows. USER DECISION PENDING.
2. Per-section caps (5–8 suggested) and the pinned-marker syntax (e.g. a `★`
   prefix the parser treats as pin).
3. Whether the git auto-sync runs post-dream (bot-driven) or on a machine cron.

## Suggested implementation order

1. Capture: `recordEvent` enrichment + jsonl stream + delete the 40-cap
   (fidelity fixes stand alone, zero behavior risk).
2. Scoreboard block + bedtime short-term render + sleep gating; kill the Day-N
   append and its identical-entry wallpaper.
3. Counts file + dream-time scoring (no LLM yet — log what WOULD be kept).
4. The dream call + validation contract + eviction arithmetic + pinned tier.
5. Hard-lessons context injection.
6. Migration first-dream for roz.md; deploy to all three machines together.
7. Journal/procedures note + session log; live-verify one full capture →
   sleep → dream cycle before calling it done.

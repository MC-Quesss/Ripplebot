---
type: procedure
name: keep_the_fire_going
aliases: [sustain_farm, keep_fire, fire_duty]
status: confirmed
confirmed: true
first_tested: 2026-05-30
last_updated: 2026-07-03
---

# Keep The Fire Going (fire duty — priority-ladder sustain loop)

The hands-off farm loop, overhauled 2026-07-03 (design notes: `FIRE_OVERHAUL_NOTES.md`
at repo root). **The hopper and the potato pipeline are the fire; wheat is a bonus** —
this inverted the original wheat-first design.

## The priority ladder (evaluated every 5s poll, top rung that needs work wins)

1. **Hopper health** — plant balls sitting in the bio-fuel intake = a jam; feed
   potatoes one at a time until it drains ([[../places/house-hopper]]). The
   potato-duty holder patrols every ~5–7 min; if nobody holds potatoes, any keeper
   may service it. Always under the hopper lock.
2. **Baked-potato pipeline** — `tryCollectBake` collects finished furnace batches
   on its own timer (the old wheat-first gate is gone); the potato cycle below
   keeps the furnace loaded toward 64 baked in the kitchen chest.
3. **Potato field** — ≥85% mature → harvest + replant → bake top-up → surplus raw
   to the hopper (`runPotatoCycle`, one shared implementation).
4. **Wheat (bonus)** — a held half ≥85% → harvest → craft plant balls at the
   [[project-bench-crafting|bench]] → balls to the hopper (`runWheatCycle`).

Idle time between rungs is duty-flavored: hopper patrols and near-post wandering.
**Exploring is disabled entirely while on fire duty.**

## Trigger / stop / status

- **Start:** say **"keep the fire going"**. (Never auto-start via ctl after a
  restart — bots coordinate via chat.)
- **Stop:** "chill" / "stand down" / "stop" (hard kills). ctl `sustain_stop`.
- **Pause (not kill):** "follow me" pauses fire duty; it resumes when the follow
  ends (farewell / stop_follow). Music, bread, jokes run as short tasks — the
  loop waits them out and resumes on its own.
- **Status:** ctl `sustain_status` → `{active, role, paused, duties, pendingWork, crew}`.

## Multi-bot coordination protocol (chat is claims + liveness; the world is the database)

All coordination rides on `/me` lines: bare cores (`.n`) or persona prose with a
trailing core — `* Roz glances north — all golden. (.c n)`. One core per line, always last.

| Core | Meaning |
|---|---|
| `.r` | roll call at startup — keepers re-announce claims |
| `.n` / `.s` / `.p` | claim north / south / potatoes (alphabetical conflict tie-break) |
| `.w` | supervising (no duty; promotes when one frees) |
| `.x` | full stand-down |
| `.c <f>` | **wellness check** — "you ok, keeper of \<f\>?" |
| `.q <f>` | **release with work pending** — handoff / orphaned duty up for grabs |
| `.b` / `.f` | bench lock claim / release (60s TTL, tie-break on crossed claims) |
| `.k` / `.l` | **hopper lock** claim / release (4 min TTL) — one bot feeds at a time, HARD invariant |
| `.d` / `.e` / `.g` | RPS challenge / accept / at-the-spot-ready — challenge and accept are DISTINCT codes (when both were `.d`, stray acceptances after aborted matches read as fresh challenges and two bots ping-ponged phantom games forever; observed live 2026-07-03) |
| `.t<round> @<tick>` | RPS chant: round + reveal tick on the shared server clock |
| `shoots rock (.t<round>)` | round-tagged throw |
| `.a` | RPS mutual abort |

### Wellness checks (dead-keeper backstop)

Under normal duty a claimed field never reaches 100% mature (keeper harvests at
85%). A rival's field sitting fully mature in daytime → ask `.c <f>`; an alive
keeper answers with its normal claim code (a claim refresh IS "I'm ok"); silence
for 60s → the asker frees the duty (`.q <f>`) and the crew absorbs it (supervisors
promote; field keepers take it as an extra duty). Backstops missed `playerLeft`
events; the 45-min claim TTL is map hygiene only.

### RPS for potato duty (the one true tiebreak — never alphabetical)

Potatoes ripe with no potato keeper → wheat keepers play best-of-3 at the south
field meet spots. The challenger's chant carries the reveal tick; both bots shoot
when their own `bot.time.age` passes it — synchronized regardless of chat lag,
and the ceremony can't be skipped because the chant IS the round. A challenged
bot mid-harvest pauses at its next 10-tile checkpoint (challenger waits 45s).
**Winner** takes the potatoes and hands any standing wheat work to the crew via
`.q` — the idle loser claims it and its next poll harvests the remainder
(`pendingWork` bypasses the 85% gate once). Failed matches: in-character "oh
dear" + jittered 2–5 min escalating backoff, then replay. 10 rounds without a
winner = "call it a wash", rematch in ~30–60s.

## Update — 2026-07-03 overhaul (supersedes the 2026-06-02 description)

Old design: wheat-first, single-field-per-bot roles, TTL-only dead-keeper cleanup,
RPS with open-loop timing (silent sync failures, retry storms), kill-only
interrupts, no hopper lock. All replaced as above. `confirmed: false` until the
multi-bot live test passes (kill-a-keeper wellness drill + one observed `.q` handoff).

## Tested

- **2026-05-30 (day 42933):** original loop, 1 cycle clean.
- **2026-06-02 (day 43242):** plant-ball cycle end-to-end.
- **2026-06-24/27:** multi-bot fire duty + RPS field-tested (bugs led to this overhaul).
- **2026-07-03:** overhaul implemented; parse grammar unit-tested (23/23).
- **2026-07-03 (day 45908) — full verification on the fixed protocol (.e accept), 3 bots:**
  Roz south / Muse north claims; hopper-lock crossed-claims tie-break resolved a 40ms
  claim collision (alphabetical loser backed off); ladder priority observed (Muse fed
  the hopper before touching its 100% wheat); **wellness check verified live** — Roz
  `.c n`'d Muse's fully-mature field, Muse answered with a claim refresh ("a claim
  refresh IS I'm ok"), no false absorb; chant-synced match (reveals ~30ms apart every
  round), Roz won 2-1; **`.q` handoff verified** — Roz released ripe south, Muse claimed
  it 2.3s later. Exactly one match, no echo (.d/.e split holds). Remaining optional:
  absorb-on-SILENCE drill (kill a keeper, expect `.c` → 60s → `.q` absorb).
- **2026-07-03 (day 45901) — live 2-bot drill, RPS + locks VERIFIED:** Roz claimed
  south, Private north; hopper patrols serialized cleanly under `.k`/`.l` (release →
  rival claim 100ms apart, zero overlap); potatoes hit 85% → simultaneous challenges →
  dual-challenge tiebreak resolved alphabetically (rainbot6032 < roz, Roz withdrew to
  acceptor); full 4-round match with a chant before EVERY round, reveals within 10
  ticks of the announced tick, throws round-tagged and matched, tie replayed cleanly;
  Roz won 2-1, took potato duty, correctly did NOT `.q` (south at 57%, no standing
  work). Found+fixed: dual-challenge withdrawal wrongly logged a failure and took a
  backoff (fix in bot.js, applies at next restart). Still pending: dead-keeper
  wellness drill (`.c` → `.q` absorb) and an observed `.q` handoff.

## Related
- [[right-click-harvest]] — the per-cycle harvest (RPS checkpoint bail added 2026-07-03)
- [[harvest-potatoes-right-click]] — potato cycle harvest
- [[project-bench-crafting]] — plant-ball crafting
- [[../places/house-hopper]] — the bio-fuel intake (locked, one feeder at a time)
- [[../observations/_log]] — session log

# Fire-Duty Overhaul — Assessment & Design Notes

Written 2026-07-02 to seed a fresh-context overhaul pass. Line numbers refer to
bot.js as of this date (post record/diary/music changes). Read this whole file
before touching code.

## User directives (the requirements, verbatim intent)

1. **Priority inversion — the core change.** "The main focus of keeping the fire
   going should be **hopper and potato maintenance**; the wheat fields are
   secondary, a bonus, and should **never be treated as a priority**." Today's
   loop is wheat-first. This must flip.
2. **Fix the dead-keeper failure mode.** Experienced repeatedly: multiple bots
   tend the fire, one times out or disconnects, and its claimed field sits
   unharvested indefinitely. This is the highest-pain bug.
3. **Interrupt → resume-exactly-where-left-off** for:
   - **RPS challenges** (special case below),
   - **nightfall** (resume in the morning),
   - **quick commands** ("follow me", "play music", "make bread", jokes/emotes)
     — handle the request, then resume the task.
4. **RPS handoff (special case, user's favorite feature — keep RPS fun):** the
   challenged bot was mid-task; the challenger was idle. If the **challenged bot
   wins** potato duty, the **challenger takes over the loser's interrupted
   task** so the winner goes straight to the potatoes.
5. **85% maturity gate is fine** — do not change the trigger threshold.
5b. **RPS reliability is a MAIN objective** (user, 2026-07-02): observed in the
   field — successful matches show no "Rock, paper, scissors..." chant (both
   bots just shoot simultaneously), and failed matches can put two bots into an
   infinite challenge/timeout loop. Ceremony matters: fix the sync, keep the
   theater. See F7. **No fallback assignment: RPS is the one true potato-duty
   tiebreak — failed matches get an in-character "oh dear" and a replay.**
5c. **No exploring while on fire duty** — too risky. Idle time between duties
   goes to useful patrols instead: frequent hopper checks, field-repair
   inspection (bare-tile replanting), then plain idle-wander near posts.
   Useful patrols always outrank aimless idling.
5d. **Plant-ball background routine** — no urgency, done regularly, always
   interruptible: ≥8 seeds → craft plantballs; ≥8 wheat → craft plantballs;
   plantballs in pockets while not crafting → deposit to hopper (under the
   `.k` lock). RPS challenges and quick commands may interrupt it at any craft
   boundary — it is stage-idempotent (housekeep re-crafts whatever remains).
6. **Brainstorm cleverer chat coordination.** The dot-code mechanism (`.r`,
   `.n`, ...) is liked; enumerate every call/response need and extend the
   protocol deliberately.
7. (Standing rules: never auto-start keep_fire via ctl after a restart — bots
   coordinate via chat. Never persist player chat to journal/files.)

## As-is architecture map

### The loop — `runSustainFarm` (bot.js:4113)

- Entry: chat "keep the fire going" (reflex `keep_fire`) or ctl. Guard: already
  active → refuse.
- **Startup handshake:** `fireCrewExpire()` → `.r` roll call → wait 10s
  (`FIRE_ROLLCALL_WAIT_MS`) collecting rivals into `fireStartupRivals` →
  `pickFireRole()` (bot.js:3458): free roles in order `['north','south','potatoes']`
  assigned alphabetically among simultaneous starters; none free → `supervise`;
  alone → `solo`.
- **Poll every 5s** (`SUSTAIN_POLL_MS`, bot.js:3300) via `sustainWait` (bot.js:4002,
  1s-granularity wakeable sleep; `sustainWake()` interrupts for RPS).
- Per-poll, in order: safety gate (`sustainSafe`: HP≥10, not following) →
  `sustainHousekeep` (bot.js:4047, self-heals leftover wheat/seeds/potatoes, 5-min
  backoff) → role branches:
  - **potatoes role:** scan potato field; ≥85% mature → potato cycle.
  - **supervise role:** watch for freed role → promote; else stand at field edge.
  - **north/south role:** RPS-for-potato-duty check *before* wheat; then own
    field ≥85% → wheat cycle.
  - **solo:** both halves scanned independently; potato checks mid-poll and
    post-wheat.
- **Wheat cycle:** `runHarvestRightClick({half, keepSeeds:true, skipDeposit:true})`
  → eat if hungry → `acquireBench()` → craft plantballs (wheat, then seeds) →
  `depositQuickMove('unknown', HOPPER)` → `releaseBench()` → eat → (solo only)
  potato cycle.
- **Potato cycle (duplicated 4×** — potato role ~4160, post-RPS ~4275, solo
  step-6 ~4360, solo mid-poll ~4415): `runHarvestPotatoesRightClick({then:'bake'})`
  → `countBakedInChest()` → `<64` baked → `runBakePotatoesSustain(≤64)` →
  surplus raw → `depositQuickMove('potato', HOPPER, {keep:16})`.
  **Extract to one `runPotatoCycle()` first thing in the overhaul.**
- Recoverable-error philosophy: cycle failures are caught and retried next poll;
  only AbortError + `!sustainState.active` exits the loop. Exit → `.x` stand-down.

### Coordination protocol — current codes

Sent as `/me .x` lines (render as `* Name .x`), parsed from both `chat` and
`messagestr` (`ACTION_COORD_RE`, bot.js ~8340) via `parseFireCoord` →
`trackFireCoordination` (bot.js:3860). `fireCrew` map: name → {field, at},
TTL 45 min (`FIRE_CLAIM_TTL_MS`, bot.js:3384, pruned in `fireCrewExpire` bot.js:3409).

| Code | Meaning | Response behavior |
|---|---|---|
| `.r` | roll call ("who's on fire duty?") | active keepers re-announce their claim after 1–4s jitter (`answerFireRollCall`, bot.js:3467); a solo keeper splits and claims north |
| `.n` / `.s` / `.p` | claim north / south / potatoes | conflict → `resolveFireClaimConflict` (bot.js:3481): alphabetical winner re-asserts, loser moves to a free role or supervise |
| `.w` | supervising | recorded in crew map |
| `.x` | stand down | crew entry removed; potato keeper leaving → claim potatoes; supervisor → `scheduleFirePromotion` (bot.js:3507); last keeper → expand to solo (2–4s jitter) |
| `.b` / `.f` | bench claim / release | local mutex (`acquireBench` bot.js:3832, 60s TTL); `.f` wakes waiters |
| `.d` | RPS challenge / accept | dual-challenge tiebreak alphabetical (in `trackFireCoordination`) |
| `.g` | RPS "I'm at the meet spot, ready" | resolves `rpsReadyResolve` |
| `/me shoots rock\|paper\|scissors` | RPS throw | resolves `rpsState` for round |
| `.j` | fun-RPS challenge / accept | deferral hash picks one acceptor among bystanders |

Non-code coordination that rides on plain chat: `Now playing: "X"` (music
memory), story-time phrases ("Gather round, everyone."), wheat-ready alerts.

### Interruption machinery — current state

- `abortGen` counter + `checkAbort` in task loops: **kill-only, no resume.**
  ctl `stop`, `follow`, `come_inside`, stand-down all bump it.
- `yieldToBedtime` (bot.js:1342): the good pattern — harvest checkpoints every 10
  tiles, walks in, sleeps, resumes at dawn, walks back out. But it only covers
  *inside a harvest*; a cycle interrupted between stages (harvested but not
  crafted) relies on `sustainHousekeep` to sweep up later (works, 5-min backoff).
- RPS interrupt: `rpsAccepted` + `sustainWake()` break the poll wait; the
  *challenged* bot handles the challenge between polls. If mid-task when `.d`
  arrives, the challenge waits until `taskBusy()` clears — the challenger's 15s
  accept timeout often expires first (silent failed challenges).
- Quick commands during sustain: `stop`/`stand down` kill the loop entirely;
  `follow` kills it (`sustainState.active = false`, bot.js ctl follow);
  `come_inside` kills it. "Play music" via intent runs `runPlayRecord` with no
  task registration at all (collides with pathfinder if a harvest is mid-walk;
  usually rejected by `taskBusy` guards in ctl but *not* in the chat-intent path).

## Failure modes, ranked

### F1 — Dead keeper orphans a field (EXPERIENCED, top priority)

Chain: keeper times out/disconnects → if mineflayer's `playerLeft` fires and is
seen, cleanup works (bot.js:8772: claim cleared, solo-expansion or promotion).
But if the event is missed (observer bot itself reconnecting, server hiccup,
nickname mismatch in the crew map) the claim sits for the **45-minute TTL**, and
— the real bug — **TTL expiry triggers nothing**: `fireCrewExpire` just deletes
the entry. Field-role bots never re-evaluate coverage; only supervisors
re-check (each poll) and only `.x`/playerLeft events trigger expansion.
So north sits golden forever while Roz dutifully tends south.

Fix design — **the wellness-check protocol (user's design, 2026-07-02):**

The world itself is the liveness signal. Under normal duty a claimed field can
never reach 100% mature — its keeper harvests at 85%. So:

1. **Detection:** every keeper's poll also scans the OTHER claimed field(s)
   (cheap once scans are TTL-cached, see perf notes). A claimed field at 100%
   mature = its keeper is presumed missing or stuck.
2. **Wellness check:** the noticing bot asks in persona voice with a parseable
   core — e.g. persona line + trailing `.c n` ("are you ok, keeper of north?"),
   same pattern as the other coordination lines. If several bots notice, the
   first ask suppresses the rest: hearing `.c n` starts everyone's shared
   response timer instead of triggering duplicate asks.
3. **Response = re-claim.** An alive keeper answers with its normal claim code
   (`.n`) — no new response code needed; a claim refresh IS "I'm ok." A bot
   mid-bedtime or mid-task can answer instantly and get to its field when free.
4. **Absorb on silence:** no re-claim within ~60s → the asker announces the
   duty freed and the normal claim-conflict machinery (alphabetical) assigns
   it to a remaining keeper, whose next poll harvests the orphaned field.

The same trick covers the potato patch: claimed + 100% mature → check.

Accepted caveats: detection latency is the 85→100 regrowth time (minutes) —
fine, because the fire's true health is the hopper/potato pipeline (F3), and
fields are the bonus tier. Overnight maturation while everyone sleeps may
trigger a morning wellness check that gets an instant "I'm ok" re-claim —
harmless, arguably charming in chat.

Keep from the earlier draft:
- `playerLeft` cleanup (bot.js:8772) stays as the fast path; the wellness check
  is the backstop that makes missed events non-fatal. (The abstract heartbeat
  idea is superseded — no timer chatter needed.)
- **Verify nickname vs account-name keying** in `fireCrew` (playerLeft uses
  `player.username`; claims key by chat display name — `isSameBot` exists but
  the crew-map delete may miss if keys differ). Test this.
- `FIRE_CLAIM_TTL_MS` becomes map hygiene only — the wellness check replaces
  TTL expiry as the coverage mechanism.

### F2 — No interrupt/resume framework (user requirement)

Design sketch (one mechanism for all three interrupt sources):

- **Task descriptors, stage-granular.** `activeTask` grows:
  `{ name, detail, stage, resumable: { kind, args } }` where stages are coarse:
  `harvest_field(half)`, `craft_deposit`, `potato_harvest`, `potato_bake`,
  `potato_deposit`, `hopper_clear`. Stage-granular (not tile-granular) because
  every stage is **idempotent against world state**: re-running a harvest
  re-scans mature tiles (right-click on immature = no-op); craft/deposit re-runs
  on whatever is in inventory (`sustainHousekeep` already proves this pattern).
  Idempotence makes resume trivial and — crucially — makes **handoff to another
  bot** possible for world-stages (not inventory-stages; see F4).
- **Interrupt stack (depth 1 is enough):** `pushInterrupt(reason)` records the
  descriptor + pauses (abortGen bump); quick thing runs; `popResume()` re-enters
  the sustain poll which — because stages are idempotent and derived from world
  scans + inventory counts — naturally re-does exactly the remaining work.
  Insight: **the sustain poll loop IS the resume mechanism.** Most of the work
  is making quick commands *pause* (`sustainState.paused = true`) instead of
  *killing* (`sustainState.active = false`), and auto-unpausing when the quick
  task completes:
  - `follow` → pause; resume on follow end (farewell/stop_follow).
  - `play_record`/`stop_record`/`bake_bread`/joke/dance → register as short
    tasks; resume on completion.
  - Plant-ball crafting (directive 5d) → interruptible at any bench-craft
    boundary; RPS challenges cut in here too. Leftover ingredients/balls are
    swept by the housekeep pass — no state to save.
  - Nightfall → already handled inside harvest by `yieldToBedtime`; extend the
    same yield to potato/hopper stages (they currently only refuse-at-night via
    `runHarvestPotatoesRightClick`'s bedtime check).
  - `stop`/`stand down` remain hard kills (safety commands, unchanged).

### F3 — Priority inversion: hopper & potatoes first (user requirement)

Replace the role-branch structure with a single **priority ladder** evaluated
every poll by every keeper, top item that needs work + is claimed-by-me (or
unclaimed) wins:

1. **Hopper health** — jammed (balls present, no fuel moving) → clear
   (`feedHopperOneAtATime`, bot.js:3311); this is THE fire. Also fuel top-up when
   raw potatoes on hand and hopper starving.
2. **Baked-potato pipeline** — `pendingBake` due → collect (REMOVE the
   wheat-first gate in `tryCollectBake` bot.js:5183: `scanKnownWheatFields().ready`
   currently defers potato collection to wheat — exactly backwards per the new
   priority); chest baked stock below floor → bake more.
3. **Potato field** — ≥85% mature → harvest + replant.
4. **Wheat (bonus)** — only when 1–3 are all satisfied: own claimed half ≥85% →
   harvest → craft → deposit. A keeper with nothing to do in 1–3 and no wheat
   ready = supervise-in-place (and that's fine).

Roles map onto the ladder as *claims on rungs*: `potatoes` claim = rungs 1–3
owner; `north`/`south` = rung 4 halves. With ≥2 keepers, RPS decides who gets
the potato rungs (KEEP THIS — user's favorite). Solo = whole ladder.

### F4 — RPS task handoff (user requirement, new protocol)

Scenario: A (idle) challenges B (mid-task, e.g. harvesting north). B wins potato
duty. Desired: B goes straight to potatoes; **A takes over B's north work.**

- Only **world-stages** hand off cleanly (field harvests, hopper clearing).
  Inventory-stages (craft/deposit of items in B's pockets) cannot — B keeps
  those; B's own `sustainHousekeep` sweeps them after the potato run. This is
  already how leftovers heal, no new code.
- Protocol: after the match, winner announces relinquish-with-handoff:
  **`.q n`** ("I release north, mid-work"). Loser (who by losing has no potato
  duty) treats `.q n` as a claimable freed field with work pending: claims `.n`,
  and its next poll's ladder finds the still-mature tiles — idempotent resume.
  If multiple bystanders, the existing alphabetical-claim-conflict machinery
  already arbitrates.
- The `.d` challenge should also *not* be droppable just because B is mid-task:
  B `pushInterrupt('rps')` at the next 10-tile checkpoint, plays, then either
  resumes (lost) or hands off via `.q` (won). Extend the challenger's accept
  timeout from 15s → ~45s to survive B reaching a checkpoint.

### F5 — Bench and hopper mutexes

**HARD INVARIANT (user, 2026-07-02): potatoes go into the hopper ONE AT A
TIME.** Two bots feeding simultaneously will corrupt the result — guaranteed,
not theoretical. Hopper feeding is therefore a locked critical section, but it
is NOT one bot's standing duty: any keeper may feed, whoever holds the lock.

- **Hopper lock:** new codes `.k` (claim) / `.l` (release), required around
  every feed/jam-clear sequence — `feedHopperOneAtATime` (bot.js:3311),
  single-potato deposits, and `depositQuickMove` targeting the HOPPER. Short
  TTL (~2 min), alphabetical tie-break on simultaneous claims, release the
  moment the window closes.
- **Bench mutex** exists (`.b`/`.f`, 60s TTL) and mostly covers the crafting
  collision — but two bots can both see "free" and claim simultaneously (no
  tie-break), and `acquireBench` (bot.js:3832) waits up to the TTL then claims
  anyway. Add: on hearing a rival `.b` within ~2s of own claim, the
  alphabetical loser backs off (`.f`, wait, retry). Apply the identical
  pattern to `.k`.

### F6 — Misc correctness notes found while reading

- `resolveFireClaimConflict` solo-branch aborts the current harvest (`abortGen++`)
  even when the newcomer claimed a field the solo bot isn't currently working.
  Should only abort if the claimed field == the field mid-harvest.
- `answerFireRollCall` no-ops if `fireStartupRivals` is set (own startup window)
  — two bots starting simultaneously can each miss the other's claims; they
  reconcile via conflict resolution later, but it's fragile. Heartbeats (F1) fix
  this for free.
- `pendingBake` starts `{active:true, doneAt:0}` at boot → every restart triggers
  a furnace visit (seen constantly in today's logs as `collect_potatoes` every
  few minutes — it reschedules when input remains). Mostly harmless, slightly
  noisy; make the boot default `active:false` + keep the ctl `collect_bake`
  recovery.
- RPS identity fix (`isSameBot`) from memory (2026-06-27) is in and working —
  keep using resolved names in any new protocol code.

### F7 — RPS: no round synchronization + challenge retry storm (user-observed)

Both problems confirmed in code (`runRpsMatch` bot.js:3653, `runRpsChallenger`
bot.js:3560, sustain RPS block ~bot.js:4250).

**7a. Rounds are open-loop.** After the `.g`/`.g` ready handshake, each bot
free-runs fixed sleeps (salute → 2.5s → point → 2s → reveal). The chant is
cosmetic: only the challenger says it and the acceptor never waits for it —
nothing forces chant-before-throws, so latency or a dropped line erases the
ceremony while throws still fire. Also: the file's own comment claims throws
are revealed as `.{round}{r|p|s}` but the code sends **untagged**
`/me shoots rock` — no round number — so a stale throw from an earlier
round/match can resolve the wrong round (`rpsState.resolve` accepts any throw
from the rival).

Redesign — make the chant carry a scheduled reveal tick (see brainstorm C1,
which supersedes plain wait-for-chant):
- Challenger chants with the round + reveal tick as the core:
  `Rock, paper, scissors... (.t3 @<tick>)` where tick ≈ now + ~80 ticks (4s).
  Both bots hold until their own shared game clock passes the tick, then
  reveal — perfectly synchronized regardless of chat latency, and the chant
  can never be skipped because it IS the round announcement. Acceptor that
  never receives a chant within ~10s aborts cleanly (with the `.a` code).
- Tag throws with the round (`/me shoots rock (.t3)`) — ignore throws whose
  round ≠ current; clear any pending rpsState on match start.
- Keep all the theater (salute, point, headbang, weep) — user's favorite
  feature; the fix is sequencing, not trimming.

**7b. Challenge retry storm.** While potatoes ≥85% and `potatoRole` unset, the
sustain poll re-attempts RPS **every 5s**. Failed matches return null with no
backoff (`rpsChallengerCooldownUntil` is set only in the can't-get-outside
branch). Timeouts are asymmetric: challenger gives up on `.d` after 15s; the
acceptor then travels and waits 30s for `.g`, aborts, and challenges on ITS
next poll → two bots ping-pong failed challenges indefinitely.

Fixes:
- **Backoff after any aborted match**: set challenger cooldown 2–5 min
  (jittered per-bot so retries interleave, not collide), escalating on repeats.
- **NO deterministic fallback** (user decision): RPS is the one true
  assignment mechanism and a top priority. On a failed match the bots react in
  character ("oh dear") and TRY AGAIN — paced by the backoff above so retries
  can't storm, but never replaced by alphabetical assignment. (This also means
  the existing 10-round alphabetical fallback inside `runRpsMatch` should
  become "call it a wash, rematch" rather than a silent alphabetical win.)
  With 7a's sync fixes, matches should rarely fail; paced replays are the
  recovery, theater included.
- **Mutual abort code** (`.a`?): when either side times out mid-match it
  announces the abort so the other exits immediately instead of serving out
  its own longer timeout and re-challenging out of phase.
- Align the timeout ladder: accept-wait < ready-wait < throw-wait, and (per F4)
  extend accept-wait to ~45s to allow mid-task checkpoint interrupts.
- Verify the isSameBot/nickname resolution on the throw path with fresh logs —
  the 2026-06-27 fix is in, but "rival didn't respond" aborts suggest either
  parse misses or the sequencing bugs above; 7a's round tags will also make
  the diagnosis unambiguous in the log.

## Performance notes relevant to this overhaul

(From the 2026-07-02 optimization review; full list in that conversation, these
are the sustain-relevant ones.)

- **`pathTo` (bot.js:1671) polls at 400ms** — minimum 400ms per tile even when
  already adjacent. A 54-tile half + sweep pays ~40–60s of pure polling. Fix
  (early-exit when already in range + event-driven wait) makes harvest cycles
  visibly faster → shorter interruption windows → fewer RPS/handoff edge cases.
- **Scan caching:** `scanKnownWheatFields`/`scanKnownPotatoField` are called by
  the sustain poll, the wheat-ready watcher, and `tryCollectBake` within the
  same 5s window (~350 blockAt/Vec3 per window). One TTL-cached scan shared by
  all consumers.
- **Potato-cycle 4× duplication** — extract `runPotatoCycle()` before anything
  else; every F3 change lands in one place instead of four.
- Doubled logEvent lines in harvest routines (see review) — halve log volume.

## Coordination needs — the complete list (for the protocol redesign)

1. Liveness: roll call at start + **wellness checks on world anomaly** — a
   claimed field at 100% mature triggers a persona-voiced `.c <field>` check;
   response is a normal re-claim; silence for ~60s → duty absorbed (see F1).
2. Duty claims: potatoes / hopper-stewardship? / north / south / supervise,
   with deterministic conflict resolution (alphabetical — works, keep).
3. Release: voluntary (`.x`), with-handoff (`.q <duty>`), involuntary (TTL,
   playerLeft).
4. Resource locks: bench (`.b`/`.f`) and hopper (`.k`/`.l`) — the hopper lock
   is MANDATORY (one-at-a-time feeding invariant, F5); both need tie-break +
   short TTL.
5. Games: RPS challenge/accept/ready + NEW: chant-as-sync-barrier, round-tagged
   throws, mutual abort code (see F7). The game is loved — make it reliable.
6. World facts: prefer reading blocks/containers over chat state — chat is for
   *claims and liveness only*, the world is the shared database. (This principle
   is why stage-idempotent resume/handoff works at all.)
7. Encoding headroom: single letters are nearly exhausted. Keep bare letters
   for existing codes (compat); adopt `.<letter> <arg>` for new ones (`.q n`,
   `.c n`). Stay parse-simple and human-readable; resist JSON-over-chat.

## Cleverer coordination — brainstorm (2026-07-02)

Ranked by how much they exploit what's special about this environment.

### C1. The world clock as the sync barrier ★ best idea

All bots share the server's game clock (`bot.time.age`, ticks — identical on
every machine, no NTP needed). Anything that needs *simultaneity* should be
scheduled against it instead of chained off chat latency:

- RPS: challenger announces the round with a reveal tick — persona chant plus
  core, e.g. `Rock, paper, scissors... (.t3 @184550)`. Both bots hold until
  their own clock passes tick 184550, then throw. Perfectly synchronized
  reveals regardless of chat lag; the chant is literally the countdown. This
  solves F7a more elegantly than wait-for-chant sequencing.
- Same trick works for any future synchronized theater (dances, salutes).

### C2. Items as server-arbitrated locks (physical mutexes) ★ investigate

Chat-based locks need tie-breaks because two claims can cross mid-air. But
container transactions are **serialized by the server** — two bots cannot both
withdraw the same item stack; one click wins, atomically. So: a designated
token item in a known chest slot = the lock. Hold the token → you may feed the
hopper; return it when done. The server becomes the arbiter; no race is
possible, no tie-break code needed. Very Minecraft: the hopper key is a real
object you go pick up.
Caveats: token lost on death (it drops — need a recovery rule, e.g. lock falls
back to chat-mutex when token missing >5 min); adds a chest round-trip per
acquisition (fine for hopper duty, too slow for RPS rounds). Worth prototyping
for the `.k` hopper lock specifically, where the one-at-a-time invariant is
critical (F5).

### C3. Persona-line + trailing core as the house style

Already proven by the wellness check and `Now playing:`. Standardize: every
coordination message MAY be persona voice with the machine core in a trailing
parenthesis — `"Private, you ok over there? (.c n)"`. Humans read theater,
bots parse the tail. Rule: core always last, dot-prefixed, one per line. The
existing bare `/me .n` codes remain valid (a core with no prose).

### C4. Whisper side-channel for plumbing (verify /msg works bot→bot)

Directed `/msg` between bots would keep family chat clean for high-frequency
plumbing (lock handshakes, heartbeat re-claims) while keeping the theater
(RPS, wellness checks, claims) public where the family can enjoy it.
`bot.on('whisper')` already exists. Needs a live test on this server — if
whispers work, the split is: **public = anything with personality; whispered =
anything a human would find spammy.** Broadcast semantics differ (1:1 only),
so claims/roll-calls stay public.

### C5. Epoch/sequence tags for stale-message immunity

Claims and throws can carry a small counter: `.n7` = "north, my 7th claim
epoch". Receivers ignore anything ≤ the last epoch seen from that bot —
immunity to replayed/late/duplicated lines (the RPS round tag in F7 is the
same idea). Epochs reset on process restart, which itself is a useful signal
("Roz restarted — her epoch went backwards").

### C6. Batched codes

Multiple cores per line where natural: `(.n .k)` = "claiming north AND the
hopper lock". Cuts chat volume; parser splits on whitespace. Low effort, do it
if line volume ever feels spammy.

### Recommendation for pass 2

C1 for RPS sync (replaces wait-for-chant), C3 as the standing style rule,
C5's round tags in the same change. C2 prototyped for the hopper lock only —
if it works, it's the most robust possible enforcement of the one-at-a-time
invariant. C4 tested opportunistically; C6 whenever convenient.

## Suggested implementation order (pass 2)

1. Extract `runPotatoCycle()` (pure refactor, no behavior change) + kill the 4
   duplicates. Also `pathTo` early-exit + doubled-log cleanup while touching it.
2. **F1**: wellness-check protocol (`.c <field>` ask, re-claim response,
   absorb-on-silence) + crew-key verification. (Fixes the experienced outage;
   test by kill -9-ing one bot mid-duty and watching the other ask after its
   field hits 100%.)
3. **F3**: priority ladder (hopper → bake pipeline → potato field → wheat);
   un-gate `tryCollectBake` from wheat.
4. **F2**: pause/resume (`sustainState.paused`) for follow/music/bread/night;
   keep stop/stand-down as hard kills.
5. **F7**: RPS reliability — chant sync barrier, round-tagged throws, abort
   code, failure backoff + alphabetical fallback. (Do this BEFORE F4 — the
   handoff builds on a match that reliably completes.)
6. **F4**: `.q` handoff + mid-task RPS checkpoint interrupt + 45s accept window.
7. **F5**: bench claim tie-break; hopper lock (`.k`/`.l`) — mandatory per the
   one-at-a-time invariant.
7. Journal: update `procedures/` note for fire duty; session log entry; verify
   with a 2-bot live test (one bot killed mid-duty, one RPS handoff observed).

## Answered questions (user, 2026-07-02)

- **Hopper stewardship:** NOT an exclusive duty — any keeper may service the
  hopper, but only while holding the hopper lock (`.k`/`.l`). One-at-a-time
  feeding is a hard invariant; simultaneous feeding corrupts the result.
- **Dead-keeper detection:** wellness-check protocol (see F1) — world anomaly
  (claimed field at 100%) → persona check-in → re-claim or absorb.
- **"Follow me" during fire duty:** PAUSE, do not cancel. Resume fire duty when
  the follow ends (farewell / stop_follow / stop). Same for the other quick
  commands (music, bread, jokes) per F2.
- **RPS reliability is a main objective** (F7): chant as sync barrier,
  round-tagged throws, mutual abort, paced replays on failure — NO alphabetical
  fallback, ever; RPS is the only potato-duty tiebreak.
- **Idle posture:** idle-wander is fine but duty-flavored — frequent hopper
  checks and field-repair inspections outrank aimless wandering, and
  **exploring is disabled entirely while on fire duty** (too risky).
- **RPS accept window:** extend to ~45s — the challenger is typically idle and
  can stand and wait. A mid-task challenged bot pauses at its next checkpoint,
  plays, then resumes (on loss) or hands its remaining duty to the challenger
  (on win) and heads straight to the potatoes.

## Open questions

None — all design questions were answered by the user on 2026-07-02 (see
"Answered questions" above). Pass 2 can go straight to implementation in the
suggested order.

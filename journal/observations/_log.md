---
type: log
name: session_log
---

# Session Log

Reverse-chronological. Each session a header. Raw observations land here first; canonical facts get promoted to their own notes.

## 2026-06-18 — Claude brain mode implemented, multi-bot fire coordination verified

Bot state at start: pos (-266.5, 65, 571.5) inside house near furnace, HP 20, food 20, deaths 0, day 44382, timeOfDay 3025 (early morning).

**Inventory:** 16 wheat, 64 bread, 128 baked_potato (2×64), 1 shears.

**Players online:** Quesss (Dad), Musebot (Muse).

### LLM verified — Qwen3.5-9B-MLX-4bit

Model warmed up in 432ms. Classify calls running 2.7–5s (local 9B model, expected). Chat router correctly:
- Classified Dad's greeting (relevance 8, audience "me") → Roz replied in persona.
- Classified Muse's chatter (relevance 0–2, audience "other"/"everyone") → Roz stayed quiet. No bot-to-bot spiral.

### Log duplication anomaly — fixed

Every `bot.log` line was printing twice. Root cause: launch command `node bot.js >> bot.log 2>&1` redirected stdout to bot.log, but `logEvent()` already writes to both `process.stdout` and the bot.log write stream. Double-write. Fix: launch with `> /dev/null 2>&1` since bot.js handles its own logging.

### Bot-to-bot double reply — race condition in replyToBotTurn

Observed: Roz said "Muse, quiet is nice. The wheat sways easier when the wind stops." twice (14s apart, different timestamps — not a log dupe). Root cause: two Muse messages arrived in quick succession ("Understood. Going still..." classified as audience:"everyone" and "The statistical probability..." classified as audience:"me"). Both passed the `addressed` gate at bot.js:6012 because `audience === "everyone"` counts as addressed. Both called `replyToBotTurn`, and since `botExchange.turns` is only incremented in an async `.then()` after delay+generation completes, both reads `turns=0` and both fired.

Two fixes to consider:
1. **Race fix:** increment `botExchange.turns` synchronously before the delay, not in `.then()`.
2. **Classification fix:** `audience === "everyone"` probably shouldn't count as `addressed` for bot-to-bot exchanges — Roz shouldn't feel obligated to reply to everything Muse says to the room.

### Claude brain mode — implemented and tested

Added a runtime-switchable "Claude brain" mode: `./bot-ctl '{"action":"brain","args":{"mode":"claude"}}'`. In this mode, Claude Opus 4.6 replaces the local Qwen model for chat responses and action dispatch. A single API call handles classification + reply + actions simultaneously. Returns structured JSON: `{chat, actions, emote}`.

**Architecture:**
- New module `claude.js` — raw fetch to Anthropic Messages API, no SDK dependency.
- `routeChat` checks `brainMode`: `'local'` runs existing Qwen pipeline (renamed `routeChatLocal`), `'claude'` calls Claude.
- Local Qwen still serves as prefilter (`CLAUDE_PREFILTER=local` default) — filters noise/unaddressed chat before spending an API call.
- `executeClaudeResponse` dispatches chat (multi-line splitting at sentence boundaries), emotes (after actions complete), and actions (via whitelisted `CHAT_INTENTS` only).
- Reflex tier (stop, stand_down, follow) completely untouched — instant safety regardless of brain mode.
- Automatic fallback to local Qwen if Claude API unreachable.

**Tested interactions:**
- "Come outside and give a salute" → Claude dispatched `go_outside` + emote. Bug found: emote fired before action. Fixed: emote now fires after actions complete.
- "What do you have for food?" → Claude answered with full inventory summary in persona voice.
- "Tell me about Brightbill" → Claude dispatched `tell_story` intent with a detailed topic prompt.
- "Roz, be a friend to Muse" → Claude generated a multi-sentence supportive message, correctly split across chat lines.
- Chat splitting added (230-char chunks at sentence boundaries, ~1.5s pacing) to accommodate Opus's longer responses.
- Prefilter correctly tags Muse's chatter as `audience:"other"` — Claude only called for relevant messages.

**Config:** `BOT_API_KEY` in .env (also accepts `CLAUDE_API_KEY` / `ANTHROPIC_API_KEY`). Default model: `claude-opus-4-6`.

**Limitation discovered:** bot-to-bot commands are blocked by design (`!fromBot` guard in reflex tier + `if (fromBot) return` in command dispatch). Roz saying "Muse, follow me" won't work — Dad needs to give that command directly.

### Multi-bot fire coordination — confirmed working

Both bots ran "keep the fire going" simultaneously. Coordination over in-game chat:
- Roz claimed south field, Muse claimed north field (107ms apart).
- Each harvested only their assigned half independently.
- Roz: 54 tiles in south, deposited wheat to hopper, crafted 4 plant balls from 34 seeds.
- Muse: harvested north, deposited to hopper independently.
- Sustain status confirmed: `role: "south"`, `crew: {muse: "north"}`.

### Ghost blocks in prismarine-viewer — place-and-remove fix

Question-mark blocks appeared on grass near the wheat field in the viewer. Cause: modded [[../creatures/butterfly]] entities landing on blocks confuse prismarine-viewer's texture lookup for that tile. **Viewer-only issue** — mineflayer's `block_at` returns the correct underlying block (farmland, grass, etc.) unaffected by the entity. Placing dirt and removing it forces a block update that re-renders correctly. Bot perception (pathfinder, find_blocks, block_at) is not impacted.

### Viewer enabled — express + prismarine-viewer + canvas installed

Installed `express` (was missing from package.json entirely), then `npm install` to pull `prismarine-viewer` and `canvas` (were in package.json but not in node_modules). Bot restarted; viewer confirmed serving at http://localhost:3007 with control buttons (camera toggle, look around, go inside/outside, say box).

## 2026-06-17 — prismarine-viewer added + bot.log bounded

Infra session, bot offline. Details in [[prismarine-viewer-and-log-rotation]].

- **prismarine-viewer** (`^1.33.0`) added — web view at http://localhost:3007.
  Original add was broken **three** ways (see [[prismarine-viewer-and-log-rotation]]):
  (1) the real root cause — package.json had been downgraded to mineflayer `^1.4.0`
  (resolved 1.8.0, ~2019) + auto-eat `^3.3.6`, crashing bot.js (written for 4.x)
  with `windows.InventoryWindow is not a constructor` before spawn; (2) native
  `canvas` dep never installed; (3) viewer init ran before `const bot` existed
  (temporal dead zone). Fixes: restored deps from HEAD (mineflayer 4.37.1) then
  re-added viewer + canvas on top; installed `canvas` (`^3.2.3`, Node 26 prebuilt);
  moved init into a try/catch `bot.once('spawn')` after `createBot`. **Verified
  live**: clean launch, control server :25580, viewer serving :3007, `pos` healthy.
- **Viewer control bar** — replaced prismarine-viewer's bundled helper with our own
  `startViewer()` (exported `WorldView` + our Express routes), so the :3007 page now
  carries buttons: live first/third-person **Camera** toggle (`POST /camera`), Look
  around, Go inside, Go outside, and a Say box (all `POST /cmd` → `handleCommand`).
  Owns the index.html; no node_modules edits. Verified live.
- **bot.log bounded** — had reached ~939 MB (append-forever). Now a single file
  (no archives): when it passes 50 MB it is trimmed to its last 10 MB — newest
  history kept, older lines dropped — with the same trim applied to a leftover
  oversized log on startup. Verified against a synthetic 60 MB log.
- Verified: `node --check` clean, both modules load. In-game view test pending
  next launch.

## 2026-06-11 — Squirrel false-positive diagnosis (log trace session)

Log-analysis session, bot online but idle near the house. Traced the
"constant squirrel" complaint from Dad.

### Root cause — squirrel detector fires on stationary unknown entities

- `getWildlifeNearby()` (bot.js ~1527) classifies ANY empty-name, non-player,
  non-object entity within 12 blocks and y within [-2,+3] of the bot as a
  squirrel. No movement check.
- Live sample 2026-06-12T01:05Z: six nameless entities near the house, ids
  110268990 (-279.5, 63.5, 564.5), 110267921/110267922 (-267.5, 69.5, 571.5/574.5),
  110268978 (-284.5, 62.5, 577.5), 110268995 (-282.5, 63.6, 564.5), 110269008
  (-272.2, 65, 573.8). **All perfectly stationary across 12s of sampling** —
  positions identical to the decimal, mostly block-centered (.5/.5). Likely
  resting butterflies or static modded ambience, definitely not darting rodents.
- Two of them sit in the y-band at ground level → the watcher (7s interval,
  90s cooldown) re-fires forever while the bot stands near the house:
  squirrel lines every ~97s, 11 in the first 30 min of this session.
- Both bots affected (Dad complained to Roz 04:57Z and Muse 04:58Z) — same code.
- **Fix applied and verified same session** (bot.js `classifyUnknownEntity`):
  movement gate (≥1.5 blocks horizontal between 7s samples), speed tell
  (≥3 blocks/sample darting = [[squirrel]], slow drift = [[butterfly]]),
  flutter tell (vertical wobble ≥0.5 or air under feet = butterfly), per-entity
  10-min comment dedupe. New `butterfly` expressive kind, 300s cooldown.
- Verification: 5 min idle at the house (old code: squirrel line every ~97s)
  produced exactly one line — a correct `[butterfly]` comment at 01:30Z —
  then silence.
- New world facts: the wheat field contains a stationary 3×4 grid of empty-name
  entities at block-centered coords, x ∈ {-285.5,-282.5,-279.5} ×
  z ∈ {552.5,556.5,560.5,564.5}, y≈63.5 — presumed mod field hardware, never
  moves. A real squirrel (id 110267911) darted 13.5 blocks/7s at ground level;
  a butterfly (id 110269009) drifted ~1.3 blocks/7s fluttering at y 65–66.4
  near the house. Notes: [[squirrel]], [[butterfly]].

### /me action-text grammar fix (same session)

- User feedback: `/me <line>` renders as "~Muse <line>", but impulse lines were
  first-person persona exclamations ("Observe!" → "Muse Observe!").
- Fix in `impulseExpressive` (bot.js ~1494): `actionTextFormatNote()` appended
  to the prompt for `/me` lines, and `asActionText()` validates the render —
  strips quotes/echoed name, lowercases the opening verb, rejects first-person
  and interjection openers (one retry, then silence + a `dropped non-action
  line` log entry).
- Verified live: "~Muse squints at the delicate flutter, calculating its
  trajectory variance..." (butterfly, 01:40Z) and "~Muse watches the erratic
  rodent move with alarming lack of spatial awareness" (squirrel, 01:41Z).
  Persona survives via word choice instead of exclamations.

### Other log anomalies (historic)

- 2026-05-22 02:52:56–02:53:13Z: 896,825 `write EPIPE` uncaught lines in 17s —
  uncaughtException handler loops when stdout pipe closes. 79% of bot.log bulk.
- `[sniff-custom_payload]` debug spam: 147k lines (buildcraftlib channel).
- `[entity-miss]` burst logging at 50ms intervals (2,808 lines, 2026-05-18).

## 2026-06-11 — Musing chop, persona specs, LLM voice (offline build day)

No server session — bot.js rewrite, bot never launched. Design decisions in
[[persona-llm-migration]]; this entry records what shipped.

### What shipped

- **Scripted musing system deleted** (~2,300 lines, all 73 topics across 3
  generations). Full catalog preserved in [[musings-catalog-review]] before the
  chop. One keeper promoted: the protocol rust line is now a Muse greeting.
- **Expressive output gate** ([[todo-activity-system-refactor]] → done): one
  global 30s gap + a per-kind cooldown table replaces the old cross-suppression
  timestamp web. Functional speech bypasses the gate entirely.
- **Persona-as-data**: `personas/<key>.json` (roz, protocol, unikitty, private)
  each hold systemPrompt + exemplars + 13–18 functional line slots. `.env`
  `PERSONA=` selects; nickname inference (`includes('rain')` → unikitty) is gone.
  bot.js holds zero persona text.
- **llm.js**: Ollama generator (LLM_CHAT / LLM_URL / LLM_MODEL). Health check
  60s restores voice without restart. Failure mode = silence, never canned.
- **Impulses**: ambient /me, wildlife, squirrel, victory, follow-bedtime are
  now LLM impulses — generate AT FIRE TIME so context includes chat that
  arrived during any wait; model may PASS.
- **Bot-to-bot exchanges**: `BOT_CHAT_DEPTH` (0=off; set to 3 here) caps this
  bot's turns per exchange; replies wait ≥5s jittered (15% chance +10s);
  60s silence or any human message ends the exchange; 5min cooldown before the
  next one starts; final turn is prompted to close naturally.
- **ctl**: `{"action":"llm"}` → generator status + persona + depth.

### Incident: self-reply loop (caught live, 04:39)

Muse got stuck talking to itself every ~2s (an escalating argument with itself
about dampness odds). Root cause chain: (1) the server echoes the bot's own
chat under its display NICKNAME ("Muse"), but the own-message guard only
checked `bot.username` ("Musebot") — the bot heard itself; (2) its own
greeting, heard back within the 20s greet-reply window, opened a conversation
window for "Muse"; (3) every self-reply refreshed the window. The player-chat
path bypasses the expressive gate, so the model's PASS was the only brake — it
happily kept answering. **Fixes:** own-message guards now also test `nickRe`
(both the main chat handler and `waitForChatReply`); `looksLikeBot()` now also
matches persona display names from personas/*.json (otherwise "Roz" — account
"Ripplebot" — reads as human, and two bots could mutual-loop through the
unlimited conversation path instead of the depth-capped bot path).

**Lesson: every identity check in chat handling must account for the
account-name vs display-nick split.** Grep for `bot.username` comparisons when
touching chat code.

### Gotchas worth remembering

- **gemma4 is a thinking model.** Without `think: false` in the request it
  burns the whole `num_predict` budget on `message.thinking` and returns empty
  `content` with `done_reason: "length"`. Cost an hour of "why is everything
  null".
- The model sneaks emoji into lines (✨🐿️) even when told not to — llm.js
  strips everything past Latin-1 since 1.12.2 chat can't render it.
- Voice quality at 8B is genuinely good: Roz's stale-topic test correctly
  PASSed; her reply to Muse's rain-odds fretting was "The sky does not seem to
  calculate anything."

### Notes

- bot.js: 9,645 → ~6,800 lines.
- `.env` gained PERSONA / LLM_CHAT / BOT_CHAT_DEPTH. **User set
  PERSONA=protocol** — Ripplebot will speak as Muse until changed back.
- The 4 ambient entries with physical components (2 emotes, 1 pathfind action,
  1 fence-`requires`) died with the pool — ambient is text-only now.
- **Not yet live-tested in-game.** First launch should check `{"action":"llm"}`
  and watch bot.log for `[llm] ready`.

### Live test + follow-up changes (same session)

- Launched as Muse (this machine's account is Musebot; PERSONA=protocol matches).
  `[llm] ready` at startup; `{"action":"llm"}` ctl confirms persona/depth.
- **Player chat → LLM wired** (user caught the gap): directed chat that matches
  no command rule now gets an LLM reply in voice (bypasses the expressive gate —
  being addressed always deserves an answer); scripted idunno-shrug only as
  LLM-down fallback. First live exchange: "Hi Muse, what can you do?" →
  "Ah, Dad! I do hope nothing terrible has happened?"
- LLM squirrel reaction confirmed live: "By the stars! The probability of such
  erratic movement from a rodent is statistically alarming!"
- **Conversation continuity** (user: shouldn't have to re-address by name every
  message): naming the bot opens a 90s per-player conversation window, refreshed
  on each exchange. Window-open messages flow to the bot un-named — commands AND
  conversation both work. Addressing someone else by leading "Name," closes the
  window. Continuity LLM replies may PASS silently (might be meant for another);
  named messages always get an answer (shrug+idunno only if LLM down).
- **Scripted greeting rule removed** (user: hello lines blocked the LLM like the
  idunnos): "hi/hey/hello..." now falls through to the LLM with everything else;
  a greet emote still fires alongside. Continuity PASS bias softened — answer
  unless clearly aimed at someone else ("It's getting kind of late" had gone
  unanswered). Auto-greet (proximity) unchanged.
- **Hostile stay-inside gates removed** (user: bots can fend for themselves —
  the op-kill watchdog handles threats). Gone: go-outside "staying inside",
  harvest/potato/rc "standing down", idle-wander field/pen skips, mid-harvest
  "hostiles approaching" aborts, sustainSafe hostile clause, collect/restock
  gates. KEPT: HP<10 aborts, death checks, low-HP emergency-bread hostile
  check (window-open mid-combat is a known killer), come-inside rush, watchdog.

### Links
- [[persona-llm-migration]] (design + decisions)
- [[musings-catalog-review]] (preserved musings)
- [[todo-activity-system-refactor]] (closed by this work)

---

## 2026-06-05b — Poisonous potato cleanup, tossTrash fixes (day 43494)

Bot state at start: HP 19→20, food 15→19, deaths 0. Spawned at (-266.65, 65, 566.5) — **outside the house** (z=566.5, house z-min is 568).

### Poisonous potato in inventory

Found 1× `poisonous_potato` in slot 44 on session start. Origin uncertain — right-click harvests were believed not to produce them, but this disproves or qualifies that hypothesis. Discarded via new `toss_trash` ctl command. Updated [[../items/poisonous-potato]].

### tossTrash() pathfind removed

`tossTrash()` previously pathfound to a fixed dump spot at (-287, 63, 579). This broke when called inside the pen (potato harvest), since the pathfinder can't route through the fence gate. Fix: removed the pathfind entirely — now drops items at the bot's feet. Items despawn in 5 minutes regardless.

### Spawn position outside house bounds

Bot spawned at z=566.5, which is outside the `insideHouse()` bounding box (z >= 568). User reports the bot has deposited into the kitchen chest from this position — meaning it reached the chest through the wall without actually entering the house. The `chest_approach` waypoint is (-267, 65, 570) and the kitchen chest is at (-266, 67, 569). If the pathfinder routes to within `range=1` of `chest_approach` from the north side of the wall, it could reach the chest without crossing the house boundary. Open question: should `insideHouse()` bounds be expanded north, or should chest operations hard-require `insideHouse()` before pathfinding to the chest?

### Links
- [[../items/poisonous-potato]]

---

## 2026-06-05 — Lily pad pathfinder fix, sustain loop test (day 43493)

Bot state at start: HP 20, food 15, deaths 0, inside house at (-266, 65, 571). Day.

### Bug: pathfinder stuck on lily-pad-covered water

The wheat field has a full row of water at z=562 (x=-287 to x=-279) covered with lily pads (`waterlily`) at y=64. The pathfinder classified lily pads as carpet (thin shape < 0.1) and saw exposed water beneath — refusing to route through. The bot got stuck mid-harvest at (-282.5, 63.94, 563.5).

**Fix:** Extended the existing `world.getBlock` override in the spawn handler. When a block is `water` and the block directly above is `waterlily`, we override `boundingBox = 'block'` and `shapes = [[0,0,0,1,1,1]]` so the pathfinder treats it as solid ground.

**Verified:** Two full "keep the fire going" cycles completed after the fix, harvesting across the lily pad row both times without stalling.

### Notes
- "Server rejected transaction" log lines during hopper/chest deposits remain benign — inventory delta verification confirms the items move.
- Roz (Ripplebot) active on the server, chatting and patrolling independently.

### Links
- [[south-fenced-area]] (wheat field bounds)
- [[harvest-potatoes-right-click]] (related water-safety pattern)

---

## 2026-06-04 — Ambient /me actions, persona split (Private/Rain), shared-line cleanup

Bot state at start: HP 18, food 17, deaths 0, outside at (-279, 64, 571). Day.

### Ambient /me actions — new idle behavior

Added a new system: quiet action-text emitted via `/me` command, rendering as `* BotName does something`. Independent of musings (which are bot-to-bot dialogue) — these are signs of inner life: fidgets, observations, ponderings. Timer: 90–240s, self-rescheduling. Gates: not during musings, tasks, sleep, or door traversal. **Not gated by stand-down** — a bot told to "chill" standing still is the ideal time for quiet thoughts.

Persona-flavored line pools: Roz (nature observation), Muse (anxious checks), Rain (bubbly energy), Private (tactical scanning).

### Persona split: Private ≠ Rain

Previously both mapped to `'unikitty'`. Now split:
- `'private'` — Madagascar penguin: sweet, eager, brave, tactical. "Smile and wave."
- `'unikitty'` — Rain/Unikitty: bubbly, everything-is-awesome, boundless enthusiasm.

`personaBiasForTags` gives Private a 3x boost on `unikitty`-tagged content (shared upbeat energy) but 5x on `private`-tagged content.

### Shared-line cleanup

Converted all remaining single-pool line sets to persona-based (`withPersona(BASE, PERSONA)`):
- `IDUNNO_LINES` → persona variants (Roz: melancholy, Muse: bureaucratic, Rain: excited, Private: tactical)
- `GREETINGS` → persona variants
- `RETRY_LINES` → persona variants
- `FIRE_KEEPER_NO_LINES` → persona variants
- `BEDTIME_LINES` → persona variants
- `WHATS_UP_LINES` → persona variants (directed handler now uses them too)

Marvin musing topics (`marvin_brain_planet`, `marvin_dreadful_odds`) tagged `['roz']` — still available to all bots but 5x weighted toward Roz.

"Hello, are you my family?" moved from Rain to Private (it's a Private the Penguin line).

### QA observations

- **go-inside stuck loop**: bot repeatedly fails to reach `outside_orientation` or `house_center` with identical offsets (dx=0.5, dz=3.46). Not converging across retries. `goInsideBusy` stays true during the retry cycle, which was blocking the ambient action timer. Root cause TBD — likely coordinate/collision issue near the door.
- **Musing timeout**: `farm_outstanding` topic timed out waiting for a partner (90s). Normal when other bots are busy.
- **go-outside attempt 1 retries**: occasional graceful failures but usually succeeds on retry.

### Open questions
- Root cause of go-inside non-convergence (same offset every attempt)
- Whether ambient actions fire correctly once goInsideBusy clears (confirmed timer starts, confirmed /me format works manually)

Cross-links: [[../procedures/ambient-actions]]

## 2026-06-03 — Food-safety hardening, sustain-loop retry fix, persona reactions

Bot state at start: HP 7, food 0, baked potatoes 0. Spawned outside near the potato patch after
an earlier ECONNRESET crash. Three bots online: Musebot, Ripplebot, Rainbot6032.

### Emergency bread protocol

The food-safety loop was deadlocked: HP < 10 aborted the potato harvest, but with 0 baked potatoes
and 0 food there was no way to recover HP. Added an emergency pre-step to `tryFoodSafety`: if
HP < 10, come inside → withdraw up to 16 bread from [[../chests/house-kitchen-chest]] (slot 24) →
eat → then proceed with the harvest + bake. If no bread in the chest, the bot announces it needs
help and aborts. Tested: bot recovered from HP 7 / food 0 to HP 20 / food 19 on restart.

### Food-safety potato harvest capped at 42 tiles

Added `maxTiles` parameter to `runHarvestPotatoesRightClick`. The food-safety caller passes
`maxTiles: 42` — enough to restock baked potatoes without harvesting the entire 60-tile patch.
Manual harvests (chat, ctl) still harvest all tiles. The cap is applied after the boustrophedon
ordering, before the harvest loop.

### Sustain loop: interrupted cycle no longer blocks on 85% maturity

Bug found live: cycles 2 and 3 of "keep the fire going" were interrupted by hostile mobs mid-harvest.
The partial harvest replanted immature wheat, dropping maturity well below the 85% gate. The loop
then polled indefinitely, waiting for 85% on wheat that wouldn't mature for minutes — even though
the right action was to retry immediately. Fix: `retryAfterInterrupt` flag, set true in the catch
block, bypasses the 85% check on the next poll.

### Sustain poll interval: 15s → 5s

`SUSTAIN_POLL_MS` reduced from 15000 to 5000 for faster cycle recovery.

### Persona reactions: recursive-building-materials

The `recursive-building-materials` musing topic had only 1 unikitty (Private) `personaReaction`
out of 9 nodes — the ice line. Private rarely got to be enthusiastic because the trigger line was
1-in-9 odds and had to be said by the *other* bot. Added 5 more unikitty reactions (sugar cubes,
wood, dirt, bricks, tower), covering 6 of 9 nodes (~67% hit rate).

### Observations

- **`farm_outstanding` timeout pattern:** Musebot initiated `farm_outstanding` twice in the wheat
  field and timed out both times — no partner responded. When Rainbot said the same line, Musebot
  logged `gated topic ignored here: farm_outstanding` because Musebot wasn't in the wheat field
  at that moment. The gating is correct (the topic requires `requiresWheatField`), but the
  frequency of timeouts suggests bots rarely overlap in the field at the right moment.
- **Yaw convergence failure on go-inside:** During hostile retreat in cycle 3, `runGoInside` failed
  all 4 attempts with `yaw didn't converge to east (got 0.00 rad)`. The bot was at the correct
  x/z orientation block but the yaw lock never settled to east. This left the bot stranded outside
  during a hostile encounter. Not fixed this session — needs investigation.
- **Cycle 1 instant abort:** Sustain triggered at bedtime (timeOfDay ≥ 11500). `runGoOutside`
  refused (`"too late"` line), harvest saw `insideHouse() = true` and aborted. The loop then fell
  through to deposit/craft (deposited 0, crafted 0) — harmless but wasteful. The bedtime yield
  system in the harvest itself would have handled this correctly if the bot had gotten outside first.

### Open questions
- **Yaw convergence on go-inside:** Why does `bot.look()` fail to converge to east (-1.57 rad)
  when starting from yaw ≈ 0? Happened 3 consecutive times at the same orientation block. May be
  a modded-server physics issue or a race with `suppressLookAt`.
- **Sustain cycle 1 at bedtime:** Should the sustain loop check `isBedtime()` before starting a
  cycle, not just in `sustainSafe()`? Currently `sustainSafe()` is checked, but the harvest's
  `runGoOutside` has its own bedtime gate that fires first and causes the instant abort.
- **Engine timing** — Step 2 cleared 8 wheat + 3 balls in ~20s. Is ~20s the right wait per top-up
  wheat in general? (the "tuning detail" — interval may need tuning)
- **Remainder = 0 edge** — if the engine is already clear, balls drain with no wheat; a reflexive
  "add 1 wheat" then starts a fresh partial batch. Guard for it.
- **Shared engine** — Roz (Ripplebot) + Rainbot feed the SAME in-game engine (their code is isolated
  per-machine — our `bot.js` edits only affect Muse until pushed — but the engine *state* is shared).
  Park them for clean routine runs.
- **No auto-reconnect** — keepAlive drops killed Muse ~3× this session; `bot.js` doesn't reconnect.
  Worth adding for unattended loops.

---

## 2026-06-02 — Plant-ball crafting cracked, bio-diesel feed mapped, food-safety debounced

Long session. Resumed the paused stash task, then built toward the new "keep the fire going" where
**wheat AND plant balls both feed the bio-diesel engine**.

**Stash task done.** Crafted a plant ball (8-seed ring → `unknown`) and stashed it in the kitchen
chest via `runStashUnknown` (deposited=1, remaining=0). Confirmed `runStashUnknown` scans for the
first **empty** chest slot (skips occupied), so the salt-pot's slot (0 vs 6) is irrelevant to it —
the earlier slot-0 rejection was the *other* path (`runDepositNamed` / `win.deposit`).

**Bio-diesel engine intake — the 8-batch rule (NEW).** The hopper (-266,65,573) feeds a bio-diesel
engine that consumes input in **batches of 8** (same shape as the seed→ball recipe). A partial batch
(1–7) stalls the engine and backs up the hopper; queued plant balls can't drain until the batch
completes. **Validated (staged test):** engine held 7 wheat with 3 plant balls stuck in the hopper →
fed **1** wheat → batch hit 8 → engine cleared → all 3 plant balls drained to 0, in ~20s. The
plant-ball count dropping is the **observable proxy** for the (unreadable, modded) engine clearing.

**The 7-wheat reserve.** Keep 7 wheat back at deposit time; feed them 1-at-a-time to top up whatever
partial batch is stuck (max top-up = 7, when the engine holds just 1). 7×20s is well under regrow
time. **Can't use harvest math for the remainder** — the engine's prior state is unknown (other bots
feed it), so the routine watches the hopper, never computes.

**Plant-ball crafting mechanic — cracked (was the blocker).**
- Bot-placing the 8-seed ring does **not** trigger the bench to compute (reproduced the journal's
  limitation: correct ring in grid 0–8, slot 28 stayed empty — confirmed not a lag via re-read).
- **The bench computes on GUI-open**, not on placement: place ring → **close → reopen** → slot 28
  computes the plant ball. That's the workaround for autonomous crafting.
- Taking the output **consumes the 8 grid seeds** — clean **8:1**. (The "grid still full after
  taking" display is desync; a fresh reopen shows the grid empty.)
- **Shift-click cascade** (untested for seeds; set up but paused): seeds in storage (9–27) +
  shift-click the computed output *should* craft repeatedly, auto-restocking the ring from storage
  (the planks→buttons behavior). The efficient batch path — see open questions.

**Food-safety false-trigger — root-caused + fixed.** Opening any modded container (bench/hopper/chest)
transiently desyncs `bot.inventory` to read empty → `countBakedPotatoes()` reads 0 → food-safety
false-fires a potato run. Hit **twice** this session. Fix: **debounce** in `tryFoodSafety` — require
the low count across `FOOD_SAFETY_DEBOUNCE` (2) consecutive polls, and skip sampling while
`bot.currentWindow` is open. A desync blip resyncs by the next poll and never accumulates the streak.
Implemented + syntax-checked, **not yet restarted/tested**.

**Harvest seed divergence (gotcha for the new routine).** `runHarvestRightClick`'s tail auto-deposits
surplus seeds to the **kitchen chest** (keep 16) — the *old* behavior the new routine replaces. Also:
the standalone harvest **prompts** "hopper or chest?" for the wheat (30s timeout → keeps on hand);
only the sustain loop's `autoDeposit:'hopper'` skips the prompt.

**Also discussed — eclipse/brightness experiment (staged, not built).** The server has an in-game
eclipse (sun darkens mid-day, mobs spawn); bots should stay inside during it. The bot has **no
light-reading capability** (no `skyLight`/`blockLight` in `bot.js`). Plan: add a `light` ctl action,
baseline day vs night, find the signal that flags an eclipse (brightness may not move in the readable
values — mob-spawn could be the real signal), then a stay-inside reflex. Caution from the food-safety
bug: any such reflex must validate its sensor, not just a threshold.

---

## 2026-06-01 — Breakthrough: driving the modded 3×3 Project Bench

**Goal:** craft on a 3×3 table (vanilla recipe test). The vanilla crafting table never worked for
the bot.

**Diagnosis (rigorous):** mineflayer crafting is entirely window-based — no open window, no craft.
The vanilla table (managed by the `fastbench` mod) produces **zero** server response to a
right-click: no `open_window`, no `window_items`, nothing on any mod channel (sniffed all packets;
only background mod noise). Chests/furnaces/hoppers open fine — they're TileEntity containers using
the vanilla `open_window`. The table's GUI is transient and never surfaces to a headless client.

**The fix — swap to a Project Bench + window adoption.** User replaced the table with a ProjectRed
**Project Bench** (`projectred-expansion`), a TileEntity block with a persistent server-side
container. Right-clicking it DOES open a real container (server sends `window_items` for window id
1) — but mineflayer still didn't fire `windowOpen`, because Forge announces modded GUI opens via an
**FML packet**, not the vanilla `open_window`. So mineflayer stashed the orphaned `window_items`
and waited forever.

Added a `window_items` listener in `bot.js` that **synthesizes the missing `open_window`** for any
unrecognized window id (deferred one tick; skips windows already adopted via the vanilla path).
mineflayer then creates + populates the window and fires `windowOpen`. The bench became fully
drivable. **Confirmed:** placed planks in the grid → bench auto-computed + auto-restocked from its
storage → shift-click output → 4 wooden buttons in inventory.

**Bench layout (window id 1, 65 slots):** grid = slots 0–8 (**row-indexed**: 0,1,2 top, 3,4,5
middle, 6,7,8 bottom); output = slot 28; internal storage ≈9–27; player inv 29–64.

**Slabs confirmed:** 3 planks in a horizontal row (slots 3,4,5) → 6 wooden slabs, taken into
inventory. Slabs are NOT removed by CraftTweaker — earlier "no slab" results were botched placement
during messy testing. 1 plank → button also confirmed.

**Two limitations found:** (1) **bot-placed** grid ingredients don't reliably trigger the output
calc — the user hand-placing 3 planks computed slabs, but the bot placing the same 3 via
`clickWindow` left the output empty (root cause unknown; likely the generic-container window type).
Reliable workflow for now: ingredients pre-placed, bot takes output. (2) `bot.inventory` desyncs
after modded-window ops (6 slabs read as 12; 4 planks as 2) — resync via restart; real item loss is
possible during heavy juggling. The 2×2 inventory crafting (bread/shears routines) is unaffected —
verified clean log→planks after restart.

**`bot.js` changes:** added the window-adoption `window_items` handler + a `close_window` ctl
action. Removed the dead `craft_recipe`/`open_crafting_table` actions (both relied on `windowOpen`,
which never fires for these GUIs) and the temporary packet sniffer used during the investigation.

Full procedure + slot map: [[../procedures/project-bench-crafting]].

## 2026-06-01 — Bugfix: modded block collision in door corridor

**Symptom:** bot getting stuck in the SW corner of the house. Pathfinding to house_center from inside routed to z=575+ (south wall) then outside. `walk_until` during exit snagged repeatedly at x=-267.50 with strafe-right pulses that never cleared.

**Root cause:** a modded block (type 2959, empty name) at **(-271, 65, 572)** — one tile east of the door in the exit corridor. Mineflayer treated it as solid (unknown geometry). This caused:
1. `walk_until` hitting the block's collision box when walking west from house_center
2. Pathfinder routing *around* the block via the south wall, ending up outside the house entirely

**Fix (bot.js):**
- Added a permanent `getBlock` override at spawn that zeros out shapes for the block at (-271, 65, 572). This fixes both pathfinder route planning and physics-based walking.
- Widened the door-traversal monkey-patches (exit + entry) to cover x=-272 through x=-271 (door + modded block), not just the door alone.

**Verified:** bot walks clean through the corridor in both directions. Pathfinding to house_center from inside lands correctly at (-267.5, 65, 572.5). No snag at x=-267.5.

**Also this session:**
- Updated `places.md`: removed stale hamburger/slot-44 references, replaced with bread + baked potatoes for food safety.
- Journal audit: cleaned up stale notes (bread anomaly section, wheat-seeds stock data, enter-house corridor geometry, shear-sheep wiring status, right-click-harvest resolved questions).

Cross-links: [[../procedures/enter-house]], [[../procedures/exit-house]], [[../places/house-center]]

## 2026-05-30 — Bugfix: pen door exit (bot stuck leaving the pen)

**Symptom (user):** bot increasingly stuck getting *out* of the pen; lots of sheep around.

**Causes (two):**
1. **Door open not verified.** New `ensurePenDoorOpen` called `activateBlock` then returned
   immediately; the local door metadata hadn't updated yet (async server block-change packet), so
   `penDoorIsOpen()` read **closed** and the bot walked into a shut door, stalling at z≈574.4. The
   exit relied entirely on this — entry gets away with it because it crosses the **outside pressure
   plate** (z=573) which opens the door server-side. Log: `door ensured open (… open=false)`.
2. **No exit runway.** Exit started the north walk from the door-adjacent inside pad (z=575), so the
   bot snagged on the door frame from a standstill. Entry has a 3–4 block runway and never snags.

**Fixes:**
- `setPenDoorState(wantOpen)` — toggles + **settles 450ms + re-verifies** the `0x04` bit, up to 4×.
  Callers abort (throw) if the door won't confirm open, instead of walking into it.
- Added `PEN_INSIDE_RUNWAY` (-278, 64, 577 — deepest walkable tile; z=578 is the south fence) and
  routed exit through it for a 3-block run-up.
- All door open/close is now **idempotent + state-checked** (never blind toggle); failure cleanup
  **ensures closed** so sheep can't escape during repositioning.

**Verified:** exit clears to z≤571 on the **first attempt**, multiple cycles, 0 deaths, no escapes.
Door meta confirmed: lower-half closed = 1, open = 5 (bit 0x04). See
[[../procedures/pen-door-traversal]].

**Open issue:** entry still occasionally stalls ~z=573.75 (north of door) — separate pre-existing
flakiness, likely sheep at the plate/doorway. Exit is the part the user flagged and it's solid now.

**Also this session:** stripped door-traversal chat spam (coords no longer announced on every
in/out — `bot.log` keeps them); "keep the fire going" sustain harvest now triggers at 85% mature
(was 100%) so a few knocked/replanting tiles don't hold up the cycle; harvest routines now abort
gracefully if they can't actually exit the house (too-late-in-day silent decline).

## 2026-05-30 — Bugfix: bedtime yield crashed the sustain loop

**Symptom (user):** the bot correctly came in at night but did not resume in the morning.

**Cause:** `BEDTIME_YIELD_LINES` and `MORNING_RESUME_LINES` were **plain-string arrays**, but
`pickLine` requires weighted `{text, weight(stats)}` objects (it reads `p.text`). The moment a
harvest hit bedtime, `yieldToBedtime` called `pickLine(BEDTIME_YIELD_LINES)` →
`Cannot read properties of undefined (reading 'replace')` → the harvest threw → the sustain loop
caught it, logged `loop error`, and **stopped** (`active=false`). The bot still "came in" because
auto-sleep is independent (no pickLine), but the dead loop never resumed at dawn. Latent since the
bedtime-yield was written (it had never actually triggered with a live harvest until tonight). Log
evidence: `[sustain] loop error: …'replace' → stopped after 3 cycle(s)`.

**Fix:** converted both pools to weighted `{text, weight}` objects. **Audited all 30 `pickLine`
pools** — these two were the only plain-string ones; the rest are correct. This is the third time
this bug class has surfaced (SUSTAIN_*_LINES, then these) — *any pool passed to `pickLine` must be
weighted objects, never bare strings.*

## 2026-05-30 — Non-blocking bake + collect-later watcher

Refinement so a long bake doesn't tie up the bot, and so "keep the fire going" stays the
priority. See [[../procedures/bake-potatoes]] (non-blocking section) + [[../procedures/food-safety-loop]].

**Change:** `runBakePotatoes` no longer blocks ~13 min at the furnace. It loads the furnace, sets
`pendingBake = {active, doneAt}`, and returns. A new `tryCollectBake()` on the 5s timer collects
the batch later when the bot is free — and **defers to the wheat cycle**: if the sustain loop is
active and the field is ripe, it lets the wheat harvest + hopper/seed deposits finish first, then
collects the potatoes. Bedtime handled for free (furnace cooks overnight; collection waits for
morning + idle). Partial-collect path: if fuel ran low and raw remains, it takes what's done and
reschedules. Also `then:'bake'` flag on the potato harvest skips the "bake or stash?" prompt on
the autonomous path. New ctl `collect_bake` (manual trigger + recovers a restart-orphaned batch,
since `pendingBake` is in-memory only).

**Tested (day 42935):** restarted mid-bake (64 in furnace), `collect_bake` →
`[collect-bake] taken=57 input_left=36 onhand=73 — rescheduled` (collected the done ones, came
back for the rest), bot free throughout. Fire loop re-armed and correctly waiting at
`mature=107/108` (one tile still ripening — verified all 108 tiles have crops, so not a stall).

**Note on the strict-maturity gate:** confirmed the `107/108` wait is a *lagging tile*, not a bare
one (`find_blocks wheat` = 108). The stall risk only applies if a tile fails to replant entirely.

## 2026-05-30 — Food safety loop (auto-restock baked potatoes)

New background safety net so the bots never run out of food. See
[[../procedures/food-safety-loop]].

**What it does:** on the same 5s timer as auto-sleep, if `baked_potato < foodSafetyMin` (16) and
the bot is idle, safe, and it's daytime, it autonomously runs the potato harvest then bake,
keeping the baked output on hand. On by default; toggle/tune via ctl `auto_food`
(`{enabled}` / `{min}`).

**`bot.js`:** `tryFoodSafety()` + `foodSafetyEnabled/Busy/Min` + `countBakedPotatoes()`; added to
the `startAutoSleep` interval; sustain loop now checks `!foodSafetyBusy` before a wheat cycle
(mutual yielding). ctl `auto_food`.

**Tested (day 42935):** bumped floor to 17 with baked=16 → `[food-safety] baked=16 < 17 —
harvesting + baking potatoes` → potato harvest started, sustain loop paused (`foodSafetyBusy`),
task `harvest_potatoes_rc`. Floor reset to 16.

**Rough edge:** `runHarvestPotatoesRightClick` asks "bake these?" and waits ~60s for a reply the
autonomous loop never gives, then the loop calls bake itself — works but wastes 60s. Candidate:
give the potato harvest a `then:'bake'` hand-off flag like the wheat `autoDeposit`.

**Sustain loop re-verified:** restarted "keep the fire going" this session; bot slept through the
night and woke at dawn with the loop still active, waiting for the field to regrow to 108/108
(cycle detection already proven in the run below).

## 2026-05-30 — "Keep the fire going" autonomous sustain loop

New capability: a hands-off farm loop tied to the wheat-ready detection, so the bot keeps the
bio-fuel hopper fed on its own. See [[../procedures/keep-the-fire-going]].

**What it does:** say **"keep the fire going"** → bot watches the field, and when fully mature
(108/108) harvests both halves → wheat into the [[../places/house-hopper]] → surplus seeds into
the kitchen chest (keep 16) → waits for regrowth → repeats. Stops on **"chill" / "stand down" /
"stop"**.

**`bot.js`:** `runSustainFarm()` + `sustainState`; new `autoDeposit` flag on
`runHarvestRightClick` (skips the "hopper or chest?" question and feeds the hopper directly);
`keep_fire` chat rule (before the generic harvest rule); `stop`/`stand_down` handlers now clear
`sustainState.active`; added "chill" to the stand-down pattern; ctl actions `keep_fire`,
`sustain_status`, `sustain_stop`. The harvest stays the task (one-at-a-time, bedtime-aware); the
loop holds no task between cycles.

**Bug found + fixed during the build:** `pickLine` requires weighted `{text, weight(stats)}`
objects, not plain strings — first version of the SUSTAIN_*_LINES pools were plain strings and
threw `Cannot read properties of undefined (reading 'replace')`. Converted to weighted objects.

**Tested live (day 42933):** said "keep the fire going" → `field ready (mature=108/108) — cycle
1` → harvested → `deposited 107 wheat to hopper (quick-move, 2 rounds)` (no prompt) →
`wheat_seeds: 101 (kept 16)` → back to waiting (`active:true, busy:false`) → `sustain_stop` →
`stopped after 1 cycle(s)`. Zero deaths.

**Open:** loop only re-fires at 100% maturity (relies on full replant each cycle). If tiles fail
to replant it waits forever; heartbeat log surfaces a stall. Stop tested via ctl; the chat
phrases use the same flag (wired, not yet exercised via live chat).

## 2026-05-30 — Mastering the hopper: quick-move deposit + seed management

**Why:** the prior harvest reported "deposited 19 wheat to hopper (64 kept) — didn't fit."
User pushed back: a 5-slot hopper has room for far more than 2 stacks, so "didn't fit" was wrong.

**Root cause (traced through mineflayer source + tested live):**
- The [[../places/house-hopper]] **drains continuously** into a bio-fuel machine (user lore:
  it powers the neighboring town). Draining is the hopper's normal state.
- `win.deposit()` picks a stack onto the cursor then left-clicks a slot it computed
  client-side. The hopper drains that slot underneath the click → server rejects the
  transaction → `deposit()` throws `'destination full'` (mineflayer `inventory.js:323`). The
  old harvest code caught it and printed its own "didn't fit" regardless of the real error.
- **Counter-intuitive live finding:** server-side quick-move (`clickWindow(slot,0,1)`) ALSO
  throws *"Server rejected transaction"* against the draining hopper — **but the items move
  anyway.** The rejection is the client's mis-prediction being corrected, not a real failure.

**Fix (in `bot.js`):** new `depositQuickMove(itemName, target, {keep})` — quick-move per stack,
retry with a fresh window each round, **verify by inventory delta** (not by the transaction
confirmation). Returns `{deposited, remaining, rounds, backedUp}`; surfaces `backedUp` if the
machine is jammed instead of looping. `runHarvestRightClick` hopper branch + new `deposit_wheat`
ctl action both use it.

**Seed management (user directive):** right-click harvest auto-replants without consuming
inventory seeds, so seeds are pure surplus. Policy: **keep 16 on hand, deposit the rest to the
kitchen chest.** `KEEP_SEEDS` changed 32→16; harvest tail auto-deposits seed overflow via
`runDepositNamed(['wheat_seeds'])` (the chest is stable, so plain `win.deposit` is fine there).

**Live tests (day 42929):**
- Wheat → hopper: 18 on hand → quick-move threw "Server rejected transaction" round 1 **but
  deposited=18 remaining=0**. Re-checked inventory after a delay: still 0 (no desync). Hopper
  read empty ~10s later (drained into the machine). ✓
- Seeds → chest: 351 on hand → **deposited 335, kept 16**. Chest re-opened: 5×64 + 15 = 335. ✓

**Open / next:** wire harvest→hopper to fire automatically off the wheat-ready alert
(`tryWheatReadyAlert`) so the bio-fuel line stays fed without a human in the loop. Not built
yet — deposit foundation proven first. Notes: [[../places/house-hopper]],
[[../procedures/deposit-wheat]], [[../procedures/deposit-seeds]], [[../procedures/right-click-harvest]].

## 2026-05-30 — Unified task system + bedtime yield (tested live)

**Problem solved.** Conflicting commands (a `come_inside`/auto-sleep firing during a harvest) used to fight over the pathfinder, oscillating the bot between the door and the field. Root cause: scattered `*Busy` booleans (`harvestBusy`, `bakeBusy`, etc.) with no cross-function coordination, and fire-and-forget command dispatch.

**Code change in bot.js:**
- New unified `activeTask` state (`{name, detail, startedAt, sleeping}`) with `startTask()` / `endTask()` / `taskBusy()` / `taskStatus()`. Replaced `harvestBusy` + `bakeBusy` entirely (zero refs left). `goInsideBusy` / `autoSleepBusy` kept as re-entry guards for their own primitives.
- Command dispatch now rejects conflicting work: `come_inside`, `go_outside`, `go_into_pen`, `go_out_of_pen` return `{ok:false, error:"busy", task, ...}` while a task is active instead of racing the pathfinder.
- New `task_status` ctl command. `stop` clears the active task + bumps `abortGen`.
- **Bedtime yield** (`yieldToBedtime` + `waitForMorning`): harvest/bake never refuse for time-of-day. If started at night, sleep first then begin at dawn; if bedtime arrives mid-harvest (checked every 10 tiles), announce → go inside → auto-sleep takes the bed → wake → walk back → resume. During yield `task_status` shows `sleeping:true, busy:false` so auto-sleep proceeds.

**Live test this session (day 42929, started timeOfDay ~6500):**
- Started a full harvest, then sent `come_inside` ~3s in → **rejected** `{ok:false, error:"busy", task:"harvest"}`. Oscillation bug confirmed gone.
- Harvest ran both fields: north 54 + south 54 = **activated=108, gained=83 wheat**. Deposit prompt fired; in-game reply "hopper" → deposited 19 to hopper, 64 kept. **`[task] ended: harvest`**, `busy:false`.
- All **108 tiles replanted** (right-click harvest replants in-action). HP 20, food 19 (auto-ate up from 15), **deaths 0** throughout.
- Bedtime yield **not** exercised — harvest finished mid-day; crops just replanted (immature) so a dusk re-harvest isn't possible yet. Code path verified by `node -c` + read-through only.

Open question to chase: catch a real bedtime yield on the next dusk harvest of grown wheat.

[[../procedures/harvest-wheat]] behavior changed (task registration + bedtime yield) — update when next touched.

## 2026-05-30 — Kitchen chest re-mapped (double → single); idle_wander action

**Kitchen chest re-mapped.** User removed the **left half** of the double kitchen chest,
leaving a single 27-slot chest at **(-266, 67, 569)** (was (-267,67,569) double, 54 slots).
Full re-map of [[../chests/house-kitchen-chest]] using a **white bed as a visible cursor**:
user drops the bed in a slot, bot reads its index (bed is vanilla/visible), then swaps in
the modded item. New layout — `0=pot (DO NOT TOUCH, salt station), 7=salt, 8=bakeware,
16=water, 17=mixing bowl, 18=iron, 24=bread, 25=dough, 26=flour`. Only iron(18) and
bread(24) are bot-visible; rest identified by position.

`bot.js` edits (need a restart to take effect):
- `KITCHEN_CHEST` and `HARVEST_WAYPOINTS.kitchen_chest`: (-267,67,569) → (-266,67,569).
- `CHEST_SLOTS`: re-mapped to the new single-chest indices above. Audited: all 8 keys, 19
  call sites, no stray numeric chest slots — updating the one map covers everything.
- Approach coords left at (-267,65,570) — still reaches (~2.4 blocks).
- Slot-layout doc comment rewritten.

**New `idle_wander` bot-ctl action.** Programmatic equivalent of the "stand down" / "do
your thing" chat commands: `{"action":"idle_wander","args":{"enabled":false}}` disables and
also cancels+freezes; omit `enabled` to query. Added so experiments can stop the bot
wandering off without depending on a human typing the chat command.

**Crafting-table diagnostic added.** Raw `client.on('open_window')` / `close_window`
loggers (+`lastRawWindow`) to investigate why the 3×3 table won't surface a window. Test
inconclusive so far — bot couldn't be positioned closer than ~4.3 blocks (interior
pathfinding bails toward the north wall) and no `open_window` fired at that range; a clean
close-range / control test (chest open) is the next step. Experiment still blocked.

**Third bed added.** User placed a 3rd bed to the right of the existing two, at
(-267, 65, 569). Wired as the third auto-sleep fallback (`BED_POS_RIGHT` /
`BED_APPROACH_RIGHT`) in both `BEDS` arrays (`tryAutoSleep` + bake-time sleep). Order is
now primary(-268) → left(-269) → right(-267); bot takes the first un-occupied one. See
[[../places/house-bed]].

**Hopper + wheat-routing question.** Found a vanilla hopper at (-266, 65, 573) — bot-visible
(see [[../places/house-hopper]]). Added a post-harvest prompt: now that harvests keep wheat
on hand, `runHarvestRightClick` asks "hopper or chest?" (`WHEAT_ASK_LINES`), waits 30s via
`waitForChatReply`; "hopper" → deposits to the hopper, "chest"/stash/store/deposit → kitchen
chest, no answer → "Ok, I'll just hang on to it I guess" and keeps it. `HOPPER` const +
deposit path (come inside → chest_approach, in reach of both). Mirrors the potato question.
Needs a restart to go live (added after the current process launched).

## 2026-05-29 — Harvest keeps wheat; idle-autonomy toggle added (day 42846)

**Bot state at start:** inside [[../places/house]] area, HP 20, food 19, deaths 0, daytime (day 42846).

**Change 1 — harvest no longer deposits wheat.**
- `runHarvestRightClick` tail rewritten: after harvest + sweep it tosses trash, tallies wheat on hand, and reports — **no walk back inside, no chest deposit.** Bot keeps the wheat and stays outside where the sweep ended.
- `HARVEST_DONE_LINES` reworded off "deposited / in the chest" → "keeping it on hand."
- Reason: wheat is needed on hand for upcoming tasks (sheep, crafting experiments).

**Change 2 — idle-autonomy toggle (new ability).**
- New chat commands suspend/resume idle autonomy. See [[../procedures/idle-autonomy-toggle]].
- Off: "stand down" / "just chill" (+ chill out, at ease, settle down). On: "do your thing" / "as you were" (+ carry on, go on then).
- Off cancels in-progress wander/musing, freezes the bot in place, and gates wandering + pen/field joins + musings via `idleWanderEnabled`.
- Auto-sleep, auto-eat, and explicit commands deliberately unaffected.
- **Confirmed working in-session** ("chill appeared to be working" per user). An unrelated crash ended that bot process; relaunched clean.

**Crafting-table experiment (incomplete) — finding worth keeping:**
- Goal was to test the chest pattern (8 wheat in a 3×3 ring) on the [[../places/house-crafting-table]] and take the modded output, then "stash unknowns."
- **The bot could not open a tracked crafting-table window.** `activate_block` hits the table (`name: crafting_table`) and `activate_and_read` was tried at 4.2 blocks AND point-blank (~1.3 blocks) — both returned `no window opened`, `currentWindow: null`.
- So distance is NOT the cause. The bake routine only ever uses the 2×2 *inventory* grid; this appears to be the first real attempt to drive the 3×3 table, and `bot.activateBlock` doesn't surface a usable window. Likely needs a dedicated open-crafting-table action in bot.js (e.g. listen for `windowOpen` / `bot.openBlock`) before the experiment can proceed.
- Also noted: **interior pathfinding to the table area is unreliable** — pathing to interior tiles near the north wall (z=569–570, x≤-268) routes the bot *out the door and around*, which can't reach an interior wall. `come_inside` + manual `walk_until` got it adjacent; the chest approach (-267,65,570) is the only reliably-pathable interior spot.

**Open questions:**
- How to open/track the 3×3 crafting-table window for modded recipes (code change needed).
- Why interior pathfinding bails outside for north-wall targets.

## 2026-05-21 — North field added to harvest routine (day 42108)

**Session goal:** integrate the second wheat field (north of the original) into the harvest routine.

**Bot state at start:**
- Position (-268.5, 65, 570.5) — inside [[../places/house]]
- HP 19→20, food 16→19, deaths 0
- Day 42108, timeOfDay 3657 (early morning, `isDay: true`)

**Discovery: North wheat field verified**
- `find_blocks` returned wheat at z=551..557, same x bounds (-287..-279), same y=64
- z=554 is a lily pad channel (same structure as z=562 in south field)
- z=558 is a grass-block divider (y=63) between the two fields — walkable
- Total: 54 tiles (27 per half), identical to the south field
- New journal note: [[../places/wheat-field-north]]

**Code changes (bot.js, pushed to Ripplebot):**
- Added `NORTH_FIELD_BOUNDS` constant
- Added `north_field_center` waypoint at (-283, 64, 554)
- `filterByHalf` now supports `'north-field'` and `'south-field'`; `'all'` spans both fields
- Refactored harvest into `harvestAndSweepField` helper — `'all'` mode does north field (harvest+sweep) then south field (harvest+sweep) to avoid drop despawn
- Chat handler: "north field" / "south field" target one field; bare "north"/"south" still target halves of the south field

**Test run: `half='north-field'`**
- Found 54 wheat tiles, activated all 54, 0 mature (all still growing)
- Sweep picked up 29 wheat from ground drops (leftover from a previous run)
- Bot crossed lily pads at z=554 and grass at z=558 without issues
- 0 deaths, no pathfinding failures

**Open questions:**
- None of the north field wheat was mature — need to wait and test a real harvest with drops
- Full `'all'` mode not yet tested end-to-end (code refactored after the test run)

---

## 2026-05-13 — Journal genesis (day 41325)

**Session goal:** establish the Obsidian journal network. Map what we already know.

**Bot state at start:**
- Position (-268.5, 65, 570.5) — inside [[../places/house]], near [[../places/house-bed]]
- HP 18, food 17, deaths 0
- Day 41325, timeOfDay 6192 (mid-morning, `isDay: true`)

**Inventory:**
- potato ×8 (slot 9)
- wheat_seeds ×20 (slot 37) + ×12 (slot 39)
- baked_potato ×16 (slot 38)
- shears ×1 (slot 40)
- bread ×64 (slot 43) + ×64 (slot 44)

**Notable anomaly:** previous notes (`places.md`) recorded slot 44 as a **hamburger** (an `unknown`-named modded healing item). Today slot 44 is **bread ×64**. Logged in [[../items/bread#anomaly]]. Lesson: **slot numbers are fluid**. Always re-read inventory before relying on a slot.

**Open questions to chase next:**
- What's actually in [[../chests/house-kitchen-chest]]? Need an `open_container` audit.
- What's in [[../chests/house-crafting-chest]]?
- Does the hamburger still exist in the world, or has it been consumed/lost?
- Is there a way to expose `craft` through `bot-ctl`? (Currently bread crafting isn't a callable procedure.)

**Notes seeded:**
- [[../index]]
- Places: [[../places/house]], [[../places/house-center]], [[../places/outside-orientation]], [[../places/orientation-blocks]], [[../places/yaw-convention]], [[../places/wheat-field]]
- Chests: [[../chests/house-kitchen-chest]], [[../chests/house-crafting-chest]]
- Items: [[../items/bread]], [[../items/wheat]], [[../items/wheat-seeds]]
- Recipes: [[../recipes/bread]]
- Procedures: [[../procedures/exit-house]], [[../procedures/enter-house]], [[../procedures/harvest-wheat]], [[../procedures/replant-seeds]], [[../procedures/deposit-wheat]]

### Policy update — harvest-wheat retry

Decision: [[../procedures/harvest-wheat#Retry policy|harvest-wheat now allows one retry on graceful failure]]. Prior runs showed Roz can fail an attempt (e.g. couldn't reach all crops, got stuck and self-recovered) and return safely to [[../places/house-center]] with no deaths and no damage taken. That recovery is the green light for one retry. **Damage of any kind disables retry** — damage means we hit something not yet in the journal, and a second blind attempt would just compound the unknown.

### Recovery — south-half harvest aftermath

After the south-half run (broke 27, replanted 27, but inventory only shows wheat ×26 — one drop missing), the auto-recovery path (`go-inside`) snagged at x=-272.30 and aborted on `harvest-error: didn't reach house_center`. Bot was stranded between pads at (-272.3, 65, 571.75), HP 20, deaths 0.

**Manual recovery (this session):**
1. Pathfind to `outside_orientation` (-275, 64, 572) range=0 → arrived (-274.5, 64, 572.41), on pad.
2. `look yaw=-1.5708` → `rawState.yaw` converged to -1.572 in ~1s.
3. `activate_block` (-272, 65, 572) → server replied `name: spruce_door`.
4. `walk_until axis=x target=-268 direction=gte` → reached (-267.81, 65, 572.55) in 2381ms, no snags.
5. Final pos (-267.56, 65, 572.55) — on `house_center`, HP 20, deaths 0.

**One missing drop** (broke 27, gained 26) is likely still on the field for ~5 minutes after the original break time. Drop recovery is a separate decision — see [[#Open question — broke vs gained accounting]].

### Open question — broke vs gained accounting

Twice now we've seen the harvest log report `broke=N` while inventory gain trails it (full-field run: broke=51 gained=43; south-half: broke=27 gained=26). The journal currently has no procedure for **drop reconciliation** — the gap could be drops still on the ground inside the 5-min window, drops that despawned, or drops that fell where the sweep points didn't cover. Worth adding a `verify_drops` step to [[../procedures/harvest-wheat]] that compares inventory delta to broken count and triggers a re-sweep if they disagree.

### Anomaly — replant placed off-field

During the south-half replant: `[replant] place fail -310, 62, 563`. That x is **23 blocks west of the field bounds** (x=-287..-279). Either the planner generated an out-of-bounds candidate, or `find_blocks` returned a farmland tile far outside the field. Worth logging in a future creature/place note — there may be unmapped farmland west of where we think the world ends.

### New procedure — stash-wheat

Added [[../procedures/stash-wheat]] and a chat trigger `Roz, stash the wheat`. Code change in `bot.js`:
- New `runStashWheat()` function (deposit-only path, mirrors the tail of `runHarvest`).
- New chat rule with pattern `(stash|deposit|dump|put|store|empty|clear).*wheat`, registered **before** the generic `harvest` rule so it doesn't get swallowed.
- New control command `stash_wheat` for direct `bot-ctl` invocation.

Bot quit and restart required to pick up the new code. After restart, plan to test with the wheat ×26 currently on hand from the south-half run.

### Planned for next session — right-click harvest + nautilus sweep

User flagged two new techniques to try together next session, **not yet tested**:
- [[../procedures/right-click-harvest]] — `activate_block` on mature wheat may harvest+replant in one action, collapsing [[../procedures/harvest-wheat]] and [[../procedures/replant-seeds]] into one pass.
- [[../procedures/nautilus-sweep-pattern]] — clockwise outside-in spiral around the field, replaces the explicit 8-point drop sweep with passive in-walk pickup.

Both are stubs in the journal; promote to `confirmed: true` after the test runs.

## 2026-05-14 — Sweep fix + door-entry snag resolved (day 41428–41431)

**Bot state at start:**
- Pos (-268.5, 65, 570.5) — inside house, by bed
- HP 20, food 20, deaths 0
- Day 41427, nighttime (auto-slept to dawn)

### Sweep fix — lily pad row removed

The full-field boustrophedon sweep included z=562, which is a **lily pad/water row** separating the north and south wheat halves — not farmland. After finishing the north half going west (ending at x=-287 on z=561), the sweep walked the entire lily pad row east-to-west (wasted motion) before starting the south half.

**Fix:** removed z=562 from the sweep row list. Also corrected `filterByHalf` south range from z=562–565 to z=563–565. The `all` sweep is now `[559, 560, 561, 563, 564, 565]` — 6 rows, continuous boustrophedon. After the north half ends at (-287, 561), the next target is (-287, 563) — Roz hops straight south across the lily pads.

Confirmed working: full harvest ran 54 activations → 43 wheat deposited with no carriage return.

### Door-entry snag root-caused and fixed

The recurring snag at x≈-271 to -272 on entry was caused by **z-drift**. The pathfinder to `outside_orientation` consistently lands at z≈572.5 instead of z=572.0. The corridor past the door is only 1 block wide:

- (-271, 65, 572): **empty-name modded block** with extended hitbox
- (-271, 65, 571): chest (north side)
- (-271, 65, 573): chest (south side)

At z=572.5, Roz's player hitbox clips the south chest. The unstick strafe was set to `'right'` (south when facing east) — pushing deeper into the obstacle.

**Fixes applied:**
1. **Z-alignment step** in `runGoInsideOnce`: if z > 572.3, face north and walk to z ≤ 572.1 before facing east. Centers Roz in the narrow passable band.
2. **Enter strafe direction** changed from `'right'` (south) to `'left'` (north) — pushes away from chests on snag.
3. **Exit does NOT get z-alignment** — adding it made things worse by drifting north into chests at z=571. Exit works fine without it.

**Test results:** 4 consecutive door traversals (2 exit, 2 entry) all succeeded on first attempt with no snags. Previously, entry failed 2-3 times before succeeding.

Cross-links: [[../procedures/enter-house]], [[../places/wheat-field]]

## 2026-05-14 — Right-click harvest confirmed (day 41328)

**Bot state at start:**
- Pos (-278.53, 63.94, 565.5) — east-adjacent to SE corner wheat at (-279, 64, 565)
- HP 20, food 17, deaths 0
- Daylight, no hostiles

**Test:** `activate_block` on a mature wheat block at (-279, 64, 565).

**Result: it worked.** Single right-click harvested **and** replanted in one step. Drops landed directly in inventory, **not on the ground.**

| | Before | After | Δ |
|---|---|---|---|
| wheat (inv) | 0 | 1 | +1 |
| wheat_seeds (inv) | 79 | 81 | +2 |
| block at (-279, 64, 565) | wheat | wheat (reset to growing) | replanted |
| ground drops within radius 4 | — | 0 | none |

[[../procedures/right-click-harvest]] promoted from planned to **confirmed**.

**Implications:**
- [[../procedures/harvest-wheat]] + [[../procedures/replant-seeds]] can be merged into one routine.
- The 8-point drop sweep in [[../places/wheat-field]] becomes unnecessary for the right-click path — drops never touch the ground.
- The [[../procedures/nautilus-sweep-pattern]] still wins as the *traversal* shape because it minimizes total walking distance, but it no longer needs to "sweep" anything.

**Open questions logged in [[../procedures/right-click-harvest#Next questions to answer]]:**
- Does it work on immature wheat? (Need to skip-vs-no-op behavior.)
- Does it work on potatoes? carrots?
- Server-side rate limit between adjacent activations?

**Next steps:**
- Test immature wheat behavior (one of the still-growing crops in the field).
- Test on potatoes at the potato patch.
- Once those answer, write `runHarvestRightClick({ half })` in bot.js and a new chat handler.

### South-half nautilus run — full results

CCW nautilus from SE corner, south half (z=563..565), right-click technique. 27 tiles in sequence.

**Inventory accounting:**
| Phase | wheat | wheat_seeds |
|---|---|---|
| Pre-run (after SE corner test only) | 1 | 81 |
| Post-harvest (27 activations) | 20 | 94 |
| Post-sweep (8-point full-field) | **27** | **99** |
| Total Δ | **+26** | **+18** |

**26 mature tiles → 26 wheat reconciled. Accounting closes for the first time.** Combined with the +1 from the earlier SE corner solo test = 27 wheat = full south-half count.

**Confirmed:**
- [[../procedures/right-click-harvest]]: immature wheat right-click is a **safe no-op**. The harvest loop should NOT filter by metadata — activate everything, let immature tiles do nothing.
- [[../procedures/nautilus-sweep-pattern]]: works as a traversal, but **the 8-point sweep is still required**. The pickup radius doesn't cover every tile the bot activates from 2-3 blocks away. +7 wheat were on the ground after the harvest pass and only collected during the sweep.
- HP 20, deaths 0, no damage at any point during harvest or sweep.

**Open improvement to test next:**
- If the loop pathfinds **range=1** (adjacent) to each tile before activating, do drops land in pickup radius and eliminate the need for a separate sweep? — see [[../procedures/nautilus-sweep-pattern#Future improvement]].

### Naming — "brute" vs "right-click"

User established naming convention (2026-05-14): the original `dig` + `place_block` + 8-point sweep technique is now called the **"brute method"** ([[../procedures/harvest-wheat]]). The new `activate_block` technique is the **"right-click method"** ([[../procedures/right-click-harvest]]). Both notes updated; aliases added in frontmatter so cross-links stay stable.

### bot.js — right-click is now the chat default

Implemented (2026-05-14, restart on day 41328). Changes in bot.js:
- New `runHarvestRightClick({ half, user })`. Right-clicks every wheat tile in the half (no metadata filter), pathfinds range=1 before each activation, then runs a full-coverage boustrophedon sweep of the harvested rows (z=559..561 north, z=563..565 south, or all for full). Re-enters house and deposits like the brute path.
- New control command: `./bot-ctl '{"action":"harvest_right_click","args":{"half":"north"}}'`.
- New chat handler `harvest-brute` matched on `(brute|old|dig|legacy).*harvest|wheat|field` — routes explicit brute requests to `runHarvest`.
- The original `harvest` chat handler now dispatches to `runHarvestRightClick`. Any `Roz, harvest the wheat` / `harvest the south half` etc. uses right-click by default.

[[../procedures/right-click-harvest]] and [[../procedures/harvest-wheat]] notes updated to reflect the dispatch change.

### bot.js — multi-item deposit chat handler

User asked for `Roz, deposit bread, wheat, and seeds` to work as a single deposit, with absent items silently skipped. Implemented as `runDepositNamed(names)`:
- Accepts any combination of `bread`, `wheat`, `wheat_seeds`.
- Keeps 64 bread and 32 seeds on hand; deposits the rest.
- Wheat is fully deposited.
- Items not on hand are skipped, not errored.

Chat handler `deposit-named` registered **before** [[../procedures/stash-wheat]] in the dispatch order. If the phrase mentions wheat **only** (no bread, no seeds), it defers to `runStashWheat` to preserve the dedicated wheat-only path. New procedure note: [[../procedures/deposit-named]].

### Cleanup pending

- Test right-click harvest end-to-end via chat (currently only tested via Python driver).
- Test multi-item deposit with the current inventory (lots of bread + seeds available).
- After both pass, this cluster of bot.js changes can be considered stable.

### Multi-item deposit — confirmed via chat

User: `Roz, please stash the seeds and the bread`. Bot dispatched correctly:
- `[chat-handled] deposit-named` — pattern matched.
- `[deposit-named] bread: 192 (kept 64); wheat_seeds: 81 (kept 32)` — deposited 192 bread, kept 64; deposited 81 seeds, kept 32. Wheat absent → silently skipped, no error.

[[../procedures/deposit-named]] confirmed working end-to-end. The keep-on-hand rule (`bread=64, wheat_seeds=32`) fires correctly.

### Door exit snag — recurring

Right after the deposit, `Roz, go outside` failed at `walk_until snag at x=-270.76`, 13 retries with strafe-right, gave up, returned to house_center. Same snag x-coordinate we've seen before. Deaths 0, no damage — the recovery path works. **A second exit attempt immediately afterward succeeded.** Worth investigating whether something at x ≈ -270.76 (a slab? a partial block?) is the culprit, or if it's just the door pulse timing being unreliable. Logged as an open follow-up.

### Right-click harvest — works on potatoes (single-tile test)

After the second (successful) door exit, drove the bot to the [[../places/potato-patch]]. Found 27 potato blocks via `find_blocks names=["potatoes"] maxDistance=8` (more than the 16-tile bounds in `POTATO_BOUNDS` — patch may be larger than documented).

Single-tile test on a mature potato at (-285, 63, 578):
- Inventory delta: **+2 potato**, baked_potato unchanged.
- Block stayed `potatoes`, replanted to growing.

[[../procedures/harvest-potatoes-right-click]] created, marked `confirmed_single_tile`. Full-patch test still pending. The chat handler still routes "harvest potatoes" to the legacy `runHarvestPotatoes` (left-click); a future bot.js change can wire a `runHarvestPotatoesRightClick` if we want potatoes to use the new technique by default.

### Water hazard discovered + driving rule

Before the full-patch run, surveyed water around the potato patch. **34 water blocks at x=-293..-288, z=580..586, y=61..62** — the SW corner of the patch safe zone is **one block from water**. New note: [[../places/water-hazard-west-of-potatoes]].

User rule (2026-05-14): **"stay out of the water."** Implemented as a clip to `x >= -287 AND z <= 579` for all potato-patch routines until the western strip is mapped tile-by-tile.

### Right-click full potato run (water-safe strip)

10 tiles in x=-287..-284, z=576..579. Boustrophedon, range=1 pathfind, no metadata filter, no separate sweep needed.

| | Before | After | Δ |
|---|---|---|---|
| potato | 10 | **25** | **+15** |
| HP / food / deaths | 20 / 19 / 0 | 20 / 19 / 0 | unchanged |
| ground drops post-harvest | — | 0 | sweep delta +0 |

8 of 10 tiles yielded (the other 2 immature, no-op). **Range=1 stand-spot discipline made the post-harvest sweep redundant on a compact patch** — drops landed in pickup radius every time. This is a real finding, not an artifact: matches the prediction in [[../procedures/nautilus-sweep-pattern#Future improvement]].

### What's still out there

`find_blocks` reported **43 total potato blocks** in the area. The water-safe strip handled 10. **33 potatoes are unmapped** in the western/southern region, intermixed with water blocks. They'll require a tile-by-tile safe-stand-spot survey before any harvesting can resume there. Logged as the top open task for next session.

### Pond geometry corrected

User clarified mid-session: the pond is oval, not a half-plane wall. Land continues south past it. Potatoes line the **east shore**, not just the northern strip. Block-by-block probe at y=62 and y=63 (after user reminder that all blocks should be vanilla — `farmland` at y=62, `potatoes` at y=63, `water` for the pond) gave:

```
y=62 (walking surface):
              -292 -291 -290 -289 -288 -287 -286 -285 -284
z=576..579:    □    □    □    □    □    □    □    □    □
z=580:         ~    ~    □    □    □    □    □    □    □
z=581..587:    ~    ~    ~    ~    ~    □    □    □    □   ← pond
z=588..590:    □    □    □    □    □    □    □    □    □
```

The entire **east shore at x=-287..-284 is farmland**, all the way down to z=587 and beyond — no water on that strip. Updated [[../places/potato-patch]] and renamed [[../places/water-hazard-west-of-potatoes|the water note]] to describe the oval pond properly. Driving rule simplified: **`x >= -287` is the only clip needed** — z is unconstrained.

**Reachable potato tiles, water-safe:**
- Already harvested: z=576..579 (10 tiles)
- **Still mature, still reachable: z=580..587 (~22 tiles)** — these are the next harvest target.

### Pond fully mapped + user de-risked the shoreline

Surveyed the y=62 layer over x=-294..-283, z=575..591. Pond is a **lopsided oval, 5 wide at the north and 6 wide at the middle, fully ringed by farmland**:

```
y=62 (walking surface):
     -294 -293 -292 -291 -290 -289 -288 -287 -286 -285 -284 -283
z=580  F    ~    ~    ~    F    F    F    F    F    F    F    □
z=581  F    ~         ~    ~    F    F    F    F    F    F    □
z=582  F    ~    ~    ~    ~    ~    F    F    F    F    F    □
z=583  F    ~    ~    ~    ~    ~    ~    F    F    F    F    □
z=584  F    ~    ~    ~    ~    ~    ~    F    F    F    F    □
z=585  F    ~    ~    ~    ~    ~    ~    F    F    F    F    □
z=586  F    ~    ~    ~    ~    ~    ~    F    F    F    F    □
z=587  F    F    ~    ~    ~    ~    ~    F    F    F    F    □
z=588  F    F    F    F    F    ~    ~    F    F    F    F    □
```

**User removed the x=-287 column of potatoes** to put a one-tile farmland buffer between the bot and the water. Re-survey: 31 potatoes remain, now in a 3-wide strip at x=-286..-284, z=577..587.

Driving rule updated: **clip to `x >= -286`** (was `x >= -287`). Notes updated:
- [[../places/potato-patch]] — added the new layout grid
- [[../places/water-hazard-west-of-potatoes]] — full pond map at y=62

**Patch geometry now fully canonical in the journal.** Ready for a real run.

### Full safe-zone potato harvest

Boustrophedon over 30 tiles in x=-286..-284, z=577..587, range=1 pathfind, no metadata filter.

| | Before | After | Δ |
|---|---|---|---|
| potato | 27 | **62** | **+35** |
| HP / food / deaths | 20 / 19 / 0 | 20 / 19 / 0 | unchanged |
| Position | (-285.4, 62.94, 579.5) | (-283.5, 62.94, 587.5) | walked the strip |

30 activations → 14 yielded (immature or freshly-replanted no-ops on the rest). The +35 means yielding tiles produced a mix of 1, 2, and 3 potatoes — vanilla potato drop is 1-4, and we saw the full range.

**Drops still hit the ground sometimes.** Per-tile inventory delta showed the pattern from wheat: tile N reads 0, then tile N+1 reads 2-3 as the bot picks up the prior drop while walking past. The boustrophedon visits every tile so the delayed pickup self-resolves; no separate sweep needed for this strip shape. The earlier optimistic claim ("range=1 makes the sweep redundant") only fully holds when the layout puts every drop directly under the next stand-spot — true here, may not be true in larger configurations.

**Bot ended at SE corner (-283.5, 62.94, 587.5)**, well clear of water. Clip held: pathfinder never tried `x < -286`.

### Kitchen chest upgraded to double (54 slots)

User upgraded [[../chests/house-kitchen-chest]] from single (27 slots) to double (54 slots). Verified via `open_container` → `containerSize: 54`.

**Backward-compatibility audit:** all existing deposit code uses either `win.deposit(type, meta, count)` (vanilla API, size-agnostic) or computes `containerSlotCount = win.slots.length - 36` dynamically, so **no bot.js changes are required**. Existing items kept their slot positions (0..26); the new 27 slots (27..53) are all empty and ready for use.

Audit also confirmed: **no `poisonous_potato` in the chest** — historical record is clean per the user rule in [[../items/poisonous-potato]] that they should be discarded, never stored.

### Poisonous potato rule

User directive (2026-05-14): if a `poisonous_potato` ever appears in inventory, **throw it away** — don't bake (won't smelt anyway), don't store (cross-contaminates food chest), don't eat. New note: [[../items/poisonous-potato]] with implementation hook for a future `runDiscardPoison()` helper.

### Bake-potatoes — old polling logic exited early; rewritten

User noted that polling every 3s and pulling baked potatoes one batch at a time is wasted work — the bake takes a known time, so just load + walk away + take everything at the end.

**Old logic failure (2026-05-14, this session):** 62 raw potatoes loaded; polling loop exited prematurely with `taken=30, stashed=36, onhand=8`. **Furnace inspection showed 23 still in input + 9 in output — 32 unaccounted for in the bot's tally.** Manually drained: 11 + 21 = 32 baked recovered. All 62 + 14 prior = **76 baked accounted for** (40 on hand, 36 in chest).

**New logic** (`runBakePotatoes` in bot.js):
- Load all raw, close furnace.
- `await sleep((N × 10) + 8 seconds)` — vanilla smelt time × count + buffer.
- Open furnace once, drain output (defensive 3-attempt loop in case stack overflow).
- Sanity warn if input still has unsmelted items (fuel out / time underestimate).
- Move to chest, deposit beyond keep-of-8.

Bot restarted to load the new code. New procedure note: [[../procedures/bake-potatoes]].

### Nautilus ordering wired into `runHarvestRightClick`

User noted the chat-triggered right-click harvest was using the right *technique* (activate per tile) but not the right *pattern* — `findBlocks` returns distance-sorted, so the bot was walking the field randomly instead of in CCW nautilus order from the SE corner.

Added `orderNautilusCCW(tiles)` helper in bot.js. Algorithm: walk west along the south edge → north up the west edge → east across the north edge → south down the east edge → spiral inward, repeat until exhausted. Tiles outside the bounding box are appended at the end as a safety net.

`runHarvestRightClick` now calls `orderNautilusCCW` after the half-filter and before the per-tile loop. Restarted the bot. Updated [[../procedures/right-click-harvest]] and [[../procedures/nautilus-sweep-pattern]] to reflect the implementation.

**Confirmed working via chat trigger:** user reported "Roz is doing it" after the rewire — chat-triggered right-click harvest now follows the canonical CCW nautilus pattern. No critique on the run, no further changes requested. **The chat-driven farming loop is now feature-complete for wheat.**

## 2026-05-17 — Fix follow-me targeting bug

**Bug:** `findPlayerEntity` had a nearest-player fallback (lines 428-437) that returned the closest entity when the exact username wasn't loaded in `bot.players`. On a multi-bot server, "follow me" from a player whose entity wasn't chunk-loaded caused the bot to follow the other bot instead of the commanding player.

**Fix:** Removed the nearest-player fallback. Function now returns `null` if exact username lookup fails. All 4 callers already handle `null` gracefully (chat follow → `CANT_SEE_LINES`, sticky tick → stops follow, ctl follow → error response, `facePlayer` → `faceNearestPlayer` fallback).

**Root cause:** the fallback was originally added for single-player convenience (so "follow me" worked even if mineflayer hadn't loaded the entity by name). On a multi-bot server, the "closest player" heuristic silently picks the wrong target.

## 2026-05-14 — End-of-session summary (day 41330)

Big session. Captured here so a future me can scan the highlights without re-reading every log entry.

### What we proved
- **Right-click harvest** (`activate_block`) on mature wheat does harvest+replant in one server call. Confirmed on wheat AND potatoes. Immature crops are a safe no-op — no metadata filter needed. See [[../procedures/right-click-harvest]] and [[../procedures/harvest-potatoes-right-click]].
- **CCW nautilus from the SE corner** is the canonical traversal for the [[../places/wheat-field]]. Implemented as `orderNautilusCCW(tiles)` in bot.js.
- **Range=1 pathfinding before each activation** improves drop pickup, but doesn't fully eliminate ground drops in a moving harvest. **Full-coverage sweep of the harvested half is still required** — every tile, not 8 sample points. The deprecated 8-point sweep underperforms.
- **Vanilla `win.deposit()` is chest-size-agnostic** — the [[../chests/house-kitchen-chest|kitchen chest]] upgrade from single (27) to double (54) required zero code changes.

### What we built (bot.js)
- `runHarvestRightClick({ half, user })` + `orderNautilusCCW(tiles)` helper
- `runStashWheat()` and chat trigger `Roz, stash the wheat`
- `runDepositNamed(names)` and chat trigger `Roz, deposit bread, wheat, and seeds` (silently skips missing items)
- Bake-potatoes rewrite: load → wait `(N×10s)+8s` → drain output once. No more polling. No more auto-stash (baked potatoes stay on hand).
- Chat-handler precedence: right-click is now the default for `harvest`; brute method only on explicit `(brute|old|dig|legacy)`.

### What we mapped
- **Pond west of [[../places/potato-patch]]:** lopsided oval, fully ringed by farmland, bounds documented in [[../places/water-hazard-west-of-potatoes]].
- **Potato patch real extent:** 3 wide × 11 tall after the user's shoreline-row removal. Drive rule: clip to `x >= -286`.

### Rules established
- Damage during harvest → no retry, full stop ([[../procedures/harvest-wheat#Retry policy]]).
- Stay out of the water — clip every potato routine to `x >= -286`.
- Baked potatoes stay on hand; never deposit ([[../procedures/bake-potatoes#User rule]]).
- Poisonous potatoes → throw away ([[../items/poisonous-potato]]).

### Open follow-ups for next session
- **Door exit snag at x≈-270.76** keeps recurring on the first try; second attempt usually works. Worth investigating what's at that x — slab? partial block? — instead of just retrying.
- **Wire `runHarvestPotatoesRightClick` + nautilus** into bot.js + chat. Currently potatoes still dispatch to the legacy `runHarvestPotatoes` (left-click) on the chat trigger. Right-click on potatoes only works via Python driver or hand-issued `bot-ctl`.
- **Carrots:** never seen yet. Same right-click mechanic likely applies.
- **`runDiscardPoison()` helper** — automate the throw-away rule instead of hoping it never comes up.
- **33 unmapped potatoes** west/south of the pond from the original survey: investigate whether they're on islands or unreachable. (May not matter — current 3-wide strip of 31 plants is probably enough.)
- **Drop-yield distribution** — small samples so far: wheat = 1 wheat + 0..2 seeds; potato = 1..3 potato. Bigger N would let us predict yields.

### What didn't change
- House layout, bed, furnace, door procedures.
- Wheat field bounds (still x=-287..-279, z=559..565).
- Bot identity (`Ripplebot` / `Roz`).
- Auto-sleep, auto-greet, auto-eat all still on.

### `bake the potatoes` now pulls from chest first

User: 'can "Roz, bake the potatoes" also mean "take them out of the chest and put them into the furnace"' — yes, that completes the harvest→bake loop now that harvest deposits raw potatoes in the chest.

Added a chest-withdraw step at the top of `runBakePotatoes`:
1. Pathfind to chest_approach.
2. Open the kitchen chest.
3. Iterate chest slots, find every `potato` stack, withdraw via `win.withdraw(type, meta, count)`.
4. Close chest.
5. Continue with the existing inventory check + furnace logic.

If neither inventory nor chest has potatoes, chats "No raw potatoes — none in inventory or the chest." If withdraw succeeded, chats the count pulled and the total going into the furnace.

[[../procedures/bake-potatoes]] updated.

### Potato chat handler now uses right-click

User: "potato harvest is back to brute method. it did not do right click... and it didn't get them all." Looked at the log: chat handler `harvest-potato` was still wired to `runHarvestPotatoes` (left-click brute). I had documented that gap but never closed it.

Most recent brute run: broke 29, gained only 14, deposited 6. **15 potatoes lost** — likely on the ground inside the pen (some may have been near the water edge since brute had no `x >= -286` clip).

Implemented `runHarvestPotatoesRightClick({ user })` in bot.js:
- Mirrors `runHarvestRightClick` (wheat) but uses potato waypoints and the water-safe clip `x >= -286`.
- No metadata filter (immature potatoes are a no-op).
- Boustrophedon by z, range=1 pathfind before each activation, full-coverage sweep after.
- Deposits raw potato to the kitchen chest at the end.

Chat handler `harvest-potato` now dispatches to it. Control-socket action `harvest_potatoes` also routes here; legacy brute preserved as `harvest_potatoes_brute` for emergency fallback.

[[../procedures/harvest-potatoes-right-click]] updated to reflect the wiring.

### Shearing — A/B test, fence-hop attempts, gate decision

**A/B test on `activate_entity` packet mode (2026-05-14, ~115 activations each):**
- single-packet (mineflayer default): **+1 wool** picked up by bot
- double-packet (interact + interact_at, matching vanilla client): **+3 wool** picked up

Default switched to `mode=double` in bot.js. The single-packet version still fires sheep-shearing server-side (most drops landed inside the pen for the user to collect), but double-packet appears to be ~3x more reliable when the entity is moving.

**Fence-hop attempts (deferred):** tried 4+ variants of sprint/jump/forward to clear the spruce fence at (-278, 64, 574). Bot always landed on top of the fence at z=574.08 with no horizontal progress to z>=575. Attempted: jump+forward together, forward-then-jump, sprint+jump+forward, longer jump-hold, 2-tile runway. None made it across.

**Resolution:** user is putting back the `spruce_fence_gate` at (-278, 64, 574) as the canonical bot entrance. Sheep don't open gates, so the pen stays sheep-safe; the bot uses `activate_block` on the gate to open/close. Gate-traversal procedure to be implemented after dinner.

### Shearing skill — works via outside-of-fence walk

User taught the shearing skill. Equip shears → walk along z=573 (just outside the [[../places/south-fenced-area]] north fence) → right-click sheep on the other side. Vanilla 1.12.2 sheep drop 1-3 wool per shear. Re-shearing a naked sheep is a harmless no-op (same pattern as immature crops with right-click harvest).

**First run:** ~135 activations across 9 walking spots. **30 wool collected by the user** from drops that landed inside the pen, plus 2 picked up by the bot itself. Bot HP unchanged, deaths 0.

**New action exposed in bot.js:** `activate_entity { id }` — wraps `bot.activateEntity(ent)` for entity right-clicks. First use case is shearing; same action will work for milking cows, breeding, etc.

**Drop pickup gap:** the pen is 5 wide (z=574..578) and the bot stays at z=573 outside the fence. Drops that land deep inside the pen (z=576+) are out of the bot's auto-pickup radius. User collected those manually.

**Did NOT hop the fence** — user noted it might work but warned the pond is nearby and a wrong jump could be fatal. Sticking to the outside walk for now.

New procedure note: [[../procedures/shear-sheep]].

### South fenced area surveyed; west stairs identified

User pointed out the spruce fence south of [[../places/outside-orientation]] and asked Roz to follow it west to the stairs. Mapped the enclosure: rectangular spruce-fence pen ~9×5 at y=64, x=-282..-274, z=574..578. Two staircases: east stairs at (-274, 64, 571..573) and **west stairs at (-284..-285, 63, 572)** descending from y=64.

User foreshadowed a new skill involving [[../items/shears]] — best guess is sheep shearing in this pen. New place note: [[../places/south-fenced-area]].

Bot exited and re-entered cleanly with the new retry-wrapped door procedures. No retry needed on either trip — first attempt succeeded both ways. HP 19 throughout, deaths 0.

### Cleanup — brute wheat method removed entirely

User: "I didn't realize you had kept brute wheat — let's do some cleanup of our past mistakes." Right-click is the only technique we use now; brute existed only as a fallback that was never going to be invoked.

Deleted from bot.js:
- `runHarvest({ half, user })` — brute wheat harvest function (~130 lines)
- `runReplant({ half, startDeaths })` — wheat replant helper used only by `runHarvest`
- `SWEEP_POINTS` constant (the deprecated 8-point sweep coords)
- `harvest-brute` chat handler (the `(brute|old|dig|legacy)` pattern)
- `case 'harvest'` in the control-socket dispatcher

Kept (still used): `filterByHalf` (used by right-click), `FIELD_BOUNDS`, `runHarvestPotatoes` (legacy left-click for potatoes — still the chat default until right-click is wired in for them), `POTATO_SWEEP_POINTS`.

### Door retry wrappers

User: "no retry on harvesting potatoes — should be the same rule as wheat: retry on graceful failure, not on damage. Applies to anything that starts with 'go outside first'." Implemented at the door layer rather than per-harvest:
- Renamed inner functions: `runGoOutside` → `runGoOutsideOnce`, `runGoInside` → `runGoInsideOnce`.
- New wrappers `runGoOutside` / `runGoInside` capture HP and deaths before, run the inner function, classify the failure on throw via `isGracefulDoorFailure(err, hpDelta, deathDelta)`. Retry once if graceful; rethrow if damage or death.
- All callers (right-click harvest, potato harvest, direct chat "go outside") get retry transparently.

This addresses the door snag at x≈-270.76 that has cost us at least three harvest attempts this session. **Next time the snag fires, the wrapper retries once** instead of returning to house_center and aborting the whole routine.

### Late session — `stash the baked potatoes` chat trigger

User tried `Roz, stash the baked potatoes` and the dispatcher didn't catch it. Cause: the `deposit-named` chat pattern matched only `bread|seeds|wheat`, and the auto-stash removal had me conclude "never deposit baked potatoes" too broadly.

Distinction the user clarified: **no auto-stash after bake** (still true) vs. **never deposit at all** (was wrong). Manual deposit via chat is wanted; just not the post-bake reflex.

Code change in bot.js:
- Pattern extended to match `baked\s*potato(es)?`.
- `runDepositNamed` keep-on-hand for `baked_potato` set to 16 (small enough to leave most of a fresh bake stashable, large enough that auto-eat doesn't starve the bot before the next bake).
- Added a guard so `wheat` regex doesn't false-match inside `wheat seeds`.

Restarted bot. [[../procedures/deposit-named]] and [[../procedures/bake-potatoes]] updated.

### Baked-potato deposit removed; chest stash retrieved

User directive (2026-05-14): **baked potatoes stay on hand for eating, never go in the chest.** Two changes:
1. **Code:** removed the post-bake auto-deposit step from `runBakePotatoes`. The function now ends after draining the furnace output and chatting the count. Bot restarted to load.
2. **State:** retrieved the 36 baked potatoes that the OLD logic had stashed in slot 1 of [[../chests/house-kitchen-chest]] via `withdraw_slot`. Inventory now shows **76 baked_potato on hand** (40 from this session + 36 retrieved). Chest slot 1 is empty.

[[../procedures/bake-potatoes]] updated with the rule. [[../procedures/deposit-named]] keep-on-hand table updated to mark `baked_potato` as never-deposit.

### Sweep policy update — full coverage required

User correction (2026-05-14): the post-harvest sweep must cover **every tile of the harvested half**, not just 8 sample points. Confirmed by running a 27-tile boustrophedon sweep across the south half after the 8-point sweep — found **+4 seeds at (-287, 564)** that the 8-point sweep missed.

[[../places/wheat-field]] updated:
- Canonical rule is now full-coverage sweep, scoped to the half that was harvested.
- The 8-point sweep is moved to a "DEPRECATED" section with history note.

**Final south-half cycle accounting:**
- Mature pre-harvest: 26 (+1 prior corner test = 27 total south-half wheat)
- Wheat collected: 27 (full reconciliation)
- Seeds collected: +18 during harvest, +4 in full sweep = **+22 net seeds** for the cycle
- HP 20, food 15, deaths 0, no damage

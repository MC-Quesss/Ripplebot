---
type: ops
name: prismarine_viewer_and_log_rotation
created: 2026-06-17
confirmed: true
status: implemented 2026-06-17 (in-game view test pending)
---

# prismarine-viewer + bounded log file

Two operator-facing infra changes to bot.js on 2026-06-17. Neither touches
in-world behavior; both are about watching and maintaining the bot.

## prismarine-viewer (web view at http://localhost:3007)

Three distinct breakages had to be cleared, in the order they surfaced:

1. **Dependency downgrade (the real root cause).** However prismarine-viewer was
   first added, it rewrote package.json to *much older* versions: mineflayer
   `^4.37.1` → `^1.4.0` (resolved 1.8.0, ~2019), mineflayer-auto-eat `^5.0.3` →
   `^3.3.6`, minecraft-protocol downgraded too. bot.js is written for mineflayer
   4.x, so 1.8.0 crashed with `windows.InventoryWindow is not a constructor`
   before spawn — the control server and viewer never started. prismarine-viewer
   has **no** mineflayer dep/peer, so nothing required this; it was spurious
   corruption. **Fix**: `git checkout HEAD -- package.json package-lock.json` to
   restore the working versions, then `npm install prismarine-viewer canvas` to
   re-add the two on top (they don't conflict). Verified: mineflayer 4.37.1,
   prismarine-windows 2.10.0, prismarine-viewer 1.33.0, canvas 3.2.3.
2. **Missing `canvas` native module.** prismarine-viewer hard-depends on `canvas`
   for entity rendering; the original add left it uninstalled, so
   `require('prismarine-viewer')` threw `Cannot find module 'canvas'`. Installed
   `canvas` (pinned `^3.2.3`; Node 26 has a prebuilt binary, no source build).
3. **Use-before-definition.** The init was placed *before* `bot` existed
   (`bot.once('spawn', …)` at the top, but `const bot` is created ~150 lines
   down) — a temporal dead zone `ReferenceError`.
- **Code fix**: viewer init now lives right after `bot.loadPlugin(...)` (just
  past `mineflayer.createBot`), inside a `bot.once('spawn')` handler wrapped in
  try/catch. The viewer is a debug aid, not core functionality, so a broken
  `canvas` logs `[viewer] prismarine-viewer disabled: …` and the bot keeps
  running. On success it logs the URL.
- `firstPerson: true` → first-person view; set false for a bird's-eye view.
  Port `3007` is the viewer's HTTP port, not the Minecraft server port.
- **Verified live 2026-06-18**: bot launches clean (no `[uncaught]`), control
  server on :25580, `[viewer] … started on http://localhost:3007`, viewer
  serves HTTP 200, `pos` returns HP/food 20.

### Control bar on the viewer page (2026-06-18)

Replaced prismarine-viewer's bundled `mineflayer` helper with our own
`startViewer(bot, port)` in bot.js, so we own the served page. It mirrors the
helper's render path using the module's exported `WorldView`
(`require('prismarine-viewer/viewer')`) and adds three Express routes:

- `GET /` serves our own `VIEWER_HTML` (the viewer bundle's `<script src=index.js>`
  + a control bar); the bundle, textures, and `worker.js` fall through to
  `express.static(prismarine-viewer/public)`.
- `POST /cmd {action,args}` reuses the TCP `handleCommand()` dispatcher, so any
  bot-ctl action works from the page. Buttons: **Look around** (yaw sweep),
  **Go inside** (`come_inside`), **Go outside** (`go_outside`), **Say** box (chat).
- `POST /camera {firstPerson}` flips the module-level `viewerFirstPerson` flag the
  render loop reads — so the **Camera** button toggles first/third person *live*,
  no restart (the original `firstPerson` option was fixed at init).

Touches no node_modules; survives `npm install`. Verified: page serves the bar,
bundle still 200, `/cmd pos` returns live state, `/camera` logs the switch.

## Single bounded log file (tail-trim, no archives)

- `bot.log` had grown to ~939 MB — `logEvent` appended forever with no bound.
- **Fix**: `bot.log` is capped at `LOG_MAX_BYTES` (50 MB). When it passes that,
  `trimLogTail()` rewrites the file to its last `LOG_KEEP_BYTES` (10 MB) —
  keeping the most recent history, dropping older lines — then logging continues
  from a `[log] trimmed …` marker. The trim drops a partial leading line so the
  file always starts on a clean record. A startup check trims a leftover
  oversized log too. A running byte counter (`logBytes`) drives the check; the
  file oscillates between ~10 MB and 50 MB.
- **No archives** — deliberately a single file, not a rotation chain. bot.js is
  the only writer (launched as plain `node bot.js`, no shell redirect), so the
  Node stream owns the file; the trim runs with the stream closed, then reopens
  in append mode.
- Verified against a synthetic 60 MB log: trims to exactly 10 MB, retains the
  newest lines, no partial leading line, ends on a newline.

## Verification

- `node --check bot.js` clean; `canvas` and `prismarine-viewer` both load.
- Bot not started from this session (operator runs it). In-game: confirm the
  `[viewer]` log line and that http://localhost:3007 renders on next launch.

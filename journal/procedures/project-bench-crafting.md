---
type: procedure
name: project_bench_crafting
location: house
block: project_bench
status: confirmed
confirmed: true
first_tested: 2026-06-01
---

# Crafting on the Project Bench (modded 3×3)

The bot can drive a **ProjectRed Project Bench** for 3×3 crafting — something the vanilla
crafting table on this server cannot do. Confirmed 2026-06-01: planks → wooden buttons,
end-to-end, output landed in inventory.

## Why the vanilla table doesn't work (and the bench does)

mineflayer crafting is **entirely window-based** (`bot.craft` → `activateBlock` → wait for
`windowOpen` → click grid → take output). No open window = no craft.

- **Vanilla crafting table** (managed here by the `fastbench` mod): right-clicking it produces
  **no server response at all** — no `open_window`, no `window_items`, nothing on any mod
  channel (sniffed; only background `buildcraftlib`/`ic2`/`autoreglib`/`journeymap` noise). Its
  crafting GUI is transient (not a TileEntity container), and on this server the bot never gets a
  window to drive. Chests/furnaces/hoppers DO open (they're TileEntity containers using the
  vanilla `open_window`), which is why those work but the table doesn't.
- **Project Bench** (`projectred-expansion`): a TileEntity block with a **persistent server-side
  container** (3×3 grid + output + internal storage). Right-clicking it opens a real container —
  the server sends `window_items` for a new window id — so it IS drivable. See window adoption
  below.

**So: keep the Project Bench. A vanilla table will not work for bot crafting on this server.**
(One untested nuance: the bot was never sniffed for `window_items` on the vanilla table before it
was swapped out — but it produced zero response in every other probe, so it almost certainly sends
none. The bench is the better block regardless: persistent storage + auto-restock.)

## Window adoption — the key mechanism (`bot.js`)

Forge mod GUIs open via an **FML network packet**, NOT the vanilla `open_window` mineflayer
listens for. So even though the server opens a real container for the bot (and sends its
`window_items`), mineflayer never creates a window object — `bot.currentWindow` stays null and it
stashes the orphaned `window_items` waiting for an `open_window` that never arrives.

The fix is a `window_items` listener in `bot.js` (registered before `createBot`, so it runs first)
that **synthesizes the missing `open_window`** for any window id mineflayer doesn't recognize:

- Deferred one tick (`setImmediate`) so mineflayer's own handler stashes the packet first.
- Skips if `bot.currentWindow` already matches the id (vanilla containers get a real
  `open_window`, so they're handled normally and not double-adopted).
- Emits a synthetic `open_window` with `inventoryType: 'minecraft:container'` and
  `slotCount = items.length − 36`. mineflayer then creates the window, populates it from the
  stashed `window_items`, and fires `windowOpen`.

This makes any modded TileEntity-container GUI drivable, not just the bench.

## Project Bench slot layout (window id 1, 65 slots)

- **Total:** 65 = 29 bench slots (0–28) + 36 player inventory (29–64).
- **Crafting grid:** slots **0–8**, **row-indexed** — 0,1,2 = top row, 3,4,5 = middle row,
  6,7,8 = bottom row. Confirmed 2026-06-01: 3 planks in the middle row (slots 3,4,5) → 6 wooden
  slabs in the output. (An earlier "column-indexed" note was wrong — it came from messy testing.)
- **Output slot:** **28**.
- **Internal storage:** the remaining bench slots (≈9–27). The bench **auto-restocks the grid from
  its storage** between crafts — one shift-click on the output crafted all 4 planks → 4 buttons.
- Player inventory occupies window slots 29–64.

## How to drive it

1. Pathfind adjacent: `pathfind (-270,65,570) range=1`.
2. `activate_block (-270,65,569)` — adoption fires automatically; confirm `window_slots` reports
   `minecraft:container, total 65`.
3. Place ingredients: pick up a stack with `click_slot {slot, button:0, mode:0}`, then
   `button:1` (right-click) to drop 1 per grid cell. **Mind the row indexing** for shaped recipes
   (a horizontal row is 0,1,2 / 3,4,5 / 6,7,8).
4. Read `window_slots` and check slot **28** for the computed output.
5. Take the output: shift-click works (`click_slot {slot:28, button:0, mode:1}`) — it crafts
   repeatedly and the bench auto-restocks from storage. Output lands in the player inventory.
6. `close_window` when done.

## Confirmed working: slabs

3 planks in a horizontal row → 6 wooden slabs. Confirmed end-to-end: the bot took the output into
inventory (server truth verified after a resync). Slabs are NOT removed by CraftTweaker — the
earlier "no slab output" was botched placement during messy testing, not a missing recipe. 1 plank
→ 1 wooden button also confirmed.

## Autonomous crafting — the close/reopen trigger (2026-06-02)

The bot-placement limitation below has a **workaround: the bench computes the output on
GUI-open, not on ingredient placement.** Confirmed 2026-06-02 with the 8-seed ring → plant
ball (`unknown`) recipe:

1. Bot places the 8-seed ring (perimeter slots 0,1,2,3,5,6,7,8; center 4 empty) via `click_slot`
   — slot 28 stays **empty** (placement alone never triggers the calc, even after a re-read).
2. **`close_window`, then re-`activate_block`** the bench. On reopen, slot 28 **computes** the
   output. (Re-read `window_slots` once for the adoption lag.)
3. Take the output (`click_slot {slot:28,button:0,mode:0}`) → 1 plant ball, which **consumes the
   8 grid seeds** (clean 8:1). The grid *appears* to still hold the seeds right after — that's
   desync; a fresh reopen shows it empty.

**Batch via shift-click (UNTESTED for seeds — try next):** load surplus seeds into internal
storage (slots 9–27), place one ring, reopen to compute, then **shift-click slot 28** (`mode:1`).
Expected to cascade — crafting repeatedly while the bench auto-restocks the ring from storage —
the way one shift-click made 4 buttons from 4 stored planks. If confirmed, this converts all
surplus seeds to plant balls in a single action. See [[../observations/_log]] (2026-06-02).

## Known limitations (2026-06-01)

- **Bot-placed ingredients don't always trigger the output computation.** When the *user*
  hand-placed 3 planks across, the bench computed 6 slabs at slot 28; when the *bot* placed the
  same 3 planks (slots 3,4,5) via `clickWindow`, the output stayed empty (and jiggling a slot
  didn't help). A lone plank in slot 0 *did* compute a button from bot placement, so it's
  inconsistent — root cause not yet found (likely the generic `minecraft:container` window type
  meaning the bot's predicted grid placements don't always register server-side for the recipe
  calc). **Reliable workflow for now: ingredients pre-placed, bot takes the output.**
- **Inventory desync after modded-window ops.** `bot.inventory` (window 0) under/over-counts right
  after operating the bench window — saw 6 slabs read as 12, and 4 planks read as 2. The bench
  window itself (id 1) reads true; `bot.inventory` resyncs on reconnect. **A restart gives the
  true count.** Real item loss is also possible during heavy juggling (lost ~3 planks in testing).
- `bot.clickWindow` transactions DO confirm on the adopted bench window (no "didn't respond"
  errors there), unlike the flaky window-0 inventory crafting.

## Related
- [[../places/house]] — the bench replaced the old crafting table at (-270,65,569)
- [[bake-potatoes]] — the 2×2 inventory-grid crafting (always-open window 0; never needed the table)
- [[../observations/_log]]

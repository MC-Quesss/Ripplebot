---
type: procedure
name: nautilus_sweep_pattern
location: wheat_field
status: implemented
confirmed: true
first_tested: 2026-05-14
implemented_in_bot_js: 2026-05-14
companion_to: right_click_harvest
---

# Nautilus Sweep Pattern

A traversal pattern for the [[../places/wheat-field]] used as the walking shape during a right-click harvest. **Now implemented as `orderNautilusCCW(tiles)` in bot.js** (2026-05-14) and used by `runHarvestRightClick`. Earlier hand-driven runs proved the technique; the chat-triggered path now uses it automatically.

## Pattern

Walk the **outside ring first**, clockwise from the SE corner, then spiral inward — one block in each lap, like a nautilus shell.

```
→ → → → → → → → → →
↑                 ↓
↑   → → → → →    ↓
↑   ↑       ↓    ↓
↑   ↑   ●   ↓    ↓     ● = final center tile
↑   ↑       ↓    ↓
↑   ← ← ← ← ←    ↓
↑                 ↓
← ← ← ← ← ← ← ← ← ←
```

## Why this beats break-then-sweep

The old brute method (removed) did: break every wheat block, then sweep 8 explicit drop-pickup points — two full field traversals. The nautilus pattern collapses both into one walk: every drop the bot creates is within ~1.5 blocks of where the bot will be ~one tile later, so item pickup happens passively. The 5-minute drop window is comfortably covered.

## Bounds and start corner

For the [[../places/wheat-field]] (x=-287..-279, z=559..565):

- Field is **9 wide × 7 tall** = 63 cells (54 are farmland; some are pads/path).
- Start corner choice matters for direction. SE start (clockwise) means: west along south edge → north along west edge → east along north edge → south along east edge → step inward, repeat.

## First-test results (2026-05-14, south half, CCW from SE corner)

- 27 tiles attempted (26 mature, 1 immature corner from prior test).
- 26 mature → 26 wheat eventually accounted for.
- **+19 wheat went into inventory during the harvest pass; +7 wheat had to be picked up by a follow-up [[../places/wheat-field#sweep-points|8-point sweep]].**
- HP 20, deaths 0, no damage.

## Lesson

The pickup radius does NOT cover every tile the bot activates — when the bot is 2-3 blocks away from the target, the drops can land on dirt and stay there. Conclusion: **the nautilus walk minimizes traversal distance, but it does NOT eliminate the post-harvest sweep.** The sweep is shorter than under the dig-then-replant technique (fewer drops to collect, all clustered near where activations happened), but it remains mandatory.

## Future improvement

If the loop pathfinds to a stand-spot **adjacent (range=1)** to each target tile before activating — instead of activating from anywhere within reach — most drops should land in pickup radius. Worth testing in the next session: does range=1 stand-spot eliminate the sweep gap?

## Related
- [[right-click-harvest]] — the per-tile action
- [[../places/wheat-field#sweep-points|fixed sweep points]] — deprecated 8-sample method (history only)

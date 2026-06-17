---
type: procedure
name: pen_door_traversal
start: varies
end: pen_inside / pen_outside
confirmed: true
---

# Pen Door Traversal (enter / exit the sheep pen)

The sheep pen uses a **real wooden door** at (-278, 64, 574), not a fence gate —
bots couldn't reliably handle a gate. A **stone pressure plate** sits on the
*outside* pad at (-278, 64, 573), north of the door. There is deliberately **no
inside plate** (a plate inside would let sheep open the door themselves). The
opening is **1 block wide** (x = -278), flanked by solid `planks` at x = -277 and
x = -279.

Key coords:
- door (lower half): (-278, 64, 574); upper half (-278, 65, 574)
- outside pad + pressure plate: (-278, 64, 573)
- inside pad: (-278, 64, 575)
- **deep interior runway: (-278, 64, 577)** — z=578 is the south fence wall
- door open ⇔ metadata bit `0x04` set (lower-half closed = meta 1, open = meta 5)

## Why entry was easy and exit was hard

- **Entry** walks *south* from a runway at z=571. It crosses the **pressure
  plate at z=573 first**, which opens the door server-side, then passes through
  under momentum. Reliable.
- **Exit** walks *north* and hits the **door before** any plate, so it must open
  the door manually with `activate_block`. Two bugs made this fail:
  1. `activate_block` is async server-side — reading the door metadata
     immediately after returns **stale (closed) state**. The bot then walked
     into a still-closed door and stalled at z≈574.4. **Fix:** after activating,
     **settle ~450ms and re-verify** the open bit, retrying up to 4×. (Mirrors
     the house door's `sleep(500)` after activate.)
  2. Starting the north walk from the door-adjacent inside pad (z=575, 1 block
     out) let the bot **snag on the door frame from a standstill**. **Fix:**
     start the exit from the **deep runway at z=577**, giving a 3-block run to
     reach walking speed before the threshold (mirrors the entry runway).

## Sheep-safety rules

**Never toggle the door blindly.** Use idempotent open/close helpers that check
the `0x04` bit first. On any failed attempt, **ensure the door is closed** before
repositioning, and **re-open it** (don't assume it was left open) on the retry.

**Don't dwell on the outside pressure plate (-278, 64, 573).** It holds the door
open via redstone — lingering there lets sheep follow the bot out. A background
guard (`startPenPlateGuard`, 1s tick) kicks the bot north off the plate if it
sits there > 3s, then ensures the door is closed. The guard is suppressed while a
traversal is actively crossing (`penTraversalBusy`), so a normal in/out — which
clears the plate in well under a second — is never interrupted.

## Confirmed (2026-05-30)

After both fixes, exit clears to z≤571 on the **first attempt** with no retries
(verified across multiple enter→exit cycles, 0 deaths, no sheep escaped).

## Open issue

**Entry** still occasionally stalls north of the door (~z=573.75) — a separate,
pre-existing flakiness (possibly sheep crowding the plate/doorway). Exit is solid;
entry could use the same settle-verify + a snag-recovery pass next.

Yaw convention: [[../places/yaw-convention]] (yaw 0 = north / -z, π = south / +z).

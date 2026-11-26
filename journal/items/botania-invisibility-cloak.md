---
type: item
name: Botania Invisibility Cloak
mod: botania
bauble_slot: body
confirmed: true
source: Botania 1.12-final, ItemInvisibilityCloak.java
---

# Invisibility Cloak (Botania bauble)

A body-slot bauble. It is not its own invisibility system. Every tick on the server it pays **2 mana** from a mana item in the wearer's inventory (tablet, ring, …) and, if paid, applies the **vanilla Invisibility potion effect** (infinite duration, amplifier −42 as a marker, ambient, particles on). With no mana it does nothing; taking it off removes only its own effect (the −42 marker), not a real potion.

## What that means in play

- **Works on players and mobs alike.** It is the same effect as a potion of invisibility.
- **Players still see:** worn armor, held items, the name tag, and faint ambient potion swirls (the cloak turns particles on).
- **Mobs:** vanilla 1.12 scales a mob's detection range by 0.7 × the fraction of armor slots worn (floor 0.1). No armor: about 7% of the normal range. Each armor piece raises it.
- **"I can still see them"** usually means one of: no mana source in their pack (cloak inert), armor or a held item showing, or the name tag and swirls.

## Update 2026-11-26

A wearer stayed visible to other players; the cause was no charged mana tablet in the pack, so the cloak was inert. Retest with a charged tablet pending.

Related: [[observations/_log]]

## Charging the mana tablet (from Botania 1.12-final TilePool / ItemManaTablet source)

- Throw the tablet (as a dropped item) onto the mana pool; the pool only works on items lying on it.
- A pool **drains** mana out of items by default. Sneak + right-click it with a Wand of the Forest to toggle it to **charging** items.
- Rate: 1000 mana/tick, +1000 per Bellows linked beside the pool.
- Tablet capacity 500,000. Cloak cost 2 mana/tick (40/s) → a full tablet lasts about 12,500 s ≈ 3.5 hours of wear.

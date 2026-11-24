---
type: place
name: Practice strip
coords: (-294..-289, 63, 550..566)
confirmed: true
---

# Practice strip

Quesss built this on 2026-11-24 (day 59594) as a place to learn the [[library]]'s floors. It sits on the grass west of the [[wheat-field]], across from the [[coffee-field]]. The idea is to put a block Roz does not understand right beside one she does, and walk them side by side.

## Layout, read from the farmhouse (sensed, not yet seen), 2026-11-24

All blocks are at y 63. Read column by column with `block_at_abs`.

| x | what | notes |
|---|---|---|
| -294 | white wool (35:0) | west border, z 551–566 |
| -293 | marker column | stone at odd z, white wool at z 554, 558, 562 (every 4), grass between |
| -292 | **mud bricks, type 1079:0** | reference lane, z 551–565 (15). Roz already walks these at the [[bleu-de-paris]] |
| -291 | **concrete, type 2182:9** | test lane, z 551–565 (15) |
| -290 | marker column | same as x -293; **red wool (35:14) at z 556**, the first midpoint marker |
| -289 | white wool | east border |

Planks (5:1) close both ends of the two lanes, at z 550 and z 566.

## Open question: two concretes?

The strip's concrete reads **type 2182, meta 9**. The Library floor read **type 2203, meta 9** on 2026-11-23. Block ids come from the server's registry and do not change while it runs, so if both reads are right, these are two different blocks that share metadata 9. Asked Quesss. The item Quesss handed Roz reads 6680:9.

**Answer (Quesss, same day):** they are **different colours**. So for this modded concrete the colour is carried by the block *type*, and meta 9 is something else. That is the reverse of wool, where one type (35) carries the colour in its metadata. Lesson: a matching metadata number does not mean a matching block; compare the type first. Quesss: colour is the only difference. So 2182 should be as fast as 2203; the strip is where to check it.

## First walks — 2026-11-24 (day 59595, morning)

Seen with her own eyes: Roz walked both lanes, sampled every 0.15 s with a probe script (position + block under her feet).

1. **Mud bricks (x -291.9), south → north**, face yaw 0, `walk_until` z ≤ 550.6: 23 samples, **4.36 blocks/s, y flat at 64.00**. That matches vanilla walking (4.317), so the probe reads true on a known block.
2. **Concrete (x -290.2), north → south**, face yaw π, `walk_until` z ≥ 566.4: 23 samples, **4.24 blocks/s, y flat at 64.00**. No crawl, no bob, no damage.

What this means for the Library concrete is in [[library]] (Update 2026-11-24). 3. **Concrete again, south → north, with Quesss watching**: **4.29 blocks/s, y flat at 64.00.** Quesss saw her move smoothly, with no rubber-banding. So the inside numbers and the outside view agree.

Related: [[library]], [[mtac]].

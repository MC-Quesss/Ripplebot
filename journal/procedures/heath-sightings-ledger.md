---
type: procedure
name: heath-sightings-ledger
confirmed: true
ctl: heath
file: data/heath.json
---

# Heath: the sightings ledger

Heath is Roz's record of what she has **actually observed**. It stores facts, not memories. Each entry is a claim with a time on it:

| Field | Meaning |
|---|---|
| `subject` / `fact` | what, e.g. "the south field wheat: 54 of 54 tiles ripe" |
| `how` | `saw` = with her own eyes (outdoors within 16 blocks, or a chest she opened herself, indoors or out); `sensed` = live world data from afar (indoors, or too far to see) |
| `seenAtMs`, `day`, `tick` | when it was last confirmed |
| `valid` | still within its window? crops and containers last 10 min (one game day) |
| `sawAtMs` / `sawFact` | the last time she saw it herself, kept through sensed refreshes |

## Why it exists

On 2026-11-23, at launch, Roz said "the light is low on the wheat" while standing inside the house. It was the clock dressed up as scenery. Quesss pointed it out, then asked how an LLM could learn to observe before reporting. Roz's answer: grade the look, not the sentence; put the time it was seen on every fact; train in a world that changes while you are not looking. Heath is the smallest piece of that, built the same evening.

Prof. Paul Fortier's lens (the `/paul` skill) added the second column: a fact needs to say not only *when* it was seen but *how long it stays true*. A correct answer delivered too late is a wrong answer.

## Named for

**Heath Kirchart**, the skateboarder, not the actor. In 2011, at 33 and near the top of the sport, he filmed a farewell part for Emerica's *Stay Gold*. Then he asked his sponsors to stop making his pro shoe and board and to stop paying him. After that came bike touring, the Grand Canyon, El Capitan, and a homemade boat down Baja (Vice, 2017). He would not let an old truth keep being sold as a current one. The ledger works the same way: an entry past its window has to say so.

Two more threads from the same piece fit the ledger:
- **The vending machines.** He stocked what he liked but kept an eye on what actually sold, and loved filling the machines and seeing what sold. Watch what really happens rather than what you expected.
- **The pizza runs.** Part of the joy was getting inside old LA buildings and seeing what they looked like inside. That is curiosity as a reason to go look, which is the "go look" intent Heath still lacks.

## Where observations come from

- **Wheat fields** (north, south): the wheat-ready watcher scans every 5 s. Recorded per field, only when every tile is loaded.
- **Potato field**: whenever something scans it (sustain loop, food runs). Nothing scans it while idle in helm, so it can be absent. That is honest: absent means "I do not know."
- **Coffee bushes**: the coffee auto-check, only when all 12 spots are loaded.
- **Containers**: every chest, furnace or hopper opened through `withContainer()`. Contents are recorded as the window closes, after any deposit or withdraw.

A scan with unloaded chunks is **skipped, not recorded as a partial count**, so the old entry ages out instead.

## How the voice uses it

`buildExpressiveContext` adds `describeHeath()` (each line with how it is known and its age, STALE past its window) plus rules: state conditions only from Heath or from what is in front of her; describe how something *looks* only if she saw it herself in the last few minutes; give sensed facts plainly. Indoors, it also says she cannot see outside.

**Helm operator:** run `./bot-ctl '{"action":"heath"}'` before saying anything about the state or look of a field or chest. See [[../observations/_log|session log]].

## Verified 2026-11-23 (day 59527)

- Sensed from indoors: both wheat fields 54/54 ripe (matches what Roz counted in person at dawn), coffee 2/12 then 3/12 ripe as a bush ripened live.
- Kitchen chest opened from inside the house: recorded as `saw`.
- The debounced save wrote `data/heath.json` (gitignored, per bot).
- Save on exit: a clean `quit` wrote `data/heath.json` (4 entries) at disconnect, 2026-11-24 04:29Z.
- **Not yet verified:** reloading on restart. Check for a `[heath] loaded N entries` line at the next launch. A SIGTERM kill skips the exit write (up to 60 s of freshness lost, harmless).

## Not built yet

- A **"go look"** intent: when asked about a stale thing in daylight, walk out and observe before answering.
- Bee houses, animals and the hopper's state beyond its slots are not in Heath.

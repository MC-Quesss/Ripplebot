---
type: procedure
name: rps-with-a-player
trigger: chat
confirmed: false
added: 2026-07-13
reviewed: 2026-07-27
---

# Rock-Paper-Scissors vs. a Human

Roz plays a player directly, best two of three. Distinct from the bot-vs-bot
[[keep-the-fire-going|fire-duty RPS]] and from fun bot-vs-bot RPS: **none of the
machine-code protocol applies** — no dot-codes, no meet spot, no synchronized
reveal tick. The ceremony runs on human time, wherever the bot is standing.

`confirmed: false` — implemented 2026-07-13, code-reviewed 2026-07-27, **not yet
played live**.

## Triggering

| Speaker says | Goes to |
|---|---|
| "play rock-paper-scissors **with me**" / "**against** me" / "vs us" | `startHumanRps` — the player is the rival |
| "play a game" / "play rock paper scissors" | `startFunRps` — two bots play, speaker watches |

Two routes reach it: the `play_rps` reflex rule (which inspects the message text
for `with|against|vs me/us`) and the LLM router intent `play_rps_human`.

## The round

1. Bot **commits its throw first**, before the player throws — but does not say it.
2. `*salute*`, "Rock, paper, scissors — round N!", 3s pause.
3. `*point*`, "Shoot!" — the capture listener arms **here**.
4. Player types `rock`, `paper`, or `scissors` in plain chat (no nickname needed).
5. Only then does the bot reveal: `/me shoots <throw>`.
6. First to 2 wins; ties replay; hard stop at 10 rounds → draw.

**Why commit-then-reveal:** user call, 2026-07-13 — a bot that reveals first lets
the player counter-pick. The bot must hold its throw until the player has called.

Timeouts: 30s per round, with a "Type rock, paper, or scissors!" nudge at 15s. No
throw → the bot says what it had been holding and ends the match politely.
Player says `stop`/`quit`/`nevermind`/`cancel`/`enough`/`no more`/`I'm done` →
match ends, good game.

## Refusals

- Bedtime → "a game in the morning?"
- Already mid-match (`rpsFunBusy`, `rpsState`, `rpsHumanState`, `rpsCurrentRival`)
- On fire duty without potato role → asks to be stood down first
- No other bot around **and** the player didn't say "with me" → bot offers to play
  them instead

## Chat capture — how game moves stay out of conversation

While a round waits, the rival player's lines are consumed in the `chat` handler
**before** the reflex tier and the LLM router, so "rock" never reaches Claude as
conversation. The listener is armed only during a waiting round and only for that
one player — everyone else's chatter routes normally.

## Known issues (review 2026-07-27, unfixed)

- **`stop` is swallowed as a game-quit before the safety reflex tier.** The
  capture block `return`s, so a player saying "Roz, stop" mid-round ends the match
  but does **not** fire the real `stop` handler. Matters when something else is
  running alongside — an active follow, or fire duty with the potato role (the one
  case where RPS and sustain coexist). "stand down" is not in the quit list and
  falls through correctly.
- **Eager throws are lost.** The listener arms at "Shoot!", but ~5.5s of preamble
  precedes it. A player typing "rock" early gets no capture, and the line is routed
  to Claude as ordinary conversation. The 15s nudge covers recovery.
- Any use of the words rock/paper/scissors by the rival during a live round counts
  as a throw, in or out of context. Narrow window; acceptable.
- **The celebration lines have never worked.** Win/lose reactions call
  `impulseExpressive`, which routes through the Claude voice path that was dead
  from 2026-07-12 until fixed on 2026-07-27 (see
  [[claude-brain-mode]]). Every match so far could only ever have produced the
  canned fallbacks "Ha! I win!" / "Good game! You got me." Worth replaying now.

Verified present and correct during review: `RPS_WORD_TO_CODE`, `rpsWinner`,
`facePlayer`, and all emotes used (`wave`, `salute`, `point`, `headbang`, `weep`,
`clap`, `yes`, `shrug`) against the [[emotes|valid emote list]]. The reflex
handler really does receive the message text as its second argument.

## Related

- [[emotes]] · [[keep-the-fire-going]] · [[claude-brain-mode]] ·
  [[../observations/_log]]

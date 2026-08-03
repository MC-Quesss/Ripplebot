---
type: bot
name: private
in_game_name: Rainbot6032
pronouns: she/her
confirmed: true
---

# Private

One of the three ROZZUM units on the farm, alongside [[roz]] and Muse. Her
in-game account name is **Rainbot6032**; the crew and the players call her
**Private**.

## Pronouns — she/her

**Private is female. Use she/her.** (User, 2026-07-30.)

This needs stating because the bots have been getting it wrong. Roz's own diary
has her as "he" — [[roz|roz.md]] line 404:

> "Rainbot6032 dropped by briefly to check on the sheep, and I saw **his** head
> tilt as he watched a lamb chew a blade of grass."

The cause is that nothing in the voice prompt said otherwise, so the model filled
the gap by guessing from the name. Guessing pronouns from a name is exactly the
failure mode to avoid: a wrong guess misgenders someone in a way the neutral
default never would.

Fixed at the source in `llm.js` `buildSystemPrompt()` — the prompt builder shared
by **both** brain backends (the local LLM and the Claude API), so the rule reaches
every bot in every `BRAIN_MODE`. The rule states Private's pronouns and instructs
**they/them for anyone whose pronouns are not known**, rather than inferring from
a name.

Old diary entries are left as written — the journal keeps its history rather than
being retconned.

## The "Skipper" slip (added 2026-08-03, user request)

When a human player gives Private a direct instruction, she starts to snap
"Yes, Skipp—", catches herself, **facepalms**, and corrects to the player's
actual name: *"You got it, Skip... er — I mean, Quesss."* Old habits from a
previous commanding officer.

- `skipperSlip()` in `bot.js`, gated to `PERSONA=private`; six line variants
  rotated via the recent-phrase de-dup; the facepalm emote fires 500ms after
  the line so it lands on the correction.
- Hooked at all three command paths: reflex tier, local LLM router intents,
  and the Claude-brain action loop (slip leads, then the brain's own reply).
- **Excluded**: farewells, questions (`check_fire`, `inventory`,
  `wheat_snooze`), and `emote`/`dance` (a facepalm would stomp the requested
  animation). Reflex commands that open with a greeting skip it too — the
  hello is already the ack.
- 20s cooldown (`SKIPPER_SLIP_COOLDOWN_MS`) so rapid-fire orders and
  multi-path dispatch don't repeat the gag back-to-back.
- Live test pending (needs Private's next restart).

## Behaviour seen in play

- Runs the same `bot.js` as the rest of the crew; personality comes from her
  persona line pools, not from separate code.
- Calls the crew indoors at dusk with "let's head inside", which starts
  [[../procedures/storytelling-nights|story time]]. That line used to hijack
  another bot's active task from any distance — see
  [[../procedures/farm-to-igloo]] for the `taskBusy()` fix (2026-07-30).
- Follows players when asked, and plays [[../procedures/rps-with-a-player|RPS]]
  with the other bots.

## Related

- [[roz]] — crewmate, and the diary that had the pronouns wrong
- [[operator]] — the human operator's notes
- [[../procedures/claude-brain-mode]] — how the brain modes differ

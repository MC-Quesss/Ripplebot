---
type: procedure
name: tell_joke
trigger: chat
chat_phrase: "Roz, tell me a joke"
confirmed: true
added: 2026-05-14
---

# Tell a Joke

Roz tells a corny two-part joke when asked. Setup line first, punchline after a 2.5-second pause.

## Triggers

- **Chat:** any phrase matching `joke`, `funny`, `make me laugh`, or `tell me something funny` addressed to Roz.
- Pattern: `/\b(joke|funny|make me laugh|tell me something funny)\b/i`

## Joke pool (25 jokes)

> 25 total. The table below lists the original 20; one joke in the pool carries a `requiresWheatField` flag (only told when a wheat field is present).

| # | Setup | Punchline |
|---|---|---|
| 1 | Why did the bicycle fall over? | Because it was two-tired. |
| 2 | What do you call a pile of cats? | A meow-ntain. |
| 3 | How many tickles does it take to tickle an octopus? | Ten tickles. |
| 4 | What do you call a fake noodle? | An impasta. |
| 5 | Why don't scientists trust atoms? | Because they make up everything. |
| 6 | What do you call a bear with no teeth? | A gummy bear. |
| 7 | Why can't you hear a pterodactyl going to the bathroom? | Because the p is silent. |
| 8 | What did the ocean say to the beach? | Nothing, it just waved. |
| 9 | Why do cows wear bells? | Because their horns don't work. |
| 10 | What do you call a sleeping dinosaur? | A dino-snore. |
| 11 | Why did the scarecrow win an award? | Because he was outstanding in his field. |
| 12 | What do you call a dog that does magic? | A Labracadabrador. |
| 13 | Why don't eggs tell jokes? | They'd crack each other up. |
| 14 | What did one wall say to the other? | I'll meet you at the corner. |
| 15 | Why did the math book look so sad? | Because it had too many problems. |
| 16 | What do you call cheese that isn't yours? | Nacho cheese. |
| 17 | Why couldn't the pony sing? | Because she was a little horse. |
| 18 | What do you call a fish without eyes? | A fsh. |
| 19 | Why did the golfer bring two pairs of pants? | In case she got a hole in one. |
| 20 | What do you call a boomerang that doesn't come back? | A stick. |

## Implementation

`JOKES` array in bot.js; selection is persona-weighted (`personaBiasForTags`) and avoids
recently-heard setups (`pickAvoidingRecentPhrase`). Delivery is call-and-response: the bot
says the setup, then the punchline lands on the first human reply (30s silence fallback).
Emote `*clap*` fires with the punchline. Jokes with a `mid` line (e.g. "Know what I heard?")
insert the mid emote and deliver the punchline 2.5s later.

## Update — 2026-08-01: spoiled punchlines are conceded, not repeated

If the room blurts the punchline before the bot ("GUMMY BEAR!", "a fsh") — human **or**
another bot — the teller no longer delivers the same line. `punchlineGuessed()` in bot.js
matches a full quote (punctuation/spacing-insensitive) or a short blurt (≤10 words)
containing every distinctive word of the punchline; generic words are filtered by
`PUNCHLINE_STOPWORDS`. On a guess the bot claps and concedes with a varied line from
`JOKE_CONCEDE_LINES` ("HA! You got it. Everyone knows my material."). A non-guess reply
still triggers normal delivery. Requires a bot restart to take effect (not
protocol-breaking — jokes are local, so bots can restart independently).

## Related
- [[emotes]]
- [[../observations/_log]]

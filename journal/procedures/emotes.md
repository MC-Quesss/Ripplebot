---
type: procedure
name: emotes
trigger: chat
confirmed: true
added: 2026-05-14
requires: quark_mod
---

# Emotes (Quark)

Roz can perform visible player animations via the Quark mod's emote system. Emotes are triggered by sending a `custom_payload` packet on channel `autoreglib` with discriminator `0x10` (16) followed by a varint-length-prefixed UTF-8 emote name string. The `bot-ctl` command is `{"action":"emote","args":{"name":"wave"}}`.

## Available emotes

| Emote | Chat command |
|---|---|
| Wave | `*wave*` |
| Nod | `*yes*` |
| Head shake | `*no*` |
| Clap | `*clap*` |
| Cheer | `*cheer*` |
| Point | `*point*` |
| Salute | `*salute*` |
| Shrug | `*shrug*` |
| Headbang | `*headbang*` |
| Weep | `*weep*` |
| Facepalm | `*facepalm*` |
| Think | `*think*` |

> No distinct **Bow** emote: the canonical whitelist has 12 entries and no bow. The chat handler aliases the word "bow" to **salute** (no distinct bow animation).

## Chat trigger

"Roz, wave" / "Roz, bow" / etc. — pattern matches any emote name and sends the corresponding `*emote*` chat command. Handler registered before the joke and greeting handlers.

## Paired emotes (fire alongside other actions)

| Situation | Emote | Timing |
|---|---|---|
| Auto-greet (player walks near) | `*salute*` | Simultaneous with greeting text |
| Greeting reply ("Roz, hi") | random of `*cheer*` / `*wave*` / `*clap*` (a named greeting command sends `*wave*`) | Simultaneous with greeting text |
| Go outside | `*cheer*` | Simultaneous with exit start |
| Joke punchline | `*clap*` | Fires with punchline after 2.5s pause |

## Confirmation status

`confirmed: true` — Emotes work via `custom_payload` on channel `autoreglib` with discriminator `0x10` (16) + varint-length-prefixed emote name. `bot.chat('*wave*')` does NOT work (just renders italic text). The correct approach is the raw packet. Verified 2026-05-14 with wave emote.

## Related
- [[tell-joke]]
- [[enter-house]]
- [[exit-house]]
- [[../observations/_log]]

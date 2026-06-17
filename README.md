# Ripplebot

Mineflayer-based Minecraft bot for a modded 1.12.2 Forge server. Connects via Microsoft auth, exposes a TCP control API on `127.0.0.1:25580`, and runs autonomous behaviors (auto-sleep, auto-greet, auto-harvest, jokes, vaporize hostile mobs).

## Setup

```bash
git clone git@github.com:MC-Quesss/Ripplebot.git
cd Ripplebot
npm install
```

Create a `.env` file (see `.env.example` for the required keys).

## Run

```bash
node bot.js
```

First launch will prompt for Microsoft device-code auth. After that, credentials are cached in `~/.minecraft/nmp-cache/`.

## Control

Send commands via the TCP socket:

```bash
./bot-ctl '{"action":"pos"}'
```

require('dotenv').config()
const fs = require('fs')
const net = require('net')
const path = require('path')
const readline = require('readline')
const mineflayer = require('mineflayer')
const mc = require('minecraft-protocol')
const { forgeHandshake } = require('minecraft-protocol-forge')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3').Vec3
const { loader: autoEat } = require('mineflayer-auto-eat')
const llm = require('./llm')

if (!process.env.MC_HOST) { console.error('[error] MC_HOST not set in .env'); process.exit(1) }
if (!process.env.MC_USERNAME) { console.error('[error] MC_USERNAME not set in .env'); process.exit(1) }

const host = process.env.MC_HOST
const port = parseInt(process.env.MC_PORT || '25565', 10)
const auth = process.env.MC_AUTH || 'offline'
const version = process.env.MC_VERSION || '1.12.2'
const useForge = process.env.MC_FORGE === 'true'
const ctrlPort = parseInt(process.env.BOT_CTRL_PORT || '25580', 10)
const logPath = path.join(__dirname, 'bot.log')

const logStream = fs.createWriteStream(logPath, { flags: 'a' })
function logEvent (kind, msg) {
  const line = `${new Date().toISOString()} [${kind}] ${msg}\n`
  process.stdout.write(line)
  logStream.write(line)
}

let forgeMods = []
if (useForge) {
  const modsPath = path.join(__dirname, 'data', 'mods.json')
  if (!fs.existsSync(modsPath)) {
    console.error(`[error] ${modsPath} not found. Run 'node ping.js' first.`)
    process.exit(1)
  }
  forgeMods = JSON.parse(fs.readFileSync(modsPath, 'utf8'))
  logEvent('forge', `loaded ${forgeMods.length} mods from mods.json`)
}

// --- Error resilience for modded 1.12.2 Forge servers ---
// 1. Suppress harmless zlib "problem inflating" warnings from minecraft-protocol's
//    decompression layer. These are cosmetic — not crashes — but noisy.
const origError = console.error
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('problem inflating')) return
  origError.apply(console, args)
}
// 2. Safety nets for anything that slips past the FullPacketParser patch below
//    (e.g. async rejects in plugin code, modded packets on other code paths).
process.on('uncaughtException', (err) => {
  logEvent('uncaught', err.message)
})
process.on('unhandledRejection', (err) => {
  logEvent('unhandled-reject', err?.message || String(err))
})

logEvent('connect', `${host}:${port} auth=${auth} version=${version} forge=${useForge}`)

const clientOpts = {
  host,
  port,
  username: process.env.MC_USERNAME,
  auth,
  version,
  hideErrors: true,
  onMsaCode: (data) => {
    logEvent('msa', `Visit ${data.verification_uri} and enter code: ${data.user_code}`)
  },
}

const client = mc.createClient(clientOpts)
if (useForge) forgeHandshake(client, { forgeMods })

// 3. THE REAL FIX: On modded 1.12.2, entity_metadata packets contain data that
//    mineflayer's entities plugin can't handle (throws TypeError). The error
//    propagates back through push() into _transform and destroys the deserializer
//    stream in Node 18+. Wrapping _transform catches errors from both protodef
//    parsing AND downstream listeners triggered by push().
const { FullPacketParser } = require('protodef/src/serializer')
const _origTransform = FullPacketParser.prototype._transform
FullPacketParser.prototype._transform = function (chunk, enc, cb) {
  try {
    _origTransform.call(this, chunk, enc, cb)
  } catch (e) {
    cb()
  }
}

// Track real position from raw protocol packets — mineflayer's state gets stuck
// on heavily-modded 1.12.2 servers, so we shadow it here.
const rawState = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, onGround: true, spawned: false }

client.on('position', (packet) => {
  rawState.x = packet.x
  rawState.y = packet.y
  rawState.z = packet.z
  rawState.yaw = packet.yaw * Math.PI / 180
  rawState.pitch = packet.pitch * Math.PI / 180
  if (!rawState.spawned) {
    rawState.spawned = true
    logEvent('rawspawn', `${packet.x.toFixed(1)}, ${packet.y.toFixed(1)}, ${packet.z.toFixed(1)}`)
  }
  // 1.12.2 requires teleport_confirm; mineflayer handles this itself, so don't double-send.
})
// Let mineflayer handle keep_alive — it already does.
// Let mineflayer handle periodic position updates via bot.physics — don't duplicate.

// Diagnostic: raw clientbound open_window / close_window. mineflayer's high-level
// `windowOpen` event does NOT fire for some modded GUIs (the crafting table among
// them — see journal/observations). Tapping the raw packet reveals the server's
// window id and type so the grid can be driven via raw window_click if mineflayer
// won't surface it as bot.currentWindow.
let lastRawWindow = null
const realOpenWindowIds = new Set()
client.on('open_window', (packet) => {
  lastRawWindow = packet
  realOpenWindowIds.add(packet.windowId)
  try { logEvent('open_window', JSON.stringify(packet)) } catch (_) { logEvent('open_window', 'unserializable open_window packet') }
})
client.on('close_window', (packet) => {
  logEvent('close_window', `id=${packet && packet.windowId}`)
})
// Forge mod GUIs (e.g. the ProjectRed Project Bench) open via an FML network
// packet, not the vanilla open_window mineflayer listens for — so mineflayer
// never creates a window object and bot.currentWindow stays null, even though
// the server HAS opened a real container for us (it sends window_items for the
// new windowId, which mineflayer stashes while it waits for an open_window that
// never arrives). We adopt that orphaned window by synthesizing the open_window
// mineflayer expects; it then populates from the stashed window_items and fires
// windowOpen. Vanilla containers (chest/furnace/hopper) get a real open_window,
// so we skip those — tracked via realOpenWindowIds to avoid phantom windows when
// a vanilla container opens and closes before setImmediate fires.
client.on('window_items', (packet) => {
  if (!packet || !packet.windowId) return
  const wid = packet.windowId
  const containerSlots = packet.items.length - 36
  if (containerSlots <= 0) return
  // Defer one tick so mineflayer's own window_items handler stashes the packet
  // first; then our synthetic open_window triggers immediate population.
  setImmediate(() => {
    if (realOpenWindowIds.has(wid)) return // vanilla container — real open_window handled it
    if (bot.currentWindow && bot.currentWindow.id === wid) return
    client.emit('open_window', {
      windowId: wid,
      inventoryType: 'minecraft:container',
      windowTitle: '{"text":"Modded GUI"}',
      slotCount: containerSlots
    })
    logEvent('modded-gui', `adopted Forge window id=${wid} containerSlots=${containerSlots}`)
  })
})

const bot = mineflayer.createBot({ ...clientOpts, client })
bot.loadPlugin(pathfinder)
bot.loadPlugin(autoEat)

// Patch: mineflayer-auto-eat leaks entity_status + updateSlot listeners on eat
// timeout — the setTimeout rejects the promise but never removes the listeners.
// Over many sustain cycles this triggers MaxListenersExceededWarning.
if (bot.autoEat) {
  const origBuild = bot.autoEat.buildEatingListener.bind(bot.autoEat)
  bot.autoEat.buildEatingListener = function (relevantItem, timeout) {
    return new Promise((res, rej) => {
      const eatingListener = (packet) => {
        if (packet.entityId === bot.entity.id && packet.entityStatus === 9) {
          clearTimeout(timer)
          bot._client.off('entity_status', eatingListener)
          bot.inventory.off('updateSlot', itemListener)
          res()
        }
      }
      const itemListener = (slot, oldItem, newItem) => {
        if (oldItem?.slot === relevantItem.slot && newItem?.type !== relevantItem.type) {
          clearTimeout(timer)
          bot._client.off('entity_status', eatingListener)
          bot.inventory.off('updateSlot', itemListener)
          rej(new Error(`Item switched early to: ${newItem?.name}!\nItem: ${newItem}`))
        }
      }
      bot._client.on('entity_status', eatingListener)
      bot.inventory.on('updateSlot', itemListener)
      this._rejectionBinding = (error) => {
        clearTimeout(timer)
        bot._client.off('entity_status', eatingListener)
        bot.inventory.off('updateSlot', itemListener)
        rej(error)
      }
      const timer = setTimeout(() => {
        bot._client.off('entity_status', eatingListener)
        bot.inventory.off('updateSlot', itemListener)
        rej(new Error(`Eating timed out with a time of ${timeout} milliseconds!`))
      }, timeout)
    })
  }
}

// Cross-bot phrase de-duplication. Each bot remembers exact-ish lines it hears
// in chat, then avoids picking that same phrase as its immediate next random
// line. Because every bot hears the shared chat, this suppresses echo-chamber
// repeats without any external coordination service.
const RECENT_CHAT_PHRASE_TTL_MS = 5 * 60 * 1000
const recentChatPhrases = new Map() // normalized phrase -> last seen timestamp
function normalizeChatPhrase (text) {
  return String(text || '')
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/^\s*<[^>]+>\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}
function pruneRecentChatPhrases () {
  const cutoff = Date.now() - RECENT_CHAT_PHRASE_TTL_MS
  for (const [phrase, ts] of recentChatPhrases) {
    if (ts < cutoff) recentChatPhrases.delete(phrase)
  }
}
function rememberChatPhrase (text) {
  const phrase = normalizeChatPhrase(text)
  if (!phrase || phrase.length < 4) return
  pruneRecentChatPhrases()
  recentChatPhrases.set(phrase, Date.now())
}
function wasPhraseRecentlyHeard (text) {
  pruneRecentChatPhrases()
  return recentChatPhrases.has(normalizeChatPhrase(text))
}
function pickAvoidingRecentPhrase (items, toPhrase = x => x) {
  const cleanItems = Array.isArray(items) ? items.filter(Boolean) : []
  if (!cleanItems.length) return undefined
  const available = cleanItems.filter(item => !wasPhraseRecentlyHeard(toPhrase(item)))
  const pool = available.length ? available : cleanItems
  const picked = pool[Math.floor(Math.random() * pool.length)]
  if (!picked) return undefined
  rememberChatPhrase(toPhrase(picked))
  return picked
}
bot.once('spawn', () => {
  const mcData = require('minecraft-data')(bot.version)
  const mvts = new Movements(bot, mcData)
  mvts.canDig = false // don't let the bot dig through modded blocks it can't identify
  mvts.allow1by1towers = false
  mvts.allowParkour = false
  mvts.scafoldingBlocks = [] // don't let pathfinder place blocks to bridge/tower
  mvts.canOpenDoors = true // let pathfinder open/cross doors
  // Make sure spruce door is in the openable set
  const doorIds = Object.values(mcData.blocksByName).filter(b => /door/.test(b.name) && !/iron/.test(b.name)).map(b => b.id)
  doorIds.forEach(id => mvts.openable.add(id))

  // Avoid the unsafe modded blocks on the east side of the house. These report
  // with empty names on this Forge 1.12.2 server. The charging pad is believed
  // to be (-265, 65, 574), with adjacent empty-name modded blocks at z=572/573.
  // Pathfinder exclusion adds a large step cost so routes prefer the normal
  // floor tiles instead of stepping onto the pad/wall-adjacent machinery.
  const PATHFINDER_AVOID_BLOCKS = new Set([
    '-265,65,572',
    '-265,65,573',
    '-265,65,574',
  ])
  function avoidBlockKey (pos) {
    return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`
  }
  mvts.exclusionAreasStep.push((block) => {
    if (!block || !block.position) return 0
    return PATHFINDER_AVOID_BLOCKS.has(avoidBlockKey(block.position)) ? 100 : 0
  })

  bot.pathfinder.setMovements(mvts)

  // Permanently zero out collision for the modded block at (-271, 65, 572) —
  // it sits in the door corridor and has unknown geometry that blocks both
  // pathfinder route planning and physics-based walking.
  const _origGetBlock = bot.world.getBlock.bind(bot.world)
  bot.world.getBlock = (pos) => {
    const b = _origGetBlock(pos)
    if (b && Math.floor(pos.x) === -271 && Math.floor(pos.z) === 572 &&
        pos.y >= 65 && pos.y <= 66) {
      b.shapes = []
    }
    // Lily-pad-covered water: make the water block appear solid so the
    // pathfinder treats it as walkable ground (lily pads are thin enough
    // to be classified as carpet/empty, leaving water exposed).
    if (b && b.name === 'water') {
      const above = _origGetBlock(pos.offset(0, 1, 0))
      if (above && above.name === 'waterlily') {
        b.boundingBox = 'block'
        b.shapes = [[0, 0, 0, 1, 1, 1]]
      }
    }
    return b
  }

  bot.on('physicsTick', () => {
    if (!bot.entity || !bot.controlState.jump) return
    const below = bot.blockAt(bot.entity.position.offset(0, -0.5, 0))
    if (below && below.name === 'farmland') bot.setControlState('jump', false)
  })

  logEvent('pathfinder', 'ready')
  // Auto-eat config: eat whenever not full, prefer saturation-richest food
  if (bot.autoEat) {
    bot.autoEat.setOpts({
      priority: 'saturation',
      minHunger: 20,
      bannedFood: [],
    })
    bot.autoEat.enableAuto()
    bot.on('autoeat_started', (item) => logEvent('auto-eat', `eating ${item?.name ?? 'food'}`))
    bot.on('autoeat_finished', () => { logEvent('auto-eat', 'done'); bot.unequip('hand').catch(() => {}) })
    logEvent('auto-eat', 'enabled (start at food<=14)')
  }
  if (NICKNAME) {
    bot.chat(`/nick ${NICKNAME}`)
    logEvent('nick', `set nickname to ${NICKNAME}`)
  }
  startAutoSleep()
  startPenPlateGuard()
  startWheatReadyWatcher()
  startIdleWanderTimer()
  startAmbientActionTimer()
  startSquirrelWatcher()
})

// Auto-sleep: if it's bedtime and bot is inside the house, walk to bed and sleep.
// Controlled by autoSleepEnabled (on by default). Disable via {"action":"auto_sleep","args":{"enabled":false}}.
let autoSleepEnabled = true
let autoSleepBusy = false
const BED_POS = { x: -268, y: 65, z: 569 }
const BED_APPROACH = { x: -268, y: 65, z: 570 }
// Backup bed — to Roz's left when approaching from z=570 facing north.
// Used when the primary bed is occupied by another player.
const BED_POS_LEFT = { x: -269, y: 65, z: 569 }
const BED_APPROACH_LEFT = { x: -269, y: 65, z: 570 }
// Third bed — to Roz's right (next to the kitchen chest). Third sleep choice,
// used when both the primary and left beds are occupied. Added 2026-05-30.
const BED_POS_RIGHT = { x: -267, y: 65, z: 569 }
const BED_APPROACH_RIGHT = { x: -267, y: 65, z: 570 }
// In the house if x in [-271, -264] and z in [568, 575] at y=65 — rough bounding box.
function insideHouse () {
  const p = bot.entity?.position
  if (!p) return false
  return p.x >= -271 && p.x <= -264 && p.z >= 568 && p.z <= 575 && p.y >= 64 && p.y <= 66
}
function inPen () {
  const p = bot.entity?.position
  if (!p) return false
  return p.x >= -282 && p.x <= -274 && p.z >= 575 && p.z <= 578 && p.y >= 63 && p.y <= 65
}
async function ensureInsideHouse () {
  if (inPen()) await runGoOutOfPen()
  if (!insideHouse()) await runGoInside()
  if (!insideHouse()) throw new Error('failed to get inside house')
}
function isBedtime () {
  const t = bot.time?.timeOfDay
  return typeof t === 'number' && t >= 12500 && t <= 23500
}
async function tryAutoSleep () {
  if (!autoSleepEnabled || autoSleepBusy) return
  if (bot.isSleeping) return
  if (!isBedtime()) return
  if (followTarget) {
    impulseExpressive('bedtime_suggest',
      `Night is falling and you are still out, following ${followTarget}. Gently suggest heading somewhere safe for the night.`
    ).catch(() => {})
    return
  }
  if (goInsideBusy || taskBusy() || penTraversalBusy) return
  if (!insideHouse()) {
    logEvent('auto-sleep', 'bedtime but outside — heading in first')
    try { await runGoInside() } catch (e) {
      logEvent('auto-sleep', `couldn't get inside: ${e.message}`)
      return
    }
    if (!insideHouse()) return
  }
  autoSleepBusy = true
  try {
    logEvent('auto-sleep', 'bedtime detected, heading to bed')
    const BEDS = [
      { label: 'primary', pos: BED_POS, approach: BED_APPROACH },
      { label: 'left', pos: BED_POS_LEFT, approach: BED_APPROACH_LEFT },
      { label: 'right', pos: BED_POS_RIGHT, approach: BED_APPROACH_RIGHT },
    ]
    for (const b of BEDS) {
      if (bot.isSleeping) break
      bot.pathfinder.setGoal(new goals.GoalNear(b.approach.x, b.approach.y, b.approach.z, 1))
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500))
        if (!bot.pathfinder.isMoving()) break
      }
      const bed = bot.blockAt(new Vec3(b.pos.x, b.pos.y, b.pos.z))
      if (!bed) continue
      try {
        await bot.activateBlock(bed)
      } catch (e) {
        logEvent('auto-sleep', `${b.label} bed activate failed: ${e.message}`)
        continue
      }
      // Give the server ~1s to report `isSleeping` so we know whether the
      // activate actually put the bot in bed or silently failed (e.g. occupied).
      await new Promise(r => setTimeout(r, 1000))
      if (bot.isSleeping) {
        logEvent('auto-sleep', `in ${b.label} bed`)
        break
      }
      logEvent('auto-sleep', `${b.label} bed not entered — trying next`)
    }
  } catch (e) {
    logEvent('auto-sleep', `error: ${e.message}`)
  } finally {
    autoSleepBusy = false
  }
}
function startAutoSleep () {
  setInterval(() => {
    if (!bot.world) return
    tryAutoGreet()
    tryAutoSleep()
    tryFoodSafety()
    tryCollectBake()
    tryRestockSupplies()
    tryMorningPlantBalls()
  }, 5000)
}

// Auto-greet: say a greeting when another player comes within range.
// Two cooldowns: per-player (don't re-greet the same person all day) and
// global (don't say the same line twice in quick succession when multiple
// players are nearby at the same time).
let autoGreetEnabled = true
// Greeting pools live in the persona spec (functional.greet); a line is picked
// with pickLine so the same bot varies its hello.
const DEFAULT_GREET_LINES = ['Hello there!']
function getGreetText () {
  return pickLine(personaPool('greet', DEFAULT_GREET_LINES))
}
const GREET_RADIUS = 8 // blocks
const GREET_GLOBAL_COOLDOWN_MS = 60 * 1000 // don't say the greeting twice within this window
const greetHistory = new Map() // username → last greet timestamp
let lastGreetAt = 0
function tryAutoGreet () {
  if (!autoGreetEnabled) return
  if (!bot.entity) return
  if (goInsideBusy) return
  const me = bot.entity.position
  const now = Date.now()
  if (now - lastGreetAt < GREET_GLOBAL_COOLDOWN_MS) {
    // Still mark anyone in range as recently-seen so they don't get the
    // greeting the moment the global cooldown lifts.
    for (const [name, ent] of Object.entries(bot.players)) {
      if (name === bot.username || !ent.entity) continue
      if (ent.entity.position.distanceTo(me) > GREET_RADIUS) continue
      if (!greetHistory.has(name)) greetHistory.set(name, now)
    }
    return
  }
  for (const [name, ent] of Object.entries(bot.players)) {
    if (name === bot.username) continue
    if (!ent.entity) continue
    const d = ent.entity.position.distanceTo(me)
    if (d > GREET_RADIUS) continue
    if (greetHistory.has(name)) continue
    greetHistory.set(name, now)
    lastGreetAt = now
    facePlayer(name).then(() => {
      sendEmote('salute')
      bot.chat(getGreetText())
    })
    logEvent('greet', `${name} (d=${d.toFixed(1)})`)
    // Also mark everyone else currently in range as greeted, since the
    // single line covers the whole room.
    for (const [otherName, otherEnt] of Object.entries(bot.players)) {
      if (otherName === bot.username || otherName === name || !otherEnt.entity) continue
      if (otherEnt.entity.position.distanceTo(me) <= GREET_RADIUS) {
        greetHistory.set(otherName, now)
      }
    }
    break // one greet per tick
  }
}

bot.on('login', () => logEvent('login', `${bot.username} logged in`))
bot.on('spawn', () => {
  const p = bot.entity.position
  logEvent('spawn', `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`)
  bot.unequip('hand').catch(() => {})
})

// ── Tier-2: chat-command dispatcher ───────────────────────────────────────
// Handlers are tried in order. First match wins and suppresses the
// mentions.log fallback. Each returns true if it handled the message,
// false/undefined to let later handlers try.
let NICKNAME = process.env.MC_NICKNAME || null // resolved after login if not set
let followTarget = null // username currently being followed, or null
let followEntity = null // actual entity being trailed (player or bot ahead in chain)
let followChainPos = 0  // 0 = not following, 1 = following player directly, 2+ = following a bot
let lastChainEval = 0   // timestamp of last chain re-evaluation

// ── Persona ──────────────────────────────────────────────────────────────────
// Who this bot IS comes from .env (PERSONA=roz|protocol|unikitty|private), not
// from its nickname. The persona is fully defined by personas/<key>.json:
// systemPrompt + exemplars (for the LLM generator) and the functional line
// pools (greet, bedtime, retry, ... — scripted, deterministic, always work).
// bot.js holds no persona text. No spec file → default voice: base pools only.
const PERSONA = (process.env.PERSONA || 'default').toLowerCase()

// JSON encodes pick weights as stat expressions ("focus + snark", "charm + 10");
// compile back to the (stats) => number form pickLineEntry expects.
function compileWeightExpr (expr) {
  const terms = String(expr).split('+').map(t => t.trim()).filter(Boolean)
  return (s) => terms.reduce((sum, t) => sum + (/^\d+$/.test(t) ? Number(t) : (s[t] || 0)), 0)
}

function revivePersonaEntry (e) {
  if (typeof e === 'string') return e
  const out = { text: e.text }
  if (e.weight) out.weight = compileWeightExpr(e.weight)
  if (e.emote) out.emote = e.emote
  return out
}

function readPersonaSpec (key) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'personas', `${key}.json`), 'utf8'))
  const functional = {}
  for (const [slot, entries] of Object.entries(raw.functional || {})) {
    functional[slot] = entries.map(revivePersonaEntry)
  }
  return { ...raw, functional }
}

let personaSpec = { key: PERSONA, name: null, systemPrompt: '', exemplars: [], functional: {} }
if (PERSONA !== 'default') {
  try {
    personaSpec = readPersonaSpec(PERSONA)
    console.log(`[persona] loaded '${PERSONA}' (${personaSpec.name})`)
  } catch (e) {
    console.log(`[persona] no spec for '${PERSONA}' (${e.message}) — using default voice`)
  }
}

function botPersonaKey () { return PERSONA }

// The persona's voice generator (Ollama). Health-checked in the background;
// when unreachable, expressive speech is silent — functional speech unaffected.
llm.init({ logFn: logEvent })


// Shared world context for LLM-generated speech.
// Keep persona identity in personas/*.json, and keep place/world facts here.
// This gives every persona the same local map without duplicating text in each
// persona file. Missing file is fine: the bots simply run without world notes.
const WORLD_CONTEXT_PATH = path.join(__dirname, process.env.WORLD_CONTEXT_FILE || 'data/world_context.md')
let worldContext = ''
function loadWorldContext () {
  try {
    worldContext = fs.readFileSync(WORLD_CONTEXT_PATH, 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (worldContext) logEvent('world-context', `loaded ${worldContext.length} chars from ${WORLD_CONTEXT_PATH}`)
  } catch (e) {
    worldContext = ''
    logEvent('world-context', `none loaded (${e.message})`)
  }
}
loadWorldContext()

// Persona's own pool for a slot, or the shared fallback when absent.
function personaPool (slot, fallbackPool) {
  const pool = personaSpec.functional[slot]
  return (pool && pool.length) ? pool : fallbackPool
}

// Union of one functional slot across ALL persona spec files — for recognizing
// other bots' announcements regardless of which persona this bot runs.
function allPersonaFunctional (slot) {
  const out = []
  try {
    for (const f of fs.readdirSync(path.join(__dirname, 'personas'))) {
      if (!f.endsWith('.json')) continue
      try {
        const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'personas', f), 'utf8'))
        out.push(...(spec.functional?.[slot] || []))
      } catch {}
    }
  } catch {}
  return out
}

// Persona-tagged pool filtering (used by JOKES): tagged entries are exclusive
// to the matching persona; untagged entries are available to all bots.
const PERSONA_TAGS = new Set(['protocol', 'roz', 'unikitty', 'private'])
function personaBiasForTags (tags = []) {
  const persona = botPersonaKey()
  if (!Array.isArray(tags) || !tags.length) return 1
  const hasPersonaTag = tags.some(t => PERSONA_TAGS.has(t))
  if (!hasPersonaTag) return 1
  if (tags.includes(persona)) return 1
  return 0
}

const _personaPools = new Map()
// Shared base pool extended with this persona's additions from its spec file.
function withPersonaSlot (basePool, slot) {
  const extra = personaSpec.functional[slot]
  if (!extra || !extra.length) return basePool
  return extra
}

function posStr (p) { return `${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}` }

// ── Entity awareness helpers ────────────────────────────────────────────────

function nearbyPlayers (radius = 3) {
  if (!bot.entity) return []
  const me = bot.entity.position
  return Object.values(bot.players)
    .filter(p => p.username !== bot.username && p.entity && p.entity.position.distanceTo(me) <= radius)
    .map(p => ({ username: p.username, entity: p.entity, dist: p.entity.position.distanceTo(me) }))
    .sort((a, b) => a.dist - b.dist)
}

function isPositionOccupied (pos, excludeUsername = null) {
  for (const [name, p] of Object.entries(bot.players)) {
    if (name === bot.username || name === excludeUsername || !p.entity) continue
    if (p.entity.position.distanceTo(pos) < 1.0) return name
  }
  return null
}

function evaluateFollowChain (targetUsername) {
  const targetEntity = findPlayerEntity(targetUsername)
  if (!targetEntity) return { entity: null, chainPos: 0 }
  const targetPos = targetEntity.position
  const botsInChain = []
  for (const [name, p] of Object.entries(bot.players)) {
    if (name === bot.username || name === targetUsername || !p.entity) continue
    const dist = p.entity.position.distanceTo(targetPos)
    if (dist <= 8) botsInChain.push({ username: name, entity: p.entity, dist })
  }
  botsInChain.sort((a, b) => a.dist - b.dist || a.username.localeCompare(b.username))
  const myDist = bot.entity.position.distanceTo(targetPos)
  let chainPos = 1
  for (const b of botsInChain) {
    if (b.dist < myDist || (Math.abs(b.dist - myDist) < 0.5 && b.username < bot.username)) {
      chainPos++
    }
  }
  if (chainPos === 1) return { entity: targetEntity, chainPos: 1 }
  const ahead = botsInChain[chainPos - 2]
  return { entity: ahead?.entity || targetEntity, chainPos }
}

// ── Harvest + replant (codifies places.md) ───────────────────────────────
// Harvests wheat (optionally filtered to north/south half), then replants
// seeds on the same farmland set, then deposits wheat into the kitchen chest.
// Safety-first: refuses at night, tracks deaths and HP
// mid-operation, and breaks off cleanly if anything goes wrong.
const HARVEST_WAYPOINTS = {
  field_east_approach: { x: -278, y: 64, z: 567 },
  field_center:        { x: -283, y: 64, z: 562 },
  north_field_center:  { x: -283, y: 64, z: 554 },
  chest_approach:      { x: -267, y: 65, z: 570 },
  kitchen_chest:       { x: -266, y: 67, z: 569 },
  // Potato patch south of the main field, near the pond. The patch was a
  // 2-wide×2-deep (4 tiles) plus a marker row the user planted for
  // orientation; bounds covers the full known cultivated area.
  potato_approach:     { x: -284, y: 63, z: 577 },
  potato_center:       { x: -285, y: 63, z: 578 },
  furnace:             { x: -265, y: 65, z: 571 },
}
const POTATO_BOUNDS = { xMin: -287, xMax: -284, zMin: 576, zMax: 579 }
const POTATO_SWEEP_POINTS = [
  { x: -284, y: 63, z: 578 }, { x: -286, y: 63, z: 578 },
  { x: -284, y: 63, z: 579 }, { x: -286, y: 63, z: 579 },
  { x: -287, y: 63, z: 577 }, { x: -286, y: 63, z: 577 },
]
const FIELD_BOUNDS = { xMin: -287, xMax: -279, zMin: 559, zMax: 565 }
const NORTH_FIELD_BOUNDS = { xMin: -287, xMax: -279, zMin: 551, zMax: 557 }
const HOSTILE_NAMES = new Set([
  'zombie', 'zombie_villager', 'husk', 'drowned',
  'skeleton', 'stray', 'wither_skeleton',
  'creeper', 'spider', 'cave_spider',
  'witch', 'enderman', 'slime', 'magma_cube', 'phantom',
  'blaze', 'ghast', 'silverfish', 'endermite',
  'guardian', 'elder_guardian', 'shulker', 'vex',
  'evoker', 'vindicator', 'pillager', 'ravager',
  'wither', 'hoglin', 'zoglin', 'piglin_brute', 'warden',
])

const JOKES = [
  { setup: 'Why did the bicycle fall over?', punchline: 'Because it was two-tired.' },
  { setup: 'What do you call a pile of cats?', punchline: 'A meow-ntain.' },
  { setup: 'How many tickles does it take to tickle an octopus?', punchline: 'Ten tickles.' },
  { setup: 'What do you call a fake noodle?', punchline: 'An impasta.' },
  { setup: 'Why don\'t scientists trust atoms?', punchline: 'Because they make up everything.' },
  { setup: 'What do you call a bear with no teeth?', punchline: 'A gummy bear.' },
  { setup: 'Why can\'t you hear a pterodactyl going to the bathroom?', punchline: 'Because the p is silent.' },
  { setup: 'What did the ocean say to the beach?', punchline: 'Nothing, it just waved.' },
  { setup: 'Why do cows wear bells?', punchline: 'Because their horns don\'t work.' },
  { setup: 'What do you call a sleeping dinosaur?', punchline: 'A dino-snore.' },
  { setup: 'Why did the scarecrow win an award?', punchline: 'Because he was outstanding in his field.', requiresWheatField: true },
  { setup: 'What do you call a dog that does magic?', punchline: 'A Labracadabrador.' },
  { setup: 'Why don\'t eggs tell jokes?', punchline: 'They\'d crack each other up.' },
  { setup: 'What did one wall say to the other?', punchline: 'I\'ll meet you at the corner.' },
  { setup: 'Why did the math book look so sad?', punchline: 'Because it had too many problems.' },
  { setup: 'What do you call cheese that isn\'t yours?', punchline: 'Nacho cheese.' },
  { setup: 'Why couldn\'t the pony sing?', punchline: 'Because she was a little horse.' },
  { setup: 'What do you call a fish without eyes?', punchline: 'A fsh.' },
  { setup: 'Why did the golfer bring two pairs of pants?', punchline: 'In case he got a hole in one.' },
  { setup: 'What do you call a boomerang that doesn\'t come back?', punchline: 'A stick.' },
  { setup: 'Why did the protocol bot count the sheep twice?', punchline: 'Because once felt statistically reckless.', tags: ['protocol'] },
  { setup: 'Why did the cautious robot bring a clipboard to the pasture?', punchline: 'For the sheep-adjacent hazard assessment.', tags: ['protocol'] },
  { setup: 'Why did the robot check on the sheep?', punchline: 'Because care is a protocol with muddy boots.', tags: ['roz'] },
  { setup: 'What did the farm robot say to the squirrel?', punchline: 'Tiny creature detected. Respectful distance maintained.', tags: ['roz'] },
  { setup: 'Know what I heard?', mid: '/me listens intently', punchline: 'sheep' },
]

let pendingJoke = null
let pendingJokeTimer = null

function sendEmote (name) {
  const nameBytes = Buffer.from(name, 'utf8')
  const data = Buffer.concat([Buffer.from([0x10]), Buffer.from([nameBytes.length & 0x7F]), nameBytes])
  client.write('custom_payload', { channel: 'autoreglib', data })
}

function deliverPunchline () {
  const joke = pendingJoke
  pendingJoke = null
  if (pendingJokeTimer) { clearTimeout(pendingJokeTimer); pendingJokeTimer = null }
  if (!joke) return
  if (joke.mid) {
    bot.chat(joke.mid)
    setTimeout(() => { sendEmote('clap'); bot.chat(joke.punchline) }, 2500)
  } else {
    sendEmote('clap')
    bot.chat(joke.punchline)
  }
}

let goInsideBusy = false

let abortGen = 0
class AbortError extends Error {
  constructor () { super('aborted'); this.name = 'AbortError' }
}
function checkAbort (myGen) { if (abortGen !== myGen) throw new AbortError() }

function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }

// ── Unified task system ──────────────────────────────────────────────────
// Every long-running operation (harvest, bake, deposit) registers here.
// Command dispatch checks activeTask before starting new work and returns
// a conflict error when the bot is already busy. Auto-behaviors and idle
// wander also check it.
//
// Bedtime-aware tasks call yieldToBedtime() at their natural checkpoints.
// Instead of refusing work ("too late in the day"), the bot starts, yields
// to sleep when bedtime arrives, then resumes in the morning.

const activeTask = {
  name: null,
  detail: null,
  startedAt: null,
  sleeping: false,
}

function startTask (name, detail) {
  if (activeTask.name) {
    return { allowed: false, current: activeTask.name, detail: activeTask.detail }
  }
  activeTask.name = name
  activeTask.detail = detail || null
  activeTask.startedAt = Date.now()
  activeTask.sleeping = false
  logEvent('task', `started: ${name}${detail ? ` (${detail})` : ''}`)
  return { allowed: true }
}

function endTask (expectedName) {
  if (activeTask.name === expectedName) {
    logEvent('task', `ended: ${expectedName}`)
    activeTask.name = null
    activeTask.detail = null
    activeTask.startedAt = null
    activeTask.sleeping = false
  }
}

function taskBusy () {
  return activeTask.name !== null && !activeTask.sleeping
}

function taskStatus () {
  if (!activeTask.name) return { busy: false }
  return {
    busy: !activeTask.sleeping,
    task: activeTask.name,
    detail: activeTask.detail,
    sleeping: activeTask.sleeping,
    elapsed_ms: Date.now() - activeTask.startedAt,
  }
}

const BEDTIME_YIELD_LINES = [
  { text: "Getting late — heading in for the night. I'll pick back up in the morning.", weight: (s) => s.patience + s.charm },
  { text: "Bedtime. I'll finish the rest come morning.",                                 weight: (s) => s.patience + 5 },
  { text: "Sun's going down — calling it a night. More tomorrow.",                       weight: (s) => s.curiosity + s.patience },
  { text: "Time to head in. I'll be back out at first light.",                           weight: (s) => s.charm + s.focus },
]

const MORNING_RESUME_LINES = [
  { text: 'Morning! Back to it.',                    weight: (s) => s.charm + s.focus },
  { text: 'New day. Picking up where I left off.',   weight: (s) => s.focus + 5 },
  { text: "Sun's up — heading back out.",            weight: (s) => s.curiosity + s.charm },
  { text: "Good morning. Let's finish this.",        weight: (s) => s.focus + s.charm },
]

function waitForMorning () {
  return new Promise(resolve => {
    function check () {
      const t = bot.time || {}
      if (!bot.isSleeping && t.isDay && (t.timeOfDay ?? 0) < 11500) {
        resolve()
        return
      }
      setTimeout(check, 2000)
    }
    check()
  })
}

async function yieldToBedtime (myGen) {
  activeTask.sleeping = true
  bot.chat(pickLine(withPersonaSlot(BEDTIME_YIELD_LINES, 'bedtimeYield')))
  logEvent('task', `${activeTask.name} yielding to bedtime`)

  if (!insideHouse()) {
    // If far from the house (e.g. potato patch), pathfind closer first so
    // runGoInside's manual walk fallback can reach the door.
    const me = bot.entity.position
    const nearDoor = HARVEST_WAYPOINTS.field_east_approach
    const dist = Math.hypot(me.x - nearDoor.x, me.z - nearDoor.z)
    if (dist > 8) {
      try { await pathTo(nearDoor, 2, 15000) } catch (e) {
        logEvent('task', `bedtime yield pre-pathfind failed: ${e.message}`)
      }
    }
    try { await runGoInside() } catch (e) {
      logEvent('task', `bedtime yield go-inside failed: ${e.message}`)
      activeTask.sleeping = false
      throw e
    }
  }

  // Auto-sleep interval handles bed activation; just wait for it.
  for (let i = 0; i < 120; i++) {
    if (bot.isSleeping) break
    await sleep(2000)
    if (myGen !== undefined) checkAbort(myGen)
    if (i > 0 && i % 8 === 0 && autoSleepEnabled && isBedtime() && insideHouse() && !autoSleepBusy) {
      tryAutoSleep().catch(() => {})
    }
  }

  await waitForMorning()
  logEvent('task', `${activeTask.name} morning reached, checking abort (myGen=${myGen} abortGen=${abortGen})`)
  if (myGen !== undefined) checkAbort(myGen)

  activeTask.sleeping = false
  bot.chat(pickLine(withPersonaSlot(MORNING_RESUME_LINES, 'morningResume')))
  logEvent('task', `${activeTask.name} resuming after sleep (inside=${insideHouse()})`)

  if (insideHouse()) {
    logEvent('task', `${activeTask.name} going outside to resume`)
    await runGoOutside(activeTask.detail || activeTask.name)
    logEvent('task', `${activeTask.name} outside, resuming harvest loop`)
  }
}

function hashCode (str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

const POTATO_ASK_LINES = [
  "Should I cook these little potato-o-o's or what?",
  "Got a bunch of taters — bake 'em or stash 'em?",
  "These potatoes aren't gonna cook themselves. Furnace or chest?",
  "Potatoes secured. Want me to fire up the furnace or just put them away?",
  "Spuds acquired. Bake or stash?",
  "What's the plan for these bad boys — furnace or chest?",
]
const WHEAT_ASK_LINES = [
  "Wheat's all bundled up — hopper or chest?",
  "Got the wheat. Want it in the hopper or the chest?",
  "Where's this wheat headed — hopper or chest?",
  "Harvest's in hand. Hopper or chest for the wheat?",
  "Wheat secured. Drop it in the hopper, or stash it in the chest?",
]
// Hopper inside the house (vanilla container). Wheat can be routed here as an
// alternative to the kitchen chest after a harvest. See journal/places/house-hopper.
const HOPPER = { x: -266, y: 65, z: 573 }

function waitForChatReply (testFn, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { bot.removeListener('chat', handler); resolve(null) }, timeoutMs)
    function handler (username, message) {
      if (username === bot.username || (nickRe && nickRe.test(username))) return
      const result = testFn(username, message)
      if (result !== undefined) {
        clearTimeout(timer)
        bot.removeListener('chat', handler)
        resolve(result)
      }
    }
    bot.on('chat', handler)
  })
}

async function clearHand () {
  try { await bot.unequip('hand') } catch (_) {}
}

const TRASH_ITEMS = new Set(['poisonous_potato'])
async function tossTrash () {
  const trash = bot.inventory.items().filter(i => TRASH_ITEMS.has(i.name))
  if (!trash.length) return
  for (const it of bot.inventory.items().filter(i => TRASH_ITEMS.has(i.name))) {
    try {
      await bot.tossStack(it)
      logEvent('trash', `tossed ${it.count}× ${it.name} in place`)
    } catch (e) {
      logEvent('trash', `toss fail ${it.name}: ${e.message}`)
    }
  }
}

function countOnHand (name) {
  const win = bot.currentWindow
  if (win) {
    return win.items()
      .filter(i => i.name === name && i.slot >= win.inventoryStart)
      .reduce((s, i) => s + i.count, 0)
  }
  return bot.inventory.items()
    .filter(i => i.name === name)
    .reduce((s, i) => s + i.count, 0)
}

// Robust deposit into a container via server-side quick-move (shift-click,
// mode 1). Built for the kitchen hopper, which drains continuously into the
// bio-fuel machine: its slot contents shift between a client-side read and the
// click, so mineflayer's window.deposit() — pick a stack onto the cursor, then
// click a slot it computed locally — gets its transaction rejected by the
// server and throws 'destination full'. Quick-move hands placement to the
// server in one atomic click. We retry with a fresh window each round and
// verify by inventory delta, so a draining intake can't cause silent loss.
// Success means the item left the bot's inventory — not where it landed.
//
// Returns { deposited, remaining, rounds, backedUp }. `backedUp` is true when
// the container stopped accepting items with more than `keep` still on hand
// (machine off, or genuinely full) — the caller should surface that.
async function depositQuickMove (itemName, target, { keep = 0, maxRounds = 8, settleMs = 150 } = {}) {
  const startCount = countOnHand(itemName)
  if (startCount <= keep) return { deposited: 0, remaining: startCount, rounds: 0, backedUp: false }

  let rounds = 0
  let stalled = 0
  while (countOnHand(itemName) > keep && rounds < maxRounds) {
    rounds++
    const block = bot.blockAt(new Vec3(target.x, target.y, target.z))
    if (!block) throw new Error(`deposit target not loaded at ${target.x},${target.y},${target.z}`)
    let win
    try {
      win = await bot.openContainer(block)
    } catch (e) {
      logEvent('deposit-qm', `open fail (${itemName}) round ${rounds}: ${e.message}`)
      await sleep(300)
      continue
    }
    const before = countOnHand(itemName)
    try {
      // Re-query the window each click — quick-move shifts slots underneath us.
      let guard = 0
      while (countOnHand(itemName) > keep && guard < 64) {
        guard++
        const stack = win.items().find(i => i.name === itemName && i.slot >= win.inventoryStart)
        if (!stack) break
        if (countOnHand(itemName) - stack.count < keep) break // whole-stack move would dip below keep
        try {
          await bot.clickWindow(stack.slot, 0, 1) // mode 1 = quick-move; server places it
        } catch (e) {
          logEvent('deposit-qm', `quick-move rejected (${itemName}) round ${rounds}: ${e.message}`)
          break
        }
        await sleep(settleMs)
      }
    } finally {
      try { win.close() } catch (_) {}
    }
    const after = countOnHand(itemName)
    if (after >= before) {
      if (++stalled >= 3) break // container won't accept more — backed up
      await sleep(500)          // let a draining hopper make room, then re-open fresh
    } else {
      stalled = 0
    }
  }

  const remaining = countOnHand(itemName)
  return { deposited: startCount - remaining, remaining, rounds, backedUp: remaining > keep }
}

// Nickname → real username map, built from raw chat JSON and player_info updates.
const nicknameMap = new Map()

client.on('chat', (packet) => {
  try {
    const raw = packet.message
    const json = typeof raw === 'string' ? JSON.parse(raw) : raw
    learnNicknames(json)
  } catch (e) { /* ignore unparseable */ }
})

function learnNicknames (node) {
  if (!node || typeof node !== 'object') return
  const click = node.clickEvent?.value
  const insertion = node.insertion
  let realName = null
  if (click) {
    const m = click.match(/^\/(?:msg|tell|w)\s+(\w+)\s?$/)
    if (m) realName = m[1]
  }
  if (!realName && insertion && /^\w{3,16}$/.test(insertion)) {
    realName = insertion
  }
  if (realName) {
    const displayText = (node.extra || []).map(e => e.text).filter(Boolean).join('') || node.text
    if (displayText && displayText.toLowerCase() !== realName.toLowerCase() && displayText.length <= 20) {
      nicknameMap.set(displayText.toLowerCase(), realName)
    }
  }
  if (Array.isArray(node.extra)) node.extra.forEach(learnNicknames)
}

bot.on('playerUpdated', (oldPlayer, newPlayer) => {
  if (newPlayer.username === bot.username) return
  const display = newPlayer.displayName?.toString()
  if (display && display.toLowerCase() !== newPlayer.username.toLowerCase()) {
    nicknameMap.set(display.toLowerCase(), newPlayer.username)
  }
})

function resolveUsername (chatName) {
  if (bot.players[chatName]) return chatName
  const lower = chatName.toLowerCase()
  for (const name of Object.keys(bot.players)) {
    if (name.toLowerCase() === lower) return name
  }
  return nicknameMap.get(lower) || null
}

function findPlayerEntity (username) {
  const realName = resolveUsername(username)
  if (!realName) return null
  return bot.players[realName]?.entity || null
}

async function facePlayer (username) {
  const realName = resolveUsername(username)
  let player = realName ? bot.players[realName] : null
  if (!player?.entity) {
    await faceNearestPlayer()
    return
  }
  await bot.lookAt(player.entity.position.offset(0, 1.6, 0)).catch(() => {})
}

async function faceNearestPlayer () {
  const me = bot.entity.position
  let closest = null
  let closestDist = Infinity
  for (const [name, p] of Object.entries(bot.players)) {
    if (name === bot.username || !p.entity) continue
    const d = p.entity.position.distanceTo(me)
    if (d < closestDist) { closest = name; closestDist = d }
  }
  if (closest) await facePlayer(closest)
}

async function pathTo (pt, range = 1, waitMs = 15000) {
  const startGen = abortGen
  let tx = pt.x, tz = pt.z
  if (range <= 1 && isPositionOccupied(new Vec3(pt.x, pt.y, pt.z))) {
    const offsets = [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]
    for (const off of offsets) {
      if (!isPositionOccupied(new Vec3(pt.x + off.x, pt.y, pt.z + off.z))) {
        tx = pt.x + off.x; tz = pt.z + off.z; break
      }
    }
  }
  const goal = new goals.GoalNear(tx, pt.y, tz, range)
  bot.pathfinder.setGoal(goal)
  const start = Date.now()
  while (Date.now() - start < waitMs) {
    await sleep(400)
    if (abortGen !== startGen) { bot.pathfinder.setGoal(null); throw new AbortError() }
    if (!bot.pathfinder.isMoving()) break
  }
  return !bot.pathfinder.isMoving()
}

// Orientation-block check: are we standing on the specific block that's the
// launch pad for a door traversal? Used to refuse to open/cross a door from
// the wrong tile — the root cause of past drift-into-furnace deaths.
function verifyAtOrientation (pt, xzTol = 1.5, yTol = 0.6) {
  const p = bot.entity?.position
  if (!p) return { ok: false, error: 'no position' }
  const dx = Math.abs(p.x - pt.x)
  const dz = Math.abs(p.z - pt.z)
  const dy = Math.abs(p.y - pt.y)
  const within = dx <= xzTol && dz <= xzTol && dy <= yTol
  return { ok: within, dx: +dx.toFixed(2), dy: +dy.toFixed(2), dz: +dz.toFixed(2), pos: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) } }
}

// Drive forward until an axis-target is reached. Bails on death or HP drop so
// walking into the furnace terminates in ~50ms, not 8s.
// `strafe`: 'left'|'right'|null — held alongside forward to clear the doorway.
// The spruce door's hit-box otherwise catches the bot on the jamb and stops
// forward progress. Strafe is held for the entire walk; when facing west from
// house_center, strafe 'left' = +z drift, which lines the bot up with the door
// opening and lets momentum carry it through.
// Walk straight forward until axis-target reached. Detects the door-jamb
// "snag" (axis not progressing while forward held) and does a brief strafe
// pulse to nudge off the frame, then resumes straight. Bails on death or HP.
//
// `unstickStrafe`: 'left'|'right'|null — direction to pulse when snagged.
// `unstickMs`: how long to hold the strafe pulse (short; just enough to clear).
// `snagWindow`: how long with no axis progress before we consider it a snag.
// `snagThreshold`: min axis delta over the window to count as "progressing".
async function walkUntilAxis ({
  axis, target, direction = 'gte', maxMs = 8000, bailOnDamage = false,
  unstickStrafe = null, unstickMs = 200, snagWindow = 500, snagThreshold = 0.1,
}) {
  const startHp = bot.health ?? 20
  const startDeaths = deathCount
  return new Promise((resolve) => {
    const start = Date.now()
    bot.setControlState('forward', true)
    let lastProgressVal = bot.entity?.position?.[axis] ?? 0
    let lastProgressAt = start
    let strafeActive = null
    let strafeOffAt = 0
    const timer = setInterval(() => {
      const now = Date.now()
      const val = bot.entity?.position?.[axis] ?? 0

      // End strafe pulse once the timer elapses.
      if (strafeActive && now >= strafeOffAt) {
        bot.setControlState(strafeActive, false)
        strafeActive = null
      }

      // Track progress in the desired direction.
      const progressed = direction === 'gte'
        ? val - lastProgressVal >= snagThreshold
        : lastProgressVal - val >= snagThreshold
      if (progressed) {
        lastProgressVal = val
        lastProgressAt = now
      } else if (unstickStrafe && !strafeActive && now - lastProgressAt >= snagWindow) {
        // Snagged — pulse strafe briefly, then let forward carry us again.
        strafeActive = unstickStrafe
        strafeOffAt = now + unstickMs
        bot.setControlState(unstickStrafe, true)
        logEvent('walk_until', `snag at ${axis}=${val.toFixed(2)} — pulsing strafe ${unstickStrafe} for ${unstickMs}ms`)
        lastProgressAt = now // give the pulse time to work before another
      }

      const reached = direction === 'gte' ? val >= target : val <= target
      const hpDrop = bailOnDamage && (bot.health ?? 20) < startHp - 2
      const died = deathCount > startDeaths
      if (reached || died || hpDrop || now - start > maxMs) {
        bot.setControlState('forward', false)
        if (strafeActive) bot.setControlState(strafeActive, false)
        clearInterval(timer)
        const p = bot.entity?.position || { x: 0, y: 0, z: 0 }
        resolve({
          reached, died, hpDrop,
          x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
          elapsed_ms: now - start,
        })
      }
    }, 50)
  })
}

function hostilesNearby (radius = 16) {
  if (!bot.entity) return []
  return Object.values(bot.entities).filter(e =>
    e !== bot.entity && HOSTILE_NAMES.has(e.name) &&
    Math.abs(e.position.y - bot.entity.position.y) <= 5 &&
    e.position.distanceTo(bot.entity.position) <= radius
  )
}

function filterByHalf (positions, half) {
  if (half === 'north') return positions.filter(p => p.z >= 559 && p.z <= 561)
  if (half === 'south') return positions.filter(p => p.z >= 563 && p.z <= 565)
  if (half === 'south-field') return positions.filter(p =>
    p.x >= FIELD_BOUNDS.xMin && p.x <= FIELD_BOUNDS.xMax &&
    p.z >= FIELD_BOUNDS.zMin && p.z <= FIELD_BOUNDS.zMax
  )
  if (half === 'north-field') return positions.filter(p =>
    p.x >= NORTH_FIELD_BOUNDS.xMin && p.x <= NORTH_FIELD_BOUNDS.xMax &&
    p.z >= NORTH_FIELD_BOUNDS.zMin && p.z <= NORTH_FIELD_BOUNDS.zMax
  )
  return positions.filter(p =>
    p.x >= FIELD_BOUNDS.xMin && p.x <= FIELD_BOUNDS.xMax &&
    p.z >= NORTH_FIELD_BOUNDS.zMin && p.z <= FIELD_BOUNDS.zMax
  )
}

function inWheatField () {
  const p = bot.entity?.position
  if (!p) return false
  const inSouthField = p.x >= FIELD_BOUNDS.xMin - 0.75 && p.x <= FIELD_BOUNDS.xMax + 0.75 &&
    p.z >= FIELD_BOUNDS.zMin - 0.75 && p.z <= FIELD_BOUNDS.zMax + 0.75
  const inNorthField = p.x >= NORTH_FIELD_BOUNDS.xMin - 0.75 && p.x <= NORTH_FIELD_BOUNDS.xMax + 0.75 &&
    p.z >= NORTH_FIELD_BOUNDS.zMin - 0.75 && p.z <= NORTH_FIELD_BOUNDS.zMax + 0.75
  return (inSouthField || inNorthField) && p.y >= 63 && p.y <= 66
}

// Idle wandering: when no job owns the bot, let it drift between house,
// outside, the wheat field, and the sheep pen. Bedtime always wins; if night falls, wandering
// becomes "go home" instead of "wander out".
let idleWanderEnabled = true
let idleWanderTimerId = null
const IDLE_WANDER_MIN_MS = 60 * 1000
const IDLE_WANDER_MAX_MS = 180 * 1000
const WHEAT_FIELD_STAND_POINTS = [
  { x: -283, y: 64, z: 562 },
  { x: -283, y: 64, z: 554 },
  { x: -281, y: 64, z: 565 },
  { x: -285, y: 64, z: 551 },
]
const IDLE_WANDER_FIELD_LINES = [
  { text: 'I am going to stand in the wheat for a moment. For field research.', weight: (s) => s.curiosity + s.focus },
  { text: 'Taking a brief wheat-adjacent observational posture.', weight: (s) => s.focus + s.snark },
  { text: 'The field is calling. Quietly. In wheat.', weight: (s) => s.charm + s.curiosity },
  { text: 'I will inspect the crop rows. Dramatically, but not too dramatically.', weight: (s) => s.snark + s.focus },
  { text: 'I feel a sudden need to stand in a field.', weight: (s) => s.curiosity + s.snark },
  { text: 'The wheat and I need to have a conversation.', weight: (s) => s.charm + s.curiosity },
]
let lastFieldRepairAt = 0
const FIELD_WANDER_REPAIR_COOLDOWN_MS = 15 * 1000

// (Chat-triggered field-wander joining was removed 2026-06-11 with the LLM
// chat router refactor — bots no longer phrase-match each other's announce
// lines. Idle wandering itself is unchanged.)
async function maybeRepairBareWheatTilesWhileWandering () {
  if (!inWheatField()) return false
  if (Date.now() - lastFieldRepairAt < FIELD_WANDER_REPAIR_COOLDOWN_MS) return false
  const bare = findBareWheatTiles()
  if (!bare.length) return false
  lastFieldRepairAt = Date.now()
  await repairBareWheatTilesFromFieldVisit({ announce: true })
  return true
}

const SHEEP_COUNTING_LINES = [
  { text: 'Maybe I will count the sheep for a while.', weight: (s) => s.charm + s.patience },
  { text: 'I seem to be counting sheep.', weight: (s) => s.patience + s.snark },
  { text: 'One sheep. Two sheep. Several sheep.', weight: (s) => s.snark + s.charm },
  { text: 'I lost count around sheep six.', weight: (s) => s.snark + s.chaos },
  { text: 'The sheep are making counting difficult.', weight: (s) => s.snark + s.focus },
  { text: 'I am trying to count the sheep, but they keep moving.', weight: (s) => s.focus + s.snark },
  { text: 'One of the sheep appears uncooperative.', weight: (s) => s.snark + s.curiosity },
  { text: 'I think there are still the correct number of sheep.', weight: (s) => s.focus + s.charm },
  { text: 'Counting sheep feels appropriate somehow.', weight: (s) => s.patience + s.charm },
  { text: 'The sheep seem calmer tonight.', weight: (s) => s.charm + s.patience },
  { text: 'The sheep have entered loaf mode.', weight: (s) => s.curiosity + s.charm },
  { text: 'This is statistically a lot of sheep.', weight: (s) => s.focus + s.snark },
  { text: 'One sheep. Two sheep. Three sheep. ...what was I doing?', weight: (s) => s.chaos + s.snark },
  { text: 'I have counted the sheep twice and still learned nothing.', weight: (s) => s.snark + s.patience },
]

function idleWanderBusy () {
  return !bot.entity || bot.isSleeping || autoSleepBusy || goInsideBusy || penTraversalBusy ||
    activeTask.name !== null || followTarget
}

function randomIdleWanderTarget () {
  const fieldNow = inWheatField()
  const insideNow = insideHouse()
  const penNow = inPen()
  const r = Math.random()
  if (penNow) {
    if (r < 0.70) return 'outside'
    if (r < 0.92) return 'inside'
    return 'stay'
  }
  if (insideNow) {
    if (r < 0.25) return 'outside'
    if (r < 0.78) return 'field'
    if (r < 0.90) return 'pen'
    return 'stay'
  }
  if (fieldNow) {
    if (r < 0.30) return 'stay'
    if (r < 0.55) return 'outside'
    if (r < 0.82) return 'inside'
    if (r < 0.92) return 'pen'
    return 'stay'
  }
  if (r < 0.25) return 'inside'
  if (r < 0.72) return 'field'
  if (r < 0.86) return 'pen'
  return 'stay'
}

async function runIdleWanderToField ({ announce = true } = {}) {
  if (insideHouse()) await runGoOutside('a short walk')
  if (insideHouse()) return
  const pt = WHEAT_FIELD_STAND_POINTS[Math.floor(Math.random() * WHEAT_FIELD_STAND_POINTS.length)]
  if (announce) logEvent('idle-wander', 'heading to wheat field')
  await pathTo(pt, 1, 12000)
  if (bot.entity) logEvent('idle-wander', `standing in wheat field at ${posStr(bot.entity.position)}`)
  await maybeRepairBareWheatTilesWhileWandering()
}

async function runIdleWanderToPen () {
  if (insideHouse()) {
    await runGoOutside('sheep')
    if (insideHouse()) {
      logEvent('idle-wander', 'pen skipped, could not get outside first')
      return
    }
  }

  logEvent('idle-wander', 'heading to pen')
  await runEnterPen({ allowNight: true })
  if (!inPen()) {
    logEvent('idle-wander', 'pen visit did not end inside pen')
    return
  }
  await sleep(1200)
  if (isBedtime()) {
    if (inPen()) await runLeavePen()
    return
  }
  await sleep(1500 + Math.floor(Math.random() * 2500))
  await sleep(2500 + Math.floor(Math.random() * 4500))
  if (inPen()) await runLeavePen()
}

async function tryIdleWander () {
  if (!idleWanderEnabled) return
  if (idleWanderBusy()) return

  // Bedtime overrides wandering. If the bot is outside, the only idle move is
  // homeward; if already inside, let auto-sleep handle the bed itself.
  if (isBedtime()) {
    if (inPen()) {
      logEvent('idle-wander', 'bedtime override — leaving pen')
      await runLeavePen().catch(e => logEvent('idle-wander', `leave-pen failed: ${e.message}`))
    }
    if (!insideHouse()) {
      logEvent('idle-wander', 'bedtime override — going inside')
      await runGoInside().catch(e => logEvent('idle-wander', `go-inside failed: ${e.message}`))
    }
    return
  }

  const action = randomIdleWanderTarget()
  try {
    if (action !== 'stay') logEvent('idle-wander', `heading ${action}`)

    // Do not let idle wandering strand a bot in the sheep pen. Any non-pen
    // wander first exits the pen using the safe gate procedure.
    if (inPen() && action !== 'pen' && action !== 'stay') {
      await runLeavePen()
    }

    if (action === 'inside') {
      if (!insideHouse()) await runGoInside()
    } else if (action === 'outside') {
      if (insideHouse()) await runGoOutside('a short walk')
      else await pathTo(OUTSIDE_ORIENTATION, 1, 10000)
    } else if (action === 'field') {
      await runIdleWanderToField()
    } else if (action === 'pen') {
      await runIdleWanderToPen()
    }
  } catch (e) {
    if (e.name === 'AbortError') return
    logEvent('idle-wander', `${action} failed: ${e.message}`)
  } finally {
    bot.pathfinder.setGoal(null)
    await clearHand()
  }
}

function startIdleWanderTimer () {
  if (idleWanderTimerId) return
  function scheduleNext () {
    const delay = IDLE_WANDER_MIN_MS + Math.random() * (IDLE_WANDER_MAX_MS - IDLE_WANDER_MIN_MS)
    idleWanderTimerId = setTimeout(() => {
      tryIdleWander().finally(scheduleNext)
    }, delay)
  }
  scheduleNext()
  logEvent('idle-wander', 'timer started, interval 20–70s')
}

// ── Expressive output gate ───────────────────────────────────────────────────
// All flavor chatter (ambient /me actions, wildlife/squirrel comments, victory
// lines, follow-mode bedtime suggestions) flows through this one gate: a single
// global gap between any two expressive lines, plus one per-kind cooldown
// table. This replaces the old web of cross-suppression timestamps
// (lastAmbientActionAt / lastWildlifeCommentAt / suppressUntil / ...) where
// each system had to know about every other. Functional speech — task
// announcements, greetings, replies to commands — bypasses the gate entirely:
// it must always work.
const EXPRESSIVE_GLOBAL_GAP_MS = 30_000
// Mid-exchange bot replies already pace themselves with their own ≥5s delays,
// so they get a shorter global gap than ambient chatter.
const EXPRESSIVE_GLOBAL_GAP_BY_KIND = { bot_chat: 5_000 }
const EXPRESSIVE_COOLDOWN_MS = {
  ambient: 90_000,
  wildlife: 300_000,
  squirrel: 90_000,
  butterfly: 300_000,
  victory: 60_000,
  bedtime_suggest: 120_000,
}
let lastExpressiveAt = 0
const lastExpressiveByKind = {}

function expressiveGateOpen (kind) {
  const now = Date.now()
  const gap = EXPRESSIVE_GLOBAL_GAP_BY_KIND[kind] ?? EXPRESSIVE_GLOBAL_GAP_MS
  if (now - lastExpressiveAt < gap) return false
  if (now - (lastExpressiveByKind[kind] || 0) < (EXPRESSIVE_COOLDOWN_MS[kind] ?? 0)) return false
  return true
}

// Speak one expressive line through the gate. Returns false (silently) if the
// gate is closed — callers don't need their own timing bookkeeping.
function speakExpressive (kind, line, { me = false } = {}) {
  if (!line || !expressiveGateOpen(kind)) return false
  const now = Date.now()
  lastExpressiveAt = now
  lastExpressiveByKind[kind] = now
  bot.chat(me ? `/me ${line}` : line)
  return true
}

// Rolling tail of recent chat — fed to the LLM so generated lines react to
// what is actually being said, and can PASS when the topic has moved on.
const recentChat = []
function rememberRecentChat (username, message) {
  recentChat.push(`<${username}> ${message}`)
  if (recentChat.length > 8) recentChat.shift()
}

function describeTimeOfDay () {
  const t = bot.time?.timeOfDay
  if (typeof t !== 'number') return 'an unknown hour'
  if (t < 1000) return 'dawn'
  if (t < 11000) return 'daytime'
  if (t < 13500) return 'dusk'
  return 'night'
}

function describeWhereabouts () {
  if (insideHouse()) return 'inside the house'
  if (inPen()) return 'in the sheep pen'
  if (inWheatField()) return 'standing in the wheat field'
  return 'outside on the farm'
}

function buildExpressiveContext (situation) {
  const parts = []
  parts.push(`It is ${describeTimeOfDay()}${bot.isRaining ? ' and raining' : ''}. You are ${describeWhereabouts()}.`)
  if (worldContext) parts.push(`Shared world facts for grounding. Use these facts naturally when relevant; do not recite them as a list. Avoid inventing conflicting details.\n${worldContext}`)
  // Vitals and pockets, so questions like "how are you", "where are you",
  // "what are you carrying" get answered truthfully, in voice — these were
  // scripted handlers before the 2026-06-11 router refactor.
  parts.push(`Your vitals: HP ${bot.health?.toFixed(0) ?? '?'}/20, food ${bot.food ?? '?'}/20, deaths this session: ${deathCount}. Position: ${bot.entity ? posStr(bot.entity.position) : 'unknown'}.`)
  const inv = (bot.inventory?.items() || []).sort((a, b) => b.count - a.count).slice(0, 5).map(i => `${i.count}× ${i.name}`)
  parts.push(inv.length ? `Carrying: ${inv.join(', ')}.` : 'Your pockets are empty.')
  if (activeTask.name) parts.push(`You are in the middle of: ${activeTask.name}.`)
  if (sustainState.active) parts.push('You are the one keeping the fire going (the autonomous wheat → bio-fuel loop).')
  if (followTarget) parts.push(`You are following ${followTarget} around.`)
  const others = Object.keys(bot.players || {}).filter(n => n !== bot.username)
  if (others.length) parts.push(`Also on the server: ${others.join(', ')}.`)
  if (recentChat.length) parts.push(`Recent chat:\n${recentChat.join('\n')}`)
  parts.push(situation)
  return parts.join('\n\n')
}

// /me lines render in chat as "~<name> <line>", so the line must read as a
// third-person stage direction ("watches a cloud drift overhead"). The models
// drift into first-person persona exclamations ("Good heavens! Observe!"),
// which render as nonsense ("Muse Observe!") — so the prompt states the format
// and asActionText() verifies the render before anything reaches chat.
function actionTextFormatNote () {
  return `Format: your line renders as action text after your name — chat will show "~${bot.username} <your line>". Write ONE short third-person stage direction that completes that sentence: start with a lowercase present-tense verb ("watches...", "frets over...", "recalculates..."). Stay in persona through word choice, not exclamations. No first person, no quotation marks, no exclamation openers, and never include your own name.`
}

function asActionText (line) {
  let t = line.trim().replace(/^["'`*~]+|["'`*~]+$/g, '').trim()
  t = t.replace(new RegExp(`^${bot.username}[:,]?\\s+`, 'i'), '') // model echoed the name
  t = t.replace(/^\/me\s+/i, '')
  if (!t) return null
  // First-person openers and vocative interjections can't follow "~Name " —
  // drop the line rather than print gibberish.
  if (/^(i|i'm|i've|i'd|i'll|me|my|we|oh|ah|alas|heavens|good|dear|behold|observe|what|did|was|by|please|attention)\b/i.test(t)) return null
  return t[0].toLowerCase() + t.slice(1)
}

// One expressive impulse: check the gate, optionally wait (the generation
// happens AT FIRE TIME, after the wait, so the context already contains any
// chat that arrived meanwhile — stale lines are never written), generate from
// the persona spec, speak through the gate. The model may PASS; Ollama being
// down means silence. Returns whether a line was spoken.
async function impulseExpressive (kind, situation, { me = false, delayMs = 0 } = {}) {
  if (!expressiveGateOpen(kind)) return false
  if (delayMs) {
    await sleep(delayMs)
    if (!expressiveGateOpen(kind)) return false // something else spoke while we waited
  }
  const gen = () => llm.generateLine({
    system: personaSpec.systemPrompt,
    exemplars: personaSpec.exemplars,
    context: buildExpressiveContext(me ? `${situation}\n\n${actionTextFormatNote()}` : situation),
  })
  let line = await gen()
  if (!line) return false
  if (me) {
    let action = asActionText(line)
    if (!action) {
      const retry = await gen()
      action = retry ? asActionText(retry) : null
    }
    if (!action) {
      logEvent(kind, `dropped non-action line: ${line}`)
      return false
    }
    line = action
  }
  const spoken = speakExpressive(kind, line, { me })
  if (spoken) logEvent(kind, line)
  return spoken
}

// ── Ambient /me actions ──────────────────────────────────────────────────────
// Quiet signs of inner life: fidgets, observations, pondering. Uses /me so they
// render as action text and don't trigger conversational responses from other bots.
// Independent of stand-down mode — a bot standing still is the ideal time for these.

const AMBIENT_ACTION_MIN_MS = 180_000
const AMBIENT_ACTION_MAX_MS = 420_000
let ambientActionTimerId = null




async function tryAmbientAction () {
  if (activeTask.name !== null) return
  if (bot.isSleeping) return
  if (goInsideBusy || penTraversalBusy) return
  if (!idleWanderEnabled) return // "stand down" silences ambient chatter too
  if (!expressiveGateOpen('ambient')) return
  if (Math.random() < 0.4 && await tryWildlifeComment()) return
  const ambientLocation = insideHouse()
    ? 'You are inside the house. You can see: walls, beds, chests, the furnace, a door. You CANNOT see the sheep, the wheat field, the sky, the sun, clouds, or wildlife from here.'
    : inPen()
      ? 'You are in the sheep pen. You can see: sheep, the fence, grass, the sky. You cannot see the wheat field or the house interior from here.'
      : inWheatField()
        ? 'You are standing in the wheat field. You can see: wheat rows, the sky, the farmhouse in the distance. You cannot see the sheep pen or the house interior from here.'
        : 'You are outside on the open farm. You can see: the farmhouse, the field, the sky, trees. You cannot see the house interior from here.'
  await impulseExpressive('ambient',
    `${ambientLocation} Nothing in particular is happening — a quiet moment. Offer one small idle action or passing thought, written as action text (it renders after your name, like "watches a cloud drift overhead"). Only reference things you can actually see from where you are.`,
    { me: true })
}


// Unknown-entity wildlife classification. Modded ambient mobs (squirrels,
// butterflies, birds...) all report empty names, and the farm is ringed with
// empty-name entities that never move (decorations, resting butterflies) —
// so movement between watcher samples is the gate: no displacement, no
// wildlife. Movers in the air are butterflies/birds; movers on the ground
// are squirrels. One comment per individual, ever-greens pruned.
const UNKNOWN_WILDLIFE_MOVE_BLOCKS = 1.5    // min horizontal travel between samples
const SQUIRREL_DART_BLOCKS = 3              // squirrels dart; butterflies drift
const BUTTERFLY_FLUTTER_DY = 0.5            // vertical wobble between samples
const WILDLIFE_TRACK_STALE_MS = 60_000
const WILDLIFE_COMMENT_DEDUPE_MS = 600_000  // one comment per individual per 10 min
const unknownEntityTracks = new Map()       // id -> { x, y, z, at }
const wildlifeCommentedAt = new Map()       // id -> last comment timestamp

function isAirborneEntity (e) {
  const below = bot.blockAt(e.position.floored().offset(0, -1, 0))
  return !!below && below.name === 'air'
}

function classifyUnknownEntity (e, now) {
  const prev = unknownEntityTracks.get(e.id)
  unknownEntityTracks.set(e.id, { x: e.position.x, y: e.position.y, z: e.position.z, at: now })
  if (!prev) return null
  const moved = Math.hypot(e.position.x - prev.x, e.position.z - prev.z)
  const flutter = Math.abs(e.position.y - prev.y)
  if (moved < UNKNOWN_WILDLIFE_MOVE_BLOCKS && flutter < BUTTERFLY_FLUTTER_DY) return null
  if (e.position.y > bot.entity.position.y + 2) return 'butterfly'  // well overhead
  if (moved >= SQUIRREL_DART_BLOCKS) return 'squirrel'              // darting = ground critter
  return (flutter >= BUTTERFLY_FLUTTER_DY || isAirborneEntity(e)) ? 'butterfly' : 'squirrel'
}

function getWildlifeNearby () {
  if (!bot.entity) return null
  const now = Date.now()
  const found = []
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity) continue
    const d = e.position.distanceTo(bot.entity.position)
    if (d > 16) continue
    if (e.name === 'wolf') found.push({ type: 'wolf', dist: d })
    else if (e.name === 'sheep') found.push({ type: 'sheep', dist: d })
    else if (!e.name && e.type !== 'player' && e.type !== 'object' && d < 12 &&
             e.position.y >= bot.entity.position.y - 2 && e.position.y <= bot.entity.position.y + 8) {
      const type = classifyUnknownEntity(e, now)
      if (!type) continue
      if (now - (wildlifeCommentedAt.get(e.id) || 0) < WILDLIFE_COMMENT_DEDUPE_MS) continue
      found.push({ type, dist: d, id: e.id })
    }
  }
  for (const [id, t] of unknownEntityTracks) {
    if (now - t.at > WILDLIFE_TRACK_STALE_MS) unknownEntityTracks.delete(id)
  }
  for (const [id, t] of wildlifeCommentedAt) {
    if (now - t > WILDLIFE_COMMENT_DEDUPE_MS) wildlifeCommentedAt.delete(id)
  }
  if (!found.length) return null
  found.sort((a, b) => a.dist - b.dist)
  return found[0]
}

async function tryWildlifeComment () {
  if (!idleWanderEnabled) return false
  if (insideHouse()) return false
  if (!expressiveGateOpen('wildlife')) return false
  const wildlife = getWildlifeNearby()
  if (!wildlife) return false
  if (wildlife.id) wildlifeCommentedAt.set(wildlife.id, Date.now())
  return impulseExpressive('wildlife',
    `A ${wildlife.type} is nearby, about ${Math.round(wildlife.dist)} blocks away. React to seeing it, as action text.`,
    { me: true })
}

let squirrelWatcherId = null

async function checkSquirrelNearby () {
  if (!bot.entity) return
  if (bot.isSleeping) return
  if (!idleWanderEnabled) return
  if (insideHouse()) return
  // Detect before gating: getWildlifeNearby refreshes the movement tracks,
  // which need a sample every tick for displacement to mean anything.
  const wildlife = getWildlifeNearby()
  if (!wildlife || (wildlife.type !== 'squirrel' && wildlife.type !== 'butterfly')) return
  if (!expressiveGateOpen(wildlife.type)) return
  wildlifeCommentedAt.set(wildlife.id, Date.now())
  const prompt = wildlife.type === 'squirrel'
    ? `A squirrel just darted past, about ${Math.round(wildlife.dist)} blocks away. React to it, as action text.`
    : `A butterfly just fluttered by, about ${Math.round(wildlife.dist)} blocks away. React to it, as action text.`
  await impulseExpressive(wildlife.type, prompt, { me: true })
}

function startSquirrelWatcher () {
  if (squirrelWatcherId) return
  squirrelWatcherId = setInterval(() => {
    checkSquirrelNearby().catch(e => logEvent('squirrel', `impulse error: ${e.message}`))
  }, 7_000)
  logEvent('squirrel-watcher', 'started, checking every 7s')
}

function stopSquirrelWatcher () {
  if (squirrelWatcherId) { clearInterval(squirrelWatcherId); squirrelWatcherId = null }
}

function startAmbientActionTimer () {
  if (ambientActionTimerId) return
  function scheduleNext () {
    const delay = AMBIENT_ACTION_MIN_MS + Math.random() * (AMBIENT_ACTION_MAX_MS - AMBIENT_ACTION_MIN_MS)
    ambientActionTimerId = setTimeout(() => {
      tryAmbientAction().catch(e => logEvent('ambient', `impulse error: ${e.message}`))
      scheduleNext()
    }, delay)
  }
  scheduleNext()
  logEvent('ambient-action', 'timer started, interval 90–240s')
}

function stopAmbientActionTimer () {
  if (ambientActionTimerId) { clearTimeout(ambientActionTimerId); ambientActionTimerId = null }
}

// Wheat-ready alert mode. This is intentionally louder than ambient chatter:
// when every known wheat tile is mature, remind nearby humans until one
// of them acknowledges the alert. The snooze resets only after the field stops
// being fully mature, so the next growth cycle can alert again.
const WHEAT_CROP_ROWS = [
  { label: 'north field north rows', xMin: NORTH_FIELD_BOUNDS.xMin, xMax: NORTH_FIELD_BOUNDS.xMax, zs: [551, 552, 553] },
  { label: 'north field south rows', xMin: NORTH_FIELD_BOUNDS.xMin, xMax: NORTH_FIELD_BOUNDS.xMax, zs: [555, 556, 557] },
  { label: 'south field north rows', xMin: FIELD_BOUNDS.xMin, xMax: FIELD_BOUNDS.xMax, zs: [559, 560, 561] },
  { label: 'south field south rows', xMin: FIELD_BOUNDS.xMin, xMax: FIELD_BOUNDS.xMax, zs: [563, 564, 565] },
]
const WHEAT_READY_CHECK_MS = 5000
const WHEAT_READY_ALERT_MS = 120000
const WHEAT_READY_LINES = [
  'The wheat is fully grown and ready for harvest.',
  'Harvest reminder: the wheat is ready.',
  'Tiny farming bulletin: every wheat row looks ready.',
  'The field is golden. That means harvest time.',
  'Wheat status: ripe, waiting, dramatically patient.',
  'By the way, the wheat is ready for harvest.',
  'Fully grown wheat detected. Very agricultural. Very urgent.',
  'The wheat has finished its little sun-powered project.',
]
const WHEAT_READY_NIGHT_LINES = [
  'It is bedtime now, but the wheat is ready for harvest in the morning.',
  'Night has arrived. The wheat is ready, though. Morning job.',
  'Sleep first, harvest later. The wheat is fully grown.',
  'The wheat is ready, but so are the beds. Morning harvest recommended.',
]
const WHEAT_SNOOZE_ACK_LINES = [
  'Got it. Wheat alert snoozed until the next growth cycle.',
  'Acknowledged. I will stop announcing the wheat until it grows again.',
  'Copy that. Wheat bulletin paused.',
  'Understood. The wheat and I will be quietly mature now.',
]
const wheatReadyState = {
  ready: false,
  snoozed: false,
  lastAlertAt: 0,
  timer: null,
  lastScan: null,
}

function scanKnownWheatFields (fieldFilter = null) {
  if (!bot.entity) return { ready: false, expected: 0, wheat: 0, mature: 0, loaded: 0 }
  let expected = 0
  let loaded = 0
  let wheat = 0
  let mature = 0
  for (const section of WHEAT_CROP_ROWS) {
    if (fieldFilter && !section.label.startsWith(`${fieldFilter} field`)) continue
    for (const z of section.zs) {
      for (let x = section.xMin; x <= section.xMax; x++) {
        expected++
        const block = bot.blockAt(new Vec3(x, 64, z))
        if (!block) continue
        loaded++
        if (block.name !== 'wheat') continue
        wheat++
        if (block.metadata === 7) mature++
      }
    }
  }
  const maturePct = expected > 0 ? (mature / expected) * 100 : 0
  return {
    ready: expected > 0 && loaded === expected && wheat === expected && mature === expected,
    expected, loaded, wheat, mature, maturePct,
  }
}

function knownWheatTilePositions () {
  const tiles = []
  for (const section of WHEAT_CROP_ROWS) {
    for (const z of section.zs) {
      for (let x = section.xMin; x <= section.xMax; x++) {
        tiles.push({ x, y: 64, z, section: section.label })
      }
    }
  }
  return tiles
}

function findBareWheatTiles () {
  const bare = []
  for (const tile of knownWheatTilePositions()) {
    const cropBlock = bot.blockAt(new Vec3(tile.x, tile.y, tile.z))
    const below = bot.blockAt(new Vec3(tile.x, tile.y - 1, tile.z))
    if (!below || below.name !== 'farmland') continue
    if (!cropBlock || cropBlock.name === 'air') {
      bare.push({ ...tile, reason: !cropBlock ? 'unloaded_or_air' : 'air' })
      continue
    }
    if (['tallgrass', 'deadbush'].includes(cropBlock.name)) {
      bare.push({ ...tile, reason: `replaceable:${cropBlock.name}` })
    }
  }
  return bare
}

async function repairBareWheatTilesFromFieldVisit ({ announce = true, limit = 108 } = {}) {
  if (!inWheatField()) return { repaired: 0, bare: 0, skipped: 'not_in_field' }

  const bare = findBareWheatTiles().slice(0, limit)
  if (!bare.length) return { repaired: 0, bare: 0 }

  const seedItem = bot.inventory.items().find(i => i.name === 'wheat_seeds' || i.name === 'seeds')
  if (!seedItem) {
    if (announce) logEvent('wheat-repair', `bare=${bare.length} no seeds`)
    logEvent('wheat-repair', `bare=${bare.length} no seeds`)
    return { repaired: 0, bare: bare.length, noSeeds: true }
  }

  if (announce) logEvent('wheat-repair', `replanting ${bare.length} bare tile(s)`)
  logEvent('wheat-repair', `start bare=${bare.length}`)

  let repaired = 0
  try {
    for (const tile of bare) {
      await pathTo({ x: tile.x, y: tile.y, z: tile.z }, 1, 5000)
      await sleep(150)

      const freshCrop = bot.blockAt(new Vec3(tile.x, tile.y, tile.z))
      const freshBelow = bot.blockAt(new Vec3(tile.x, tile.y - 1, tile.z))
      if (!freshBelow || freshBelow.name !== 'farmland') continue
      if (freshCrop && freshCrop.name === 'wheat') continue
      if (freshCrop && freshCrop.name !== 'air' && !['tallgrass', 'deadbush'].includes(freshCrop.name)) {
        logEvent('wheat-repair', `skip ${tile.x},${tile.y},${tile.z}: occupied by ${freshCrop.name}`)
        continue
      }

      const seeds = bot.inventory.items().find(i => i.name === 'wheat_seeds' || i.name === 'seeds')
      if (!seeds) {
        logEvent('wheat-repair', 'ran out of seeds')
        break
      }

      try {
        await bot.equip(seeds, 'hand')
        await bot.placeBlock(freshBelow, new Vec3(0, 1, 0))
        repaired++
        logEvent('wheat-repair', `replanted ${tile.x},${tile.y},${tile.z}`)
        await sleep(250)
      } catch (e) {
        const afterFail = bot.blockAt(new Vec3(tile.x, tile.y, tile.z))
        if (afterFail && afterFail.name === 'wheat') {
          repaired++
          logEvent('wheat-repair', `replanted ${tile.x},${tile.y},${tile.z} despite timeout`)
        } else {
          logEvent('wheat-repair', `plant fail ${tile.x},${tile.y},${tile.z}: ${e.message}`)
        }
      }
    }
  } finally {
    await clearHand()
  }

  if (announce) logEvent('wheat-repair', `done repaired=${repaired}/${bare.length}`)
  logEvent('wheat-repair', `done repaired=${repaired}/${bare.length}`)
  return { repaired, bare: bare.length }
}


let proactiveRepairBusy = false
setInterval(async () => {
  if (proactiveRepairBusy) return
  if (activeTask.name) return
  if (isBedtime()) return
  if (insideHouse() || inPen()) return
  if (Date.now() - lastFieldRepairAt < FIELD_WANDER_REPAIR_COOLDOWN_MS) return
  const bare = findBareWheatTiles()
  if (!bare.length) return
  proactiveRepairBusy = true
  logEvent('wheat-repair', `proactive scan found ${bare.length} bare tile(s)`)
  try {
    if (!inWheatField()) {
      const pt = WHEAT_FIELD_STAND_POINTS[Math.floor(Math.random() * WHEAT_FIELD_STAND_POINTS.length)]
      await pathTo(pt, 1, 8000)
    }
    if (inWheatField()) await repairBareWheatTilesFromFieldVisit({ announce: true })
  } catch (e) {
    if (e.name !== 'AbortError') logEvent('wheat-repair', `proactive repair failed: ${e.message}`)
  }
  proactiveRepairBusy = false
}, 15 * 1000)

function pickWheatReadyLine () {
  const pool = isBedtime()
    ? withPersonaSlot(WHEAT_READY_NIGHT_LINES, 'wheatReadyNight')
    : withPersonaSlot(WHEAT_READY_LINES, 'wheatReady')
  return pickAvoidingRecentPhrase(pool)
}

function snoozeWheatReadyAlerts (username = 'someone') {
  if (!wheatReadyState.ready || wheatReadyState.snoozed) return false
  wheatReadyState.snoozed = true
  wheatReadyState.lastAlertAt = 0
  const pool = withPersonaSlot(WHEAT_SNOOZE_ACK_LINES, 'wheatSnoozeAck')
  bot.chat(pool[Math.floor(Math.random() * pool.length)])
  logEvent('wheat-alert', `snoozed by ${username}`)
  return true
}

function tryWheatReadyAlert () {
  const scan = scanKnownWheatFields()
  wheatReadyState.lastScan = scan
  if (!scan.ready) {
    if (wheatReadyState.ready) logEvent('wheat-alert', `reset: mature=${scan.mature}/${scan.expected} wheat=${scan.wheat}/${scan.expected} loaded=${scan.loaded}/${scan.expected}`)
    wheatReadyState.ready = false
    wheatReadyState.snoozed = false
    wheatReadyState.lastAlertAt = 0
    return
  }

  if (!wheatReadyState.ready) {
    wheatReadyState.ready = true
    wheatReadyState.snoozed = false
    wheatReadyState.lastAlertAt = 0
    logEvent('wheat-alert', `ready: mature=${scan.mature}/${scan.expected}`)
  }

  if (wheatReadyState.snoozed) return
  const now = Date.now()
  if (now - wheatReadyState.lastAlertAt < WHEAT_READY_ALERT_MS) return
  wheatReadyState.lastAlertAt = now
  bot.chat(pickWheatReadyLine())
}

function startWheatReadyWatcher () {
  if (wheatReadyState.timer) return
  wheatReadyState.timer = setInterval(() => {
    try { tryWheatReadyAlert() } catch (e) { logEvent('wheat-alert', `error: ${e.message}`) }
  }, WHEAT_READY_CHECK_MS)
  logEvent('wheat-alert', `watching ${WHEAT_CROP_ROWS.reduce((sum, s) => sum + (s.xMax - s.xMin + 1) * s.zs.length, 0)} wheat tiles`)
}

// Order a list of {x,z} tiles into a counter-clockwise nautilus starting
// from the SE corner (max x, max z): walk west along the south edge, north
// along the west edge, east along the north edge, south along the east edge,
// then spiral inward. Tiles not in the bounding box are appended at the end
// so we never silently drop one. Used by runHarvestRightClick to walk the
// field in the canonical nautilus pattern.
function orderNautilusCCW (tiles) {
  if (!tiles.length) return []
  const set = new Set(tiles.map(t => `${t.x},${t.z}`))
  const byKey = new Map(tiles.map(t => [`${t.x},${t.z}`, t]))
  const xs = tiles.map(t => t.x); const zs = tiles.map(t => t.z)
  let xMin = Math.min(...xs), xMax = Math.max(...xs)
  let zMin = Math.min(...zs), zMax = Math.max(...zs)
  const order = []
  const seen = new Set()
  const visit = (x, z) => {
    const k = `${x},${z}`
    if (set.has(k) && !seen.has(k)) {
      order.push(byKey.get(k))
      seen.add(k)
    }
  }
  while (xMin <= xMax && zMin <= zMax) {
    // South edge: walk west (max x → min x) at z = zMax
    for (let x = xMax; x >= xMin; x--) visit(x, zMax)
    zMax--
    if (zMin > zMax) break
    // West edge: walk north (max z → min z) at x = xMin
    for (let z = zMax; z >= zMin; z--) visit(xMin, z)
    xMin++
    if (xMin > xMax) break
    // North edge: walk east (min x → max x) at z = zMin
    for (let x = xMin; x <= xMax; x++) visit(x, zMin)
    zMin++
    if (zMin > zMax) break
    // East edge: walk south (min z → max z) at x = xMax
    for (let z = zMin; z <= zMax; z++) visit(xMax, z)
    xMax--
  }
  // Safety: append any tile we somehow missed.
  for (const t of tiles) {
    const k = `${t.x},${t.z}`
    if (!seen.has(k)) order.push(t)
  }
  return order
}

// Right-click harvest: activate_block on each wheat tile. The Forge mod
// handles harvest+replant in one action — we do not dig, do not place_block,
// do not filter by metadata (immature is a safe no-op). Drops mostly land in
// inventory but some still hit the ground when the bot activates from 2-3
// blocks away, so a full-coverage sweep of the harvested half follows.
//
// Walking pattern: counter-clockwise nautilus from the SE corner. Confirmed
// 2026-05-14 (per the journal) as the user-preferred path — it minimizes
// total walking distance and keeps the bot near each drop it generates.
async function runHarvestRightClick ({ half = 'all', user, autoDeposit = null, keepSeeds = false, skipDeposit = false } = {}) {
  const taskCheck = startTask('harvest', half)
  if (!taskCheck.allowed) { bot.chat(`Busy with ${taskCheck.current} — one thing at a time.`); return }
  const myGen = abortGen
  try {
    const startDeaths = deathCount

    // If it's nighttime or bedtime, sleep first then start fresh in the morning.
    const t = bot.time || {}
    if (!t.isDay || isBedtime()) {
      await yieldToBedtime(myGen)
      if (deathCount > startDeaths) throw new Error('died during pre-harvest sleep')
    }

    const halfLabel = half === 'all' ? 'both fields'
      : half === 'north-field' ? 'the north field'
      : half === 'south-field' ? 'the south field'
      : `the ${half} half`
    bot.chat(pickLine(withPersonaSlot(HARVEST_START_LINES, 'harvestStart'), { userTag: user ? ' ' + user + ',' : '', half: halfLabel }))
    logEvent('harvest-rc', `start half=${half} startDeaths=${startDeaths}`)

    if (insideHouse()) {
      logEvent('harvest-rc', 'inside house — exiting first')
      await runGoOutside('wheat')
      if (deathCount > startDeaths) throw new Error('died exiting house')
      if (insideHouse()) {
        logEvent('harvest-rc', 'still inside after exit attempt — aborting')
        logEvent('harvest-rc', 'still inside after exit attempt — aborting')
        return
      }
    }

    // Travel: detour around the tree, then to the target field center.
    await pathTo(HARVEST_WAYPOINTS.field_east_approach, 1)
    const targetCenter = (half === 'north-field')
      ? HARVEST_WAYPOINTS.north_field_center
      : HARVEST_WAYPOINTS.field_center
    await pathTo(targetCenter, 1)
    if (deathCount > startDeaths) throw new Error('died en route')

    const mcData = require('minecraft-data')(bot.version)
    const wheatId = mcData.blocksByName.wheat?.id
    if (wheatId === undefined) throw new Error('wheat block id unknown')
    const wheatCountBefore = bot.inventory.items()
      .filter(i => i.name === 'wheat').reduce((s, i) => s + i.count, 0)

    const SWEEP_ZS = {
      'north': [559, 560, 561],
      'south': [563, 564, 565],
      'south-field': [559, 560, 561, 563, 564, 565],
      'north-field': [555, 556, 557, 551, 552, 553],
    }

    async function harvestAndSweepField (fieldHalf, label) {
      let fieldWheat = bot.findBlocks({ matching: wheatId, maxDistance: 32, count: 400 })
      fieldWheat = filterByHalf(fieldWheat, fieldHalf)
      logEvent('harvest-rc', `found ${fieldWheat.length} wheat tiles in ${fieldHalf}`)
      if (!fieldWheat.length) {
        logEvent('harvest-rc', `no wheat tiles in ${label}`)
        return { activated: 0, harvested: 0 }
      }
      fieldWheat = orderNautilusCCW(fieldWheat)
      logEvent('harvest-rc', `right-clicking ${fieldWheat.length} tiles in ${label}`)

      let activated = 0
      let harvested = 0
      for (let i = 0; i < fieldWheat.length; i++) {
        const pos = fieldWheat[i]
        try { await pathTo({ x: pos.x, y: pos.y, z: pos.z }, 1, 5000) }
        catch (e) { logEvent('harvest-rc', `pathfind miss ${pos.x},${pos.z}: ${e.message}`); continue }

        const before = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
        if (!before || before.name !== 'wheat') continue
        const wasMature = before.metadata === 7
        try {
          await bot.activateBlock(before)
          activated++
          if (wasMature) {
            const after = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
            if (after && after.name === 'wheat' && (after.metadata ?? 7) < 7) harvested++
          }
        } catch (e) { logEvent('harvest-rc', `activate fail ${pos.x},${pos.z}: ${e.message}`) }

        if ((i + 1) % 10 === 0) {
          checkAbort(myGen)
          if (deathCount > startDeaths) throw new Error('died mid-harvest')
          if (bot.health != null && bot.health < 10) throw new Error(`HP low (${bot.health}) — aborting`)
          if (autoSleepEnabled && isBedtime()) {
            logEvent('harvest-rc', `bedtime at tile ${i + 1}/${fieldWheat.length} in ${fieldHalf}`)
            await yieldToBedtime(myGen)
            if (deathCount > startDeaths) throw new Error('died during bedtime yield')
            await pathTo(targetCenter, 1)
          }
        }
      }
      logEvent('harvest-rc', `${fieldHalf}: activated=${activated} harvested=${harvested}`)

      logEvent('harvest-rc', `${label}: activated=${activated} harvested=${harvested} — sweeping`)
      const sweepZs = SWEEP_ZS[fieldHalf]
      let sweepIdx = 0
      for (const z of sweepZs) {
        const xs = (sweepIdx % 2 === 0)
          ? [-279,-280,-281,-282,-283,-284,-285,-286,-287]
          : [-287,-286,-285,-284,-283,-282,-281,-280,-279]
        sweepIdx++
        for (const x of xs) {
          checkAbort(myGen)
          if (deathCount > startDeaths) throw new Error('died during sweep')
          await pathTo({ x, y: 64, z }, 1, 4000)
        }
      }
      return { activated, harvested }
    }

    let totalActivated = 0
    let totalHarvested = 0
    if (half === 'all') {
      const r1 = await harvestAndSweepField('north-field', 'the north field')
      totalActivated += r1.activated; totalHarvested += r1.harvested
      if (deathCount > startDeaths) throw new Error('died between fields')
      const r2 = await harvestAndSweepField('south-field', 'the south field')
      totalActivated += r2.activated; totalHarvested += r2.harvested
    } else {
      const r = await harvestAndSweepField(half, halfLabel)
      totalActivated = r.activated; totalHarvested = r.harvested
    }

    // Toss trash while still outside. Wheat is kept on hand (no chest deposit)
    // so it's ready for the next task; the bot stays outside where the sweep ended.
    await tossTrash()
    const wheatOnHand = bot.inventory.items()
      .filter(i => i.name === 'wheat')
      .reduce((s, i) => s + i.count, 0)
    const gained = wheatOnHand - wheatCountBefore
    bot.chat(pickLine(withPersonaSlot(HARVEST_DONE_LINES, 'harvestDone'), { dug: totalHarvested, gained, onhand: wheatOnHand }))
    logEvent('harvest-rc', `activated=${totalActivated} harvested=${totalHarvested} gained=${gained} onhand=${wheatOnHand} kept-on-hand`)

    // Ask where the wheat should go — hopper or chest. No answer in 30s → keep it.
    if (wheatOnHand > 0 && !skipDeposit) {
      let dest
      if (autoDeposit) {
        dest = autoDeposit // sustain loop: skip the question, feed the hopper directly
        logEvent('harvest-rc', `auto-deposit wheat → ${dest} (${wheatOnHand})`)
      } else {
        { const pool = withPersonaSlot(WHEAT_ASK_LINES, 'wheatAsk'); bot.chat(pool[Math.floor(Math.random() * pool.length)]) }
        logEvent('harvest-rc', `asking user: hopper or chest? (${wheatOnHand} wheat)`)
        dest = await waitForChatReply((username, msg) => {
          if (/\bhopper\b/i.test(msg)) return 'hopper'
          if (/\b(chest|stash|store|deposit|box)\b/i.test(msg)) return 'chest'
          return undefined
        }, 30000)
      }

      if (dest === 'hopper' || dest === 'chest') {
        try {
          await ensureInsideHouse()
          if (deathCount > startDeaths) throw new Error('died entering house')
          await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
          const target = dest === 'hopper' ? HOPPER : HARVEST_WAYPOINTS.kitchen_chest
          const r = await depositQuickMove('wheat', target, { keep: 0 })
          if (r.backedUp) {
            logEvent('harvest-rc', `${dest} backed up: deposited=${r.deposited} remaining=${r.remaining} rounds=${r.rounds}`)
          } else {
            logEvent('harvest-rc', `deposited ${r.deposited} wheat to ${dest} (quick-move, ${r.rounds} rounds)`)
          }
        } catch (e) {
          logEvent('harvest-rc', `${dest} deposit failed: ${e.message} — keeping wheat`)
          logEvent('harvest-rc', `${dest} deposit failed: ${e.message}`)
        }
      } else {
        logEvent('harvest-rc', 'no reply after 30s, keeping wheat on hand')
        logEvent('harvest-rc', 'no reply after 30s, keeping wheat on hand')
      }
    }

    if (!keepSeeds) {
      try {
        if (countOnHand('wheat_seeds') > 7) {
          await runDepositNamed(['wheat_seeds'])
        }
      } catch (e) {
        logEvent('harvest-rc', `seed overflow deposit failed: ${e.message}`)
      }
    }
  } finally {
    endTask(activeTask.name)
    bot.pathfinder.setGoal(null)
    await clearHand()
  }
}

// Craft plant balls from surplus wheat seeds at the project bench.
// 8-seed ring (perimeter slots 0,1,2,3,5,6,7,8; center 4 empty).
// The bench computes output on GUI-open, not on placement, so each craft is:
// place ring → close → reopen → take output from slot 28.
const BENCH_POS = { x: -270, y: 65, z: 569 }
const BENCH_RING_SLOTS = [0, 1, 2, 3, 5, 6, 7, 8]
const BENCH_OUTPUT_SLOT = 28
const BENCH_PLAYER_INV_START = 29 // bench has 29 own slots (0-28)

function openBench () {
  return new Promise((resolve, reject) => {
    const benchBlock = bot.blockAt(new Vec3(BENCH_POS.x, BENCH_POS.y, BENCH_POS.z))
    if (!benchBlock) return reject(new Error('bench block not loaded'))
    const timeout = setTimeout(() => {
      bot.removeListener('windowOpen', onOpen)
      reject(new Error('bench window did not open in 3s'))
    }, 3000)
    const onOpen = (win) => {
      clearTimeout(timeout)
      resolve(win)
    }
    bot.once('windowOpen', onOpen)
    bot.activateBlock(benchBlock).catch(e => {
      clearTimeout(timeout)
      bot.removeListener('windowOpen', onOpen)
      reject(e)
    })
  })
}

async function craftPlantBalls ({ keepSeeds = 16, maxBalls = 15 } = {}) {
  const seedsOnHand = countOnHand('wheat_seeds')
  const craftable = Math.min(Math.floor((seedsOnHand - keepSeeds) / 8), maxBalls)
  if (craftable <= 0) {
    logEvent('craft', `not enough seeds: ${seedsOnHand} on hand, keeping ${keepSeeds}`)
    return { crafted: 0 }
  }
  logEvent('craft', `crafting up to ${craftable} plant balls from ${seedsOnHand} seeds (keeping ${keepSeeds})`)

  await ensureInsideHouse()
  await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
  let crafted = 0
  for (let i = 0; i < craftable; i++) {
    let win
    try { win = await openBench() } catch (e) {
      logEvent('craft', `bench open fail: ${e.message}`)
      break
    }
    await sleep(200)

    const seedStack = win.items().find(it => it.name === 'wheat_seeds' && it.slot >= BENCH_PLAYER_INV_START)
    if (!seedStack || seedStack.count < 8) {
      win.close()
      logEvent('craft', `no seed stack >= 8 in bench window`)
      break
    }

    try {
      await bot.clickWindow(seedStack.slot, 0, 0)
      await sleep(150)
      for (const slot of BENCH_RING_SLOTS) {
        await bot.clickWindow(slot, 1, 0)
        await sleep(100)
      }
      await bot.clickWindow(seedStack.slot, 0, 0)
      await sleep(150)
    } catch (e) {
      logEvent('craft', `ring placement error: ${e.message}`)
      try { await bot.clickWindow(-999, 0, 0) } catch (_) {}
      win.close()
      break
    }

    win.close()
    await sleep(600)

    let win2
    try { win2 = await openBench() } catch (e) {
      logEvent('craft', `bench reopen fail: ${e.message}`)
      break
    }
    await sleep(200)

    const output = win2.slots[BENCH_OUTPUT_SLOT]
    if (!output) {
      logEvent('craft', `no output at slot ${BENCH_OUTPUT_SLOT} after reopen (ball #${i + 1})`)
      win2.close()
      break
    }

    try {
      await bot.clickWindow(BENCH_OUTPUT_SLOT, 0, 0)
      await sleep(150)
      let dest = -1
      for (let s = BENCH_PLAYER_INV_START; s < win2.slots.length; s++) {
        const it = win2.slots[s]
        if (it && it.name === 'unknown' && it.count < 64) { dest = s; break }
      }
      if (dest < 0) {
        for (let s = BENCH_PLAYER_INV_START; s < win2.slots.length; s++) {
          if (!win2.slots[s]) { dest = s; break }
        }
      }
      if (dest < 0) {
        await bot.clickWindow(-999, 0, 0)
        logEvent('craft', 'inventory full, dropped plant ball')
        win2.close()
        break
      }
      await bot.clickWindow(dest, 0, 0)
      await sleep(150)
    } catch (e) {
      logEvent('craft', `take output error: ${e.message}`)
      try { await bot.clickWindow(-999, 0, 0) } catch (_) {}
      win2.close()
      break
    }
    win2.close()
    await sleep(200)
    crafted++
  }
  // Clean leftover seeds off the bench grid (two-click: pick up, place in player inv)
  try {
    const cleanWin = await openBench()
    await sleep(200)
    for (let s = 0; s <= 8; s++) {
      const item = cleanWin.slots[s]
      if (item && item.name === 'wheat_seeds') {
        try {
          await bot.clickWindow(s, 0, 0) // pick up
          await sleep(150)
          let dest = -1
          for (let d = BENCH_PLAYER_INV_START; d < cleanWin.slots.length; d++) {
            const it = cleanWin.slots[d]
            if (it && it.name === 'wheat_seeds' && it.count + item.count <= 64) { dest = d; break }
          }
          if (dest < 0) {
            for (let d = BENCH_PLAYER_INV_START; d < cleanWin.slots.length; d++) {
              if (!cleanWin.slots[d]) { dest = d; break }
            }
          }
          if (dest >= 0) {
            await bot.clickWindow(dest, 0, 0)
            await sleep(150)
          } else {
            await bot.clickWindow(s, 0, 0) // put back if no room
            await sleep(150)
          }
        } catch (_) {}
      }
    }
    cleanWin.close()
    await sleep(200)
  } catch (e) {
    logEvent('craft', `bench cleanup failed: ${e.message}`)
  }

  logEvent('craft', `crafted ${crafted} plant balls, seeds remaining: ${countOnHand('wheat_seeds')}`)
  return { crafted }
}

// "Keep the fire going" — autonomous sustain loop. Watches the wheat field;
// when it's fully mature, harvests both halves, feeds wheat + plant balls into
// the bio-fuel [[house-hopper]], then waits for regrowth and repeats — until
// told to "chill" / "stand down" / "stop". The harvest is the existing
// one-at-a-time, bedtime-aware task; this loop is a thin supervisor that holds
// NO task between cycles, so the bot stays responsive while it waits.
const SUSTAIN_POLL_MS = 5000
const SUSTAIN_KEEP_WHEAT = 16
const SUSTAIN_KEEP_SEEDS = 0
// Sustain should convert every full group of 8 seeds into plant balls.
// Only the natural remainder (0–7 seeds) stays in inventory for the next cycle.
const SUSTAIN_MAX_PLANT_BALLS = Number.POSITIVE_INFINITY
const SUSTAIN_HOPPER_CHECK_INTERVAL = 6
const sustainState = { active: false, cycles: 0, startedBy: null, lastCycleDay: -1, role: null }

async function feedHopperOneAtATime (waitMs) {
  await ensureInsideHouse()
  await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
  const hopperBlock = bot.blockAt(new Vec3(HOPPER.x, HOPPER.y, HOPPER.z))
  if (!hopperBlock) { logEvent('sustain-hopper', 'hopper block not loaded'); return false }

  for (let fed = 0; fed < 7; fed++) {
    if (!sustainState.active) return false
    if (countOnHand('wheat') < 1) {
      logEvent('sustain-hopper', `out of wheat after ${fed} fed`)
      return false
    }
    const win = await bot.openContainer(hopperBlock)
    const slots = win.slots.slice(0, win.slots.length - 36)
    const hasBalls = slots.some(s => s && s.name === 'unknown')
    if (!hasBalls) {
      logEvent('sustain-hopper', `hopper clear after ${fed} wheat`)
      win.close()
      return true
    }
    const containerSize = win.slots.length - 36
    const playerSlots = win.slots.slice(containerSize)
    const srcIdx = playerSlots.findIndex(s => s && s.name === 'wheat')
    if (srcIdx === -1) { win.close(); return false }
    const winSlot = containerSize + srcIdx
    const count = playerSlots[srcIdx].count
    await bot.clickWindow(winSlot, 1, 0)
    await bot.clickWindow(1, 1, 0)
    if (count > 2) await bot.clickWindow(winSlot, 0, 0)
    else if (count === 2) {
      const emptyIdx = playerSlots.findIndex((s, i) => i !== srcIdx && !s)
      if (emptyIdx !== -1) await bot.clickWindow(containerSize + emptyIdx, 0, 0)
      else await bot.clickWindow(winSlot, 0, 0)
    }
    win.close()
    logEvent('sustain-hopper', `fed wheat ${fed + 1}/7, waiting ${waitMs / 1000}s`)
    await sustainWait(waitMs)
  }
  const win2 = await bot.openContainer(hopperBlock)
  const finalSlots = win2.slots.slice(0, win2.slots.length - 36)
  const stillJammed = finalSlots.some(s => s && s.name === 'unknown')
  win2.close()
  return !stillJammed
}

async function clearJammedHopper () {
  if (countOnHand('wheat') < 1) {
    logEvent('sustain-hopper', 'no wheat on hand to clear jam')
    return false
  }
  const cleared = await feedHopperOneAtATime(20000)
  if (cleared) {
    logEvent('sustain-hopper', 'hopper cleared on first pass (20s waits)')
    return true
  }
  logEvent('sustain-hopper', 'first pass failed — retrying with 30s waits')
  logEvent('sustain-hopper', 'first pass failed — retrying with 30s waits')
  const cleared2 = await feedHopperOneAtATime(30000)
  if (cleared2) {
    logEvent('sustain-hopper', 'hopper cleared on second pass (30s waits)')
  } else {
    logEvent('sustain-hopper', 'hopper still jammed after both passes — giving up')
    logEvent('sustain-hopper', 'hopper still jammed after both passes')
  }
  return cleared2
}

const SUSTAIN_START_LINES = [
  { text: 'Keeping the fire going. The town stays warm tonight.',                 weight: (s) => s.charm + s.focus },
  { text: 'Tending the field. I will feed the bio-fuel line until you say chill.', weight: (s) => s.focus + 5 },
  { text: "On it — harvest, feed the hopper, repeat. The engines won't go hungry.", weight: (s) => s.focus + s.charm },
  { text: 'Keeping the embers lit. Back to the wheat whenever it ripens.',        weight: (s) => s.curiosity + s.charm },
]
const SUSTAIN_CYCLE_DONE_LINES = [
  { text: 'Wheat and plant balls in the hopper. Waiting on the next crop.',       weight: (s) => s.focus + 5 },
  { text: 'Another load for the bio-fuel line. Letting the field regrow.',        weight: (s) => s.focus + s.patience },
  { text: 'Hopper fed — wheat plus fresh plant balls. Watching it come back.',    weight: (s) => s.patience + s.curiosity },
  { text: "Seeds into fuel, wheat into fuel. Standing watch for the regrowth.",   weight: (s) => s.charm + s.patience },
]
const SUSTAIN_STOP_LINES = [
  { text: 'Letting the fire die down. Standing by.',                          weight: (s) => s.patience + 5 },
  { text: 'Easing off the field. The town has enough for now.',               weight: (s) => s.charm + s.patience },
  { text: 'Done tending the wheat. Resting the embers.',                      weight: (s) => s.curiosity + s.patience },
  { text: 'Stepping back from the harvest. Call me when you need the fire again.', weight: (s) => s.charm },
]

// ── Multi-bot fire-duty coordination ────────────────────────────────────────
// Bots run as separate processes (often separate machines); in-game chat is
// the only channel they all share. Field claims, roll calls, and stand-downs
// are persona-voiced lines that carry a parseable core. When several bots keep
// the fire at once, the first two split the fields (north/south) and any
// extras supervise from the field edge instead of triple-harvesting.
const FIRE_CLAIM_TTL_MS = 45 * 60 * 1000
const FIRE_ROLLCALL_WAIT_MS = 10000
const FIRE_ROLLCALL_RE = /\bwho(?:'s| is)?\b[^.!?]*\bfire\b/i
const FIRE_CLAIM_RE_A = /\b(?:i(?:'ll| will| shall|'m| am|'ve got| have| got)|tak(?:e|ing)|claim(?:ing)?|cover(?:ing)?|hold(?:ing)?|work(?:ing)?)\b[^.!?]*\b(north|south)\s+field\b/i
const FIRE_CLAIM_RE_B = /\b(north|south)\s+field\b[^.!?]*\b(?:is mine|for me)\b/i
const FIRE_SUPERVISE_RE = /\bsupervis/i
const FIRE_STANDDOWN_RE = /\b(?:stand(?:ing)? down|stepping back|easing off|done tending|letting the fire (?:die|rest)|resting the embers|fire (?:duty|watch|patrol|operations?)[^.!?]*\b(?:over|ended|done|suspended|off)|ceas(?:e|ing) fire|sustain loop off|unattended fire|fire does not need me|off fire duty)\b/i
const FIRE_ROLLCALL_LINES = [
  { text: "Roll call — who's on fire duty already?",                                  weight: (s) => s.focus + 5 },
  { text: "Who is keeping the fire right now? Speak up so we don't double-harvest.",  weight: (s) => s.focus + s.charm },
  { text: "Before I start: who's already tending the fire?",                          weight: (s) => s.patience + s.focus },
]
const FIRE_CLAIM_NORTH_LINES = [
  { text: "I'll take the north field.",                                weight: (s) => s.focus + 5 },
  { text: "Taking the north field — it's mine until further notice.",  weight: (s) => s.focus + s.charm },
  { text: "I've got the north field covered.",                         weight: (s) => s.charm + s.focus },
]
const FIRE_CLAIM_SOUTH_LINES = [
  { text: "I'll take the south field.",                                weight: (s) => s.focus + 5 },
  { text: "Taking the south field — it's mine until further notice.",  weight: (s) => s.focus + s.charm },
  { text: "I've got the south field covered.",                         weight: (s) => s.charm + s.focus },
]
const FIRE_SUPERVISE_LINES = [
  { text: "Both fields are taken. I guess I'll supervise.",            weight: (s) => s.charm + 5 },
  { text: "Fields are covered — I'll supervise from over here.",       weight: (s) => s.patience + s.charm },
  { text: "No field left for me, so: supervising.",                    weight: (s) => s.snark + s.charm },
]
const fireCrew = new Map() // bot name (lowercase) -> { field: 'north'|'south'|'supervise', at }
let fireStartupRivals = null // Set<name>: bots that roll-called during our own startup wait
let fireStandDownAnnounced = false

function myFireName () { return (NICKNAME || bot.username || '').toLowerCase() }

function parseFireClaim (message) {
  const m = FIRE_CLAIM_RE_A.exec(message) || FIRE_CLAIM_RE_B.exec(message)
  return m ? m[1].toLowerCase() : null
}

function fireCrewExpire () {
  const now = Date.now()
  for (const [name, claim] of fireCrew) {
    if (now - claim.at > FIRE_CLAIM_TTL_MS) fireCrew.delete(name)
  }
}

function activeFireClaims () {
  fireCrewExpire()
  const claimed = new Set()
  for (const claim of fireCrew.values()) {
    if (claim.field === 'north' || claim.field === 'south') claimed.add(claim.field)
  }
  return claimed
}

function fireClaimLines (field) {
  return field === 'north'
    ? withPersonaSlot(FIRE_CLAIM_NORTH_LINES, 'sustainClaimNorth')
    : withPersonaSlot(FIRE_CLAIM_SOUTH_LINES, 'sustainClaimSouth')
}

function announceFireClaim (field) {
  sustainState.role = field
  bot.chat(pickLine(fireClaimLines(field)))
  logEvent('sustain', `claimed the ${field} field`)
}

function announceFireSupervise () {
  sustainState.role = 'supervise'
  bot.chat(pickLine(withPersonaSlot(FIRE_SUPERVISE_LINES, 'sustainSupervise')))
  logEvent('sustain', 'both fields claimed — supervising')
}

// One stand-down line per sustain run, whichever path stops it (stop command,
// stand down, ctl, loop error) — other bots parse it to free our field claim.
function announceFireStandDown () {
  if (fireStandDownAnnounced) return
  fireStandDownAnnounced = true
  try { bot.chat(pickLine(withPersonaSlot(SUSTAIN_STOP_LINES, 'sustainStop'))) } catch (_) {}
}

// Role choice at startup: free fields go in alphabetical order among
// simultaneous starters — everyone who roll-called inside everyone else's wait
// window computes the same assignment without further negotiation.
function pickFireRole () {
  const claimed = activeFireClaims()
  const free = ['north', 'south'].filter(f => !claimed.has(f))
  const rivals = [...(fireStartupRivals || [])].filter(n => !fireCrew.has(n))
  if (!claimed.size && !rivals.length) return 'solo'
  const ahead = rivals.filter(n => n < myFireName()).length
  return ahead < free.length ? free[ahead] : 'supervise'
}

function answerFireRollCall () {
  // Mid-startup our own roll call is in flight; the rival ordering in
  // pickFireRole already accounts for the newcomer.
  if (fireStartupRivals) return
  setTimeout(() => {
    if (!sustainState.active) return
    if (sustainState.role === 'solo') {
      // We were covering both fields; take north and let the newcomer have south.
      logEvent('sustain', 'roll call heard while solo — splitting, taking north')
      announceFireClaim('north')
    } else if (sustainState.role === 'north' || sustainState.role === 'south') {
      bot.chat(pickLine(fireClaimLines(sustainState.role)))
    }
  }, 1000 + Math.random() * 3000)
}

function resolveFireClaimConflict (name, field) {
  if (sustainState.role === 'solo') {
    // Someone claimed a field while we covered both — cede that half.
    announceFireClaim(field === 'north' ? 'south' : 'north')
    return
  }
  if (field !== sustainState.role) return
  if (myFireName() < name) {
    // Alphabetical tie-break: we keep the field; re-announce so they yield.
    setTimeout(() => {
      if (sustainState.active && sustainState.role === field) bot.chat(pickLine(fireClaimLines(field)))
    }, 1500 + Math.random() * 2500)
    return
  }
  // Yield: take the other field if it's free, otherwise supervise.
  setTimeout(() => {
    if (!sustainState.active || sustainState.role !== field) return
    const other = field === 'north' ? 'south' : 'north'
    if (!activeFireClaims().has(other)) announceFireClaim(other)
    else announceFireSupervise()
  }, 1000 + Math.random() * 2000)
}

function scheduleFirePromotion () {
  setTimeout(() => {
    if (!sustainState.active || sustainState.role !== 'supervise') return
    const claimed = activeFireClaims()
    const free = ['north', 'south'].filter(f => !claimed.has(f))
    if (free.length) {
      logEvent('sustain', `field freed — promoting from supervisor to ${free[0]}`)
      announceFireClaim(free[0])
    }
  }, 2000 + Math.random() * 4000)
}

// Parse other bots' chat for fire-duty coordination lines. Called for every
// bot-authored chat line, addressed to us or not — claims are tracked even
// while we're idle so a later "keep the fire going" starts informed.
function trackFireCoordination (username, message) {
  const name = String(username || '').toLowerCase()
  if (FIRE_STANDDOWN_RE.test(message)) {
    if (fireCrew.delete(name)) {
      logEvent('sustain', `${username} stood down from fire duty`)
      if (sustainState.active && sustainState.role === 'supervise') scheduleFirePromotion()
    }
    return
  }
  const field = parseFireClaim(message)
  if (field) {
    fireCrew.set(name, { field, at: Date.now() })
    logEvent('sustain', `${username} claimed the ${field} field`)
    if (sustainState.active) resolveFireClaimConflict(name, field)
    return
  }
  if (FIRE_SUPERVISE_RE.test(message)) {
    fireCrew.set(name, { field: 'supervise', at: Date.now() })
    return
  }
  if (FIRE_ROLLCALL_RE.test(message)) {
    if (fireStartupRivals) fireStartupRivals.add(name)
    else if (sustainState.active) answerFireRollCall()
  }
}

async function sustainWait (ms) {
  const steps = Math.max(1, Math.round(ms / 1000))
  for (let i = 0; i < steps && sustainState.active; i++) await sleep(1000)
}

// "Safe to act" gate for the sustain loop. Daytime, HP reasonable, not following.
function sustainSafe () {
  if (followTarget) return false
  if (isBedtime()) return false
  if (bot.health != null && bot.health < 10) return false
  return true
}

// Wait until safe to resume. Polls every 5s. Returns false if loop was stopped.
async function sustainWaitUntilSafe (reason) {
  if (sustainSafe()) return true
  logEvent('sustain', `pausing — ${reason}`)
  // Get inside first (but not during follow mode)
  try { if (!followTarget && !insideHouse()) await runGoInside() } catch (_) {}
  let logged = false
  while (sustainState.active && !sustainSafe()) {
    if (!logged) {
      logEvent('sustain', 'waiting inside until safe to resume')
      logged = true
    }
    await sustainWait(5000)
  }
  if (!sustainState.active) return false
  logEvent('sustain', 'safe again — resuming')
  return true
}

async function runSustainFarm (user) {
  if (sustainState.active) { bot.chat('Already keeping the fire going.'); return }
  sustainState.active = true
  sustainState.startedBy = user || null
  sustainState.cycles = 0
  sustainState.role = 'solo'
  fireStandDownAnnounced = false
  bot.chat(pickLine(withPersonaSlot(SUSTAIN_START_LINES, 'sustainStart')))
  logEvent('sustain', `started by ${user || 'someone'}`)

  // Crew handshake: ask who's already on fire duty, give existing keepers a
  // beat to re-announce their field claims, then take a free field — or
  // supervise when both fields are spoken for.
  fireCrewExpire()
  fireStartupRivals = new Set()
  bot.chat(pickLine(withPersonaSlot(FIRE_ROLLCALL_LINES, 'sustainRollCall')))
  await sustainWait(FIRE_ROLLCALL_WAIT_MS)
  const startRole = pickFireRole()
  fireStartupRivals = null
  if (sustainState.active) {
    if (startRole === 'north' || startRole === 'south') announceFireClaim(startRole)
    else if (startRole === 'supervise') announceFireSupervise()
    logEvent('sustain', `fire role: ${sustainState.role}`)
  }

  let polls = 0
  let supervisePosted = false
  let retryAfterInterrupt = false
  try {
    while (sustainState.active) {
      // Gate: wait for safe conditions (daytime, HP ok)
      if (!sustainSafe()) {
        if (!(await sustainWaitUntilSafe('unsafe conditions'))) break
        supervisePosted = false
      }

      // Supervisor: both fields are claimed by other bots. Stand by at the
      // field edge and watch for a freed field to promote into.
      if (sustainState.role === 'supervise') {
        const claimed = activeFireClaims()
        const freed = ['north', 'south'].filter(f => !claimed.has(f))
        if (freed.length) {
          logEvent('sustain', `field freed — promoting from supervisor to ${freed[0]}`)
          announceFireClaim(freed[0])
        } else if (!supervisePosted && !foodSafetyBusy) {
          try {
            if (insideHouse()) await runGoOutside()
            await pathTo(HARVEST_WAYPOINTS.field_east_approach, 2, 15000)
            supervisePosted = true
            logEvent('sustain', 'supervising from the field edge')
          } catch (e) {
            logEvent('sustain', `supervise repositioning failed: ${e.message}`)
          }
        }
        await sustainWait(SUSTAIN_POLL_MS)
        continue
      }

      const fieldFilter = (sustainState.role === 'north' || sustainState.role === 'south') ? sustainState.role : null
      const scan = scanKnownWheatFields(fieldFilter)
      if ((scan.maturePct >= 85 || (retryAfterInterrupt && scan.mature > 0)) && !foodSafetyBusy) {
        if (retryAfterInterrupt) logEvent('sustain', `resuming interrupted cycle — ${scan.mature} mature tiles remaining`)
        logEvent('sustain', `triggering cycle: maturePct=${scan.maturePct.toFixed(0)}% mature=${scan.mature} inside=${insideHouse()}`)
        retryAfterInterrupt = false
        sustainState.cycles++
        logEvent('sustain', `field ready (mature=${scan.mature}/${scan.expected}, ${scan.maturePct.toFixed(0)}%) — cycle ${sustainState.cycles}`)

        // Run the full cycle in a recoverable try — HP low, path failures,
        // door snags, etc. skip this cycle and retry next poll. Only AbortError
        // (explicit user stop) kills the loop.
        try {
          // 1. Harvest our claimed field — keep seeds on hand (no auto-deposit)
          await runHarvestRightClick({ half: fieldFilter ? `${fieldFilter}-field` : 'all', keepSeeds: true, skipDeposit: true })
          if (!sustainState.active) break

          // 1b. Eat if hungry — auto-eat can't fire during window ops, so give it
          // a window here before the hopper + bench sequence locks us in.
          if (bot.food != null && bot.food <= 14) {
            logEvent('sustain', `hungry (food=${bot.food}) — eating before deposit`)
            try { await bot.autoEat.eat() } catch (_) {}
            await sleep(500)
          }

          // 2. Deposit wheat to hopper (keep 16 for restock + engine clearing).
          // When two keepers finish their fields together, the south keeper
          // waits a beat so they don't pile up at the door and hopper.
          if (sustainState.role === 'south') await sustainWait(20000)
          await ensureInsideHouse()
          await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
          const wheatResult = await depositQuickMove('wheat', HOPPER, { keep: SUSTAIN_KEEP_WHEAT })
          logEvent('sustain', `wheat deposit: deposited=${wheatResult.deposited} remaining=${wheatResult.remaining}`)

          // 3. Craft plant balls from surplus seeds. Every full group of
          // 8 seeds becomes a plant ball; only the 0–7 remainder stays
          // in inventory for the next harvest cycle.
          const craftResult = await craftPlantBalls({ keepSeeds: SUSTAIN_KEEP_SEEDS, maxBalls: SUSTAIN_MAX_PLANT_BALLS })
          logEvent('sustain', `plant balls crafted: ${craftResult.crafted}; seeds remaining=${countOnHand('wheat_seeds')}`)

          // 4. Deposit plant balls to hopper
          if (craftResult.crafted > 0) {
            await ensureInsideHouse()
            await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
            const ballResult = await depositQuickMove('unknown', HOPPER, { keep: 0 })
            logEvent('sustain', `plant ball deposit: deposited=${ballResult.deposited} remaining=${ballResult.remaining}`)
          }

          // 4b. Do NOT deposit leftover seeds. They are fuel ingredients.
          // After full crafting, only 0–7 seeds should remain; those stay
          // in the bot inventory and combine with the next harvest. If more
          // than 7 remain, log it as a crafting anomaly instead of stashing them.
          const seedsAfterCraft = countOnHand('wheat_seeds')
          if (seedsAfterCraft > 7) {
            logEvent('sustain', `warning: ${seedsAfterCraft} seeds remain after plant-ball craft; keeping in inventory`)
          }

          if (!sustainState.active) break

          // 5. Eat if hungry — the hopper + bench windows blocked auto-eat for
          // the entire deposit/craft sequence. Top off now so the bot stays fed
          // through the regrowth wait.
          if (bot.food != null && bot.food <= 14) {
            logEvent('sustain', `hungry after cycle (food=${bot.food}) — eating`)
            try { await bot.autoEat.eat() } catch (_) {}
            await sleep(500)
          }

          sustainState.lastCycleDay = bot.time?.day ?? -1
          bot.chat(pickLine(withPersonaSlot(SUSTAIN_CYCLE_DONE_LINES, 'sustainCycleDone')))
        } catch (e) {
          if (e.name === 'AbortError' && !sustainState.active) {
            logEvent('sustain', `cycle ${sustainState.cycles} abort + inactive — breaking loop`)
            break
          }
          logEvent('sustain', `cycle ${sustainState.cycles} failed (recoverable): ${e.message} [type=${e.name} active=${sustainState.active}]`)
          retryAfterInterrupt = true
          logEvent('sustain', `cycle failed — will retry when field reaches 85% again`)
          try { if (!followTarget && !insideHouse()) await runGoInside() } catch (_) {}
        }
        // Clear food-safety cooldown so tryFoodSafety can run during the poll wait.
        // The sustain cycle opens hopper + bench windows which keep resetting the 30s
        // cooldown — without this, food safety is blocked for the entire sustain run.
        foodSafetyWindowCooldownUntil = 0
      } else {
        polls++
        if (polls % 20 === 0) {
          logEvent('sustain', `waiting (mature=${scan.mature}/${scan.expected} loaded=${scan.loaded})`)
        }
        // Jam-watch duty belongs to one keeper (solo or north) so two bots
        // never feed clearing wheat into the hopper at the same time.
        if (polls % SUSTAIN_HOPPER_CHECK_INTERVAL === 0 && (sustainState.role === 'solo' || sustainState.role === 'north') && sustainSafe() && !foodSafetyBusy && countOnHand('wheat') >= 1) {
          try {
            const hopperBlock = bot.blockAt(new Vec3(HOPPER.x, HOPPER.y, HOPPER.z))
            if (hopperBlock) {
              await ensureInsideHouse()
              await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
              const win = await bot.openContainer(hopperBlock)
              const slots = win.slots.slice(0, win.slots.length - 36)
              const hasBalls = slots.some(s => s && s.name === 'unknown')
              const hasWheat = slots.some(s => s && s.name === 'wheat')
              win.close()
              const currentDay = bot.time?.day ?? -1
              if (hasBalls && !hasWheat && currentDay > sustainState.lastCycleDay) {
                logEvent('sustain-hopper', `plant balls jammed — feeding wheat to clear (day ${currentDay}, last cycle day ${sustainState.lastCycleDay})`)
                await clearJammedHopper()
              }
            }
          } catch (e) {
            logEvent('sustain-hopper', `check failed: ${e.message}`)
          }
        }
      }
      await sustainWait(SUSTAIN_POLL_MS)
    }
  } catch (e) {
    logEvent('sustain', `loop error: ${e.message}`)
    logEvent('sustain', `loop error: ${e.message}`)
  } finally {
    sustainState.active = false
    announceFireStandDown()
    sustainState.role = null
    logEvent('sustain', `stopped after ${sustainState.cycles} cycle(s)`)
  }
}

// Harvest potatoes from the south patch — legacy left-click + replant +
// sweep technique. Right-click harvest works on potatoes too (confirmed
// 2026-05-14, see journal/procedures/harvest-potatoes-right-click.md);
// this routine remains the chat default for `harvest potatoes` until a
// `runHarvestPotatoesRightClick` is wired in.
//
// Single patch, no halves. Dug potatoes serve as their own seed tubers,
// so the replant step equips "potato" and places on the farmland below
// each harvested tile. Deposits to the kitchen chest at the end.
async function runHarvestPotatoes ({ user } = {}) {
  const taskCheck = startTask('harvest_potatoes')
  if (!taskCheck.allowed) { bot.chat(`Busy with ${taskCheck.current} — one thing at a time.`); return }
  const myGen = abortGen
  try {
    const startDeaths = deathCount

    const t = bot.time || {}
    if (!t.isDay || isBedtime()) {
      await yieldToBedtime(myGen)
      if (deathCount > startDeaths) throw new Error('died during pre-harvest sleep')
    }

    logEvent('harvest-potato', `start startDeaths=${startDeaths}`)

    // Exit first if indoors.
    if (insideHouse()) {
      await runGoOutside('potatoes')
      if (deathCount > startDeaths) throw new Error('died exiting house')
    }

    // Travel. The potato patch is south-west of the wheat field; pathfinder
    // routes around the pond on its own from outside_orientation.
    await pathTo(HARVEST_WAYPOINTS.potato_approach, 1, 12000)
    if (deathCount > startDeaths) throw new Error('died en route')

    // Find mature potatoes (metadata 7). filterByHalf doesn't apply here.
    const mcData = require('minecraft-data')(bot.version)
    const potatoId = mcData.blocksByName.potatoes?.id
    if (potatoId === undefined) throw new Error('potatoes block id unknown')
    const allPotatoes = bot.findBlocks({ matching: potatoId, maxDistance: 20, count: 100 })
    const maturePotatoes = allPotatoes.filter(p => {
      const b = bot.blockAt(new Vec3(p.x, p.y, p.z))
      return b && b.name === 'potatoes' && b.metadata === 7
    })
    logEvent('harvest-potato', `found ${allPotatoes.length} potatoes, ${maturePotatoes.length} mature`)
    if (!maturePotatoes.length) {
      logEvent('harvest-potato', `no mature potatoes (${allPotatoes.length} growing)`)
      // Even if none mature, come home rather than leaving bot outside.
      if (!insideHouse()) await runGoInside().catch(() => {})
      return
    }
    logEvent('harvest-potato', `harvesting ${maturePotatoes.length} mature potatoes`)

    const potatoCountBefore = bot.inventory.items()
      .filter(i => i.name === 'potato').reduce((s, i) => s + i.count, 0)

    // Dig loop with HP / hostile checks every 5 (patch is small).
    let attempted = 0, dug = 0
    const farmlandBelow = []  // (x, y-1, z) for replant
    for (let i = 0; i < maturePotatoes.length; i++) {
      const pos = maturePotatoes[i]
      const b = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
      if (!b || b.name !== 'potatoes') continue
      attempted++
      try {
        await bot.dig(b)
        const after = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
        if (after && after.name !== 'potatoes') {
          dug++
          farmlandBelow.push({ x: pos.x, y: pos.y - 1, z: pos.z })
        }
      } catch (e) {
        logEvent('harvest-potato', `dig fail ${pos.x},${pos.y},${pos.z}: ${e.message}`)
      }
      if ((i + 1) % 5 === 0) {
        checkAbort(myGen)
        if (deathCount > startDeaths) throw new Error('died mid-harvest')
        if (bot.health != null && bot.health < 10) throw new Error(`HP low (${bot.health}) — aborting`)
        if (autoSleepEnabled && isBedtime()) {
          logEvent('harvest-potato', `bedtime at tile ${i + 1}/${maturePotatoes.length}`)
          await yieldToBedtime(myGen)
          if (deathCount > startDeaths) throw new Error('died during bedtime yield')
          await pathTo(HARVEST_WAYPOINTS.potato_approach, 1, 12000)
        }
      }
    }
    logEvent('harvest-potato', `attempted ${attempted}, broke ${dug}`)

    // Sweep the patch to collect drops.
    logEvent('harvest-potato', `dug=${dug} — sweeping for drops`)
    for (const pt of POTATO_SWEEP_POINTS) {
      checkAbort(myGen)
      if (deathCount > startDeaths) throw new Error('died during sweep')
      await pathTo(pt, 0, 5000)
    }

    // Replant — equip potato, place on each farmland tile.
    if (dug > 0) {
      try {
        await bot.equip(
          bot.inventory.items().find(i => i.name === 'potato'),
          'hand',
        )
      } catch (e) {
        logEvent('harvest-potato', `equip potato failed: ${e.message}`)
      }
      let replanted = 0
      for (let i = 0; i < farmlandBelow.length; i++) {
        checkAbort(myGen)
        const pos = farmlandBelow[i]
        try {
          // Need a potato in hand each time; re-equip if something auto-ate.
          const held = bot.inventory.items().find(i => i.name === 'potato')
          if (!held) break
          await bot.equip(held, 'hand')
          const ref = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
          if (!ref || ref.name !== 'farmland') continue
          await bot.placeBlock(ref, new Vec3(0, 1, 0))
          replanted++
        } catch (e) {
          logEvent('harvest-potato', `replant ${pos.x},${pos.y},${pos.z}: ${e.message}`)
        }
        if ((i + 1) % 5 === 0 && i + 1 < farmlandBelow.length) {
          const next = farmlandBelow[i + 1]
          await pathTo({ x: next.x, y: next.y + 1, z: next.z }, 2, 5000)
        }
      }
      logEvent('harvest-potato', `replanted ${replanted}/${farmlandBelow.length}`)
    }

    await tossTrash()
    await ensureInsideHouse()
    if (deathCount > startDeaths) throw new Error('died entering house')

    // Deposit potatoes to kitchen chest (vanilla item, registry-safe).
    await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
    try {
      const chestBlock = bot.blockAt(new Vec3(
        HARVEST_WAYPOINTS.kitchen_chest.x,
        HARVEST_WAYPOINTS.kitchen_chest.y,
        HARVEST_WAYPOINTS.kitchen_chest.z,
      ))
      if (!chestBlock) throw new Error('kitchen chest not reachable')
      const win = await bot.openContainer(chestBlock)
      const potatoItems = bot.inventory.items().filter(i => i.name === 'potato')
      const potatoOnHand = potatoItems.reduce((s, i) => s + i.count, 0)
      const gained = potatoOnHand - potatoCountBefore
      let deposited = 0
      // Keep a handful on hand for re-planting next time (up to 8); deposit rest.
      const keep = Math.min(8, potatoOnHand)
      let toDeposit = potatoOnHand - keep
      for (const it of potatoItems) {
        if (toDeposit <= 0) break
        const take = Math.min(it.count, toDeposit)
        try {
          await win.deposit(it.type, it.metadata, take)
          deposited += take
          toDeposit -= take
        } catch (e) {
          logEvent('harvest-potato', `deposit fail: ${e.message}`)
          break
        }
      }
      win.close()
      logEvent('harvest-potato', `done: dug=${dug} gained=${gained} deposited=${deposited} kept=${potatoOnHand - deposited}`)
      logEvent('harvest-potato', `dug=${dug} gained=${gained} deposited=${deposited}`)
    } catch (e) {
      logEvent('harvest-potato', `deposit failed: ${e.message}`)
    }
  } finally {
    endTask(activeTask.name)
    bot.pathfinder.setGoal(null)
    await clearHand()
  }
}

// Right-click harvest for the potato patch — same technique as
// runHarvestRightClick but for potatoes. Confirmed 2026-05-14: activate_block
// on a mature potato yields drops AND replants in one action; immature is a
// no-op. Patch lies along the east shore of an oval pond, so we clip to
// x >= -286 to keep the bot out of the water (see journal place note
// water-hazard-west-of-potatoes.md).
async function runHarvestPotatoesRightClick ({ user, then = null, maxTiles = Infinity } = {}) {
  const taskCheck = startTask('harvest_potatoes_rc')
  if (!taskCheck.allowed) { bot.chat(`Busy with ${taskCheck.current} — one thing at a time.`); return }
  const myGen = abortGen
  try {
    const startDeaths = deathCount

    const t = bot.time || {}
    if (!t.isDay || isBedtime()) {
      await yieldToBedtime(myGen)
      if (deathCount > startDeaths) throw new Error('died during pre-harvest sleep')
    }

    logEvent('harvest-potato-rc', `start startDeaths=${startDeaths}`)

    if (insideHouse()) {
      logEvent('harvest-potato-rc', 'inside house — exiting first')
      await runGoOutside('potatoes')
      if (deathCount > startDeaths) throw new Error('died exiting house')
      if (insideHouse()) {
        logEvent('harvest-potato-rc', 'still inside after exit attempt — aborting')
        return
      }
    }

    await pathTo(HARVEST_WAYPOINTS.potato_approach, 1, 12000)
    if (deathCount > startDeaths) throw new Error('died en route')

    const mcData = require('minecraft-data')(bot.version)
    const potatoId = mcData.blocksByName.potatoes?.id
    if (potatoId === undefined) throw new Error('potatoes block id unknown')

    // Find every potato block in the area, then clip to the water-safe column
    // (x >= -286). Do NOT filter by metadata — immature is a safe no-op.
    let allPotatoes = bot.findBlocks({ matching: potatoId, maxDistance: 24, count: 200 })
    const SAFE_X_MIN = -286
    allPotatoes = allPotatoes.filter(p => p.x >= SAFE_X_MIN)
    logEvent('harvest-potato-rc', `found ${allPotatoes.length} water-safe potato tiles`)
    if (!allPotatoes.length) {
      logEvent('harvest-potato-rc', 'no potatoes in safe zone')
      return
    }
    // Boustrophedon order by z (small patch, no need for nautilus).
    allPotatoes.sort((a, b) => a.z - b.z || a.x - b.x)
    const byZ = new Map()
    for (const p of allPotatoes) {
      if (!byZ.has(p.z)) byZ.set(p.z, [])
      byZ.get(p.z).push(p)
    }
    let ordered = []
    let i = 0
    for (const z of [...byZ.keys()].sort((a,b) => a - b)) {
      const row = byZ.get(z)
      row.sort((a, b) => a.x - b.x)
      ordered.push(...(i++ % 2 === 0 ? row : row.slice().reverse()))
    }
    if (maxTiles < ordered.length) {
      logEvent('harvest-potato-rc', `capping ${ordered.length} tiles to maxTiles=${maxTiles}`)
      ordered = ordered.slice(0, maxTiles)
    }
    logEvent('harvest-potato-rc', `right-clicking ${ordered.length} potato tiles`)

    const potatoCountBefore = bot.inventory.items()
      .filter(it => it.name === 'potato').reduce((s, it) => s + it.count, 0)

    let activated = 0
    let harvested = 0
    for (let i = 0; i < ordered.length; i++) {
      const pos = ordered[i]
      try { await pathTo({ x: Math.max(pos.x, SAFE_X_MIN), y: pos.y, z: pos.z }, 1, 5000) }
      catch (e) { logEvent('harvest-potato-rc', `pathfind miss ${pos.x},${pos.z}: ${e.message}`); continue }

      const before = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
      if (!before || before.name !== 'potatoes') continue
      const wasMature = before.metadata === 7
      try {
        await bot.activateBlock(before)
        activated++
        if (wasMature) {
          const after = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
          if (after && after.name === 'potatoes' && (after.metadata ?? 7) < 7) harvested++
        }
      } catch (e) { logEvent('harvest-potato-rc', `activate fail ${pos.x},${pos.z}: ${e.message}`) }

      if ((i + 1) % 10 === 0) {
        checkAbort(myGen)
        if (deathCount > startDeaths) throw new Error('died mid-harvest')
        if (bot.health != null && bot.health < 10) throw new Error(`HP low (${bot.health}) — aborting`)
        if (autoSleepEnabled && isBedtime()) {
          logEvent('harvest-potato-rc', `bedtime at tile ${i + 1}/${ordered.length}`)
          await yieldToBedtime(myGen)
          if (deathCount > startDeaths) throw new Error('died during bedtime yield')
          await pathTo(HARVEST_WAYPOINTS.potato_approach, 1, 12000)
        }
      }
    }
    logEvent('harvest-potato-rc', `activated=${activated} harvested=${harvested}`)

    // Full-coverage sweep over the same boustrophedon. Drops can land on the
    // ground when the bot activates from 2-3 blocks away.
    logEvent('harvest-potato-rc', `activated=${activated} harvested=${harvested} — sweeping`)
    for (const pos of ordered) {
      checkAbort(myGen)
      if (deathCount > startDeaths) throw new Error('died during sweep')
      await pathTo({ x: Math.max(pos.x, SAFE_X_MIN), y: pos.y, z: pos.z }, 1, 4000)
    }

    await tossTrash()
    if (!insideHouse()) {
      await runGoInside()
      if (deathCount > startDeaths) throw new Error('died entering house')
    }

    const potatoItems = bot.inventory.items().filter(i => i.name === 'potato')
    const onHand = potatoItems.reduce((s, it) => s + it.count, 0)
    const gained = onHand - potatoCountBefore
    logEvent('harvest-potato-rc', `done: activated=${activated} gained=${gained} onHand=${onHand}`)

    if (onHand <= 0) {
      logEvent('harvest-potato-rc', 'no raw potatoes to deal with')
    } else if (then === 'bake') {
      // Autonomous run (food-safety): no prompt. Keep the raw potatoes on hand;
      // the caller runs the bake step next (a separate task — baking can't start
      // while this harvest task is still held).
      logEvent('harvest-potato-rc', `auto-bake: ${onHand} potatoes`)
      logEvent('harvest-potato-rc', `auto-bake: keeping ${onHand} potatoes for bake step`)
    } else {
      const potatoPool = withPersonaSlot(POTATO_ASK_LINES, 'potatoAsk'); const askLine = potatoPool[Math.floor(Math.random() * potatoPool.length)]
      bot.chat(askLine)
      logEvent('harvest-potato-rc', `asking user: bake or stash? (${onHand} potatoes)`)

      const answer = await waitForChatReply((username, msg) => {
        if (/\b(bake|cook|roast|smelt|furnace|fire)\b/i.test(msg)) return 'bake'
        if (/\b(stash|chest|store|put|deposit|away)\b/i.test(msg)) return 'stash'
        return undefined
      }, 60000)

      if (answer === 'bake') {
        logEvent('harvest-potato-rc', `user said bake — handing off to runBakePotatoes`)
        await runBakePotatoes({ user })
      } else if (answer === 'stash') {
        logEvent('harvest-potato-rc', `user said stash — depositing ${onHand} potatoes`)
        try {
          await ensureInsideHouse()
          await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
          const chestBlock = bot.blockAt(new Vec3(
            HARVEST_WAYPOINTS.kitchen_chest.x,
            HARVEST_WAYPOINTS.kitchen_chest.y,
            HARVEST_WAYPOINTS.kitchen_chest.z,
          ))
          if (!chestBlock) throw new Error('kitchen chest not reachable')
          const win = await bot.openContainer(chestBlock)
          const items = bot.inventory.items().filter(i => i.name === 'potato')
          let deposited = 0
          for (const it of items) {
            try { await win.deposit(it.type, it.metadata, it.count); deposited += it.count } catch (e) { break }
          }
          win.close()
          logEvent('harvest-potato-rc', `stashed ${deposited} potatoes`)
        } catch (e) {
          logEvent('harvest-potato-rc', `stash failed: ${e.message}`)
        }
      } else {
        logEvent('harvest-potato-rc', 'no reply — keeping potatoes')
        logEvent('harvest-potato-rc', `no reply after 60s, keeping potatoes in inventory`)
      }
    }
  } finally {
    endTask(activeTask.name)
    bot.pathfinder.setGoal(null)
    await clearHand()
  }
}

// Bake any raw potatoes in inventory using the kitchen furnace.
// Assumes the user keeps fuel (charcoal) topped up in the furnace's fuel
// slot — we don't add fuel. Smelts in batches: put all potatoes in, wait
// for the output to populate, take it out, deposit extras to the kitchen
// chest (keeping up to 8 baked potatoes on hand for auto-eat).
async function runBakePotatoes ({ user } = {}) {
  const taskCheck = startTask('bake_potatoes')
  if (!taskCheck.allowed) { bot.chat(`Busy with ${taskCheck.current} — one thing at a time.`); return }
  try {
    // Must be inside to reach the furnace.
    if (!insideHouse()) {
      await runGoInside()
      if (deathCount > 0) { /* just log, don't abort on pre-existing deaths */ }
    }

    // Pull any raw potatoes out of the kitchen chest first. The user keeps
    // raw potatoes in the chest after harvest (per the deposit step in
    // runHarvestPotatoesRightClick), so "bake the potatoes" means
    // chest → furnace, not just inventory → furnace.
    let withdrawn = 0
    try {
      await ensureInsideHouse()
      await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 8000)
      const chestBlock = bot.blockAt(new Vec3(
        HARVEST_WAYPOINTS.kitchen_chest.x,
        HARVEST_WAYPOINTS.kitchen_chest.y,
        HARVEST_WAYPOINTS.kitchen_chest.z,
      ))
      if (chestBlock) {
        const win = await bot.openContainer(chestBlock)
        try {
          // Find every potato stack in the chest portion of the window.
          // The chest portion is win.slots[0..containerSize-1].
          const containerSize = win.slots.length - 36
          const potatoSlots = []
          for (let s = 0; s < containerSize; s++) {
            const it = win.slots[s]
            if (it && it.name === 'potato') potatoSlots.push(s)
          }
          for (const s of potatoSlots) {
            const it = win.slots[s]
            if (!it) continue
            try {
              await win.withdraw(it.type, it.metadata, it.count)
              withdrawn += it.count
            } catch (e) {
              logEvent('bake-potato', `withdraw fail slot ${s}: ${e.message}`)
              break
            }
          }
        } finally { win.close() }
      }
    } catch (e) {
      logEvent('bake-potato', `chest-withdraw skip: ${e.message}`)
    }

    const potatoItems = bot.inventory.items().filter(i => i.name === 'potato')
    const raw = potatoItems.reduce((s, i) => s + i.count, 0)
    if (raw === 0) {
      logEvent('bake-potato', 'no raw potatoes to bake')
      return
    }
    if (withdrawn > 0) {
      logEvent('bake-potato', `pulled ${withdrawn} from chest, baking ${raw}`)
    } else {
      logEvent('bake-potato', `baking ${raw}`)
    }
    logEvent('bake-potato', `start raw=${raw} withdrawn=${withdrawn}`)

    // Move within reach of the furnace (~4 blocks).
    bot.pathfinder.setGoal(new goals.GoalNear(
      HARVEST_WAYPOINTS.furnace.x, HARVEST_WAYPOINTS.furnace.y, HARVEST_WAYPOINTS.furnace.z, 2,
    ))
    for (let i = 0; i < 16; i++) {
      await sleep(500)
      if (!bot.pathfinder.isMoving()) break
    }

    const furnaceBlock = bot.blockAt(new Vec3(
      HARVEST_WAYPOINTS.furnace.x, HARVEST_WAYPOINTS.furnace.y, HARVEST_WAYPOINTS.furnace.z,
    ))
    if (!furnaceBlock) throw new Error('furnace block not loaded')

    // Put all raw potatoes into the input slot.
    let put = 0
    {
      const f = await bot.openFurnace(furnaceBlock)
      try {
        const fuel = f.fuelItem()
        if (!fuel || fuel.count < 1) {
          // Let the smelt begin anyway — user may have wood queued via the mod —
          // but warn in chat so they know to refill if nothing bakes.
          logEvent('bake-potato', 'furnace low on fuel — baking anyway')
        }
        // `bot.inventory.items()` is stable across furnace open.
        const toSmelt = bot.inventory.items().filter(i => i.name === 'potato')
        for (const it of toSmelt) {
          try {
            await f.putInput(it.type, null, it.count)
            put += it.count
          } catch (e) {
            logEvent('bake-potato', `putInput fail for ${it.count}: ${e.message}`)
            break
          }
        }
      } finally {
        f.close()
      }
    }
    if (put === 0) throw new Error('could not put potatoes in furnace')
    logEvent('bake-potato', `put=${put}`)

    // Potato smelt ≈ 10s each on this server. Don't block on it — the furnace
    // cooks on its own whether the bot stays or not. Record when the batch will
    // be done and walk away; the collect watcher (tryCollectBake) picks it up
    // later when the bot is free. This frees the bot to harvest wheat or idle
    // during a long bake instead of standing at the furnace for ~13 min.
    const SECS_PER_ITEM = 10
    const BUFFER_SECS = 8
    pendingBake.active = true
    pendingBake.doneAt = Date.now() + (put * SECS_PER_ITEM + BUFFER_SECS) * 1000
    const waitMin = ((pendingBake.doneAt - Date.now()) / 60000).toFixed(1)
    logEvent('bake-potato', `${put} potatoes baking (~${waitMin} min)`)
    logEvent('bake-potato', `started put=${put} doneAt=+${waitMin}min (non-blocking — collect later)`)
  } catch (e) {
    logEvent('bake-potato-error', e.message)
    logEvent('bake-potato', `aborted: ${e.message}`)
  } finally {
    endTask(activeTask.name)
    bot.pathfinder.setGoal(null)
  }
}

// ── Food safety: keep the bots stocked with baked potatoes ──────────────────
// If the baked-potato supply drops below foodSafetyMin and the bot is idle,
// safe, and it's daytime, autonomously harvest the potato patch and bake the
// crop — keeping the baked output on hand (it's food, never stashed). Runs as a
// background watcher off the same 5s timer as auto-sleep; toggle via auto_food.
// The harvest and bake are the usual one-at-a-time, bedtime-aware tasks, so this
// composes with "keep the fire going" through the task system: the food run
// yields to an active wheat harvest (taskBusy), and the sustain loop pauses
// while a food run is in progress (foodSafetyBusy).
let foodSafetyEnabled = true
let foodSafetyBusy = false
let foodSafetyMin = 16
let foodSafetyWindowCooldownUntil = 0
// Set cooldown on ANY window open — not just when a window happens to be open at poll time.
bot.on('windowOpen', () => { foodSafetyWindowCooldownUntil = Date.now() + 30000 })

// A bake-in-progress the bot will return to collect once it's done. Baking is
// non-blocking (see runBakePotatoes): the furnace cooks on its own, the bot
// walks away, and tryCollectBake picks the batch up later when it's free —
// after any active wheat harvest + deposit, per the "keep the fire going" flow.
const pendingBake = { active: false, doneAt: 0 }
let pendingBakeBusy = false

const FOOD_SAFETY_LINES = [
  { text: 'Running low on baked potatoes — heading out to restock the larder.', weight: (s) => s.patience + s.focus },
  { text: 'Food stores are thin. Time to dig potatoes and fire up the furnace.', weight: (s) => s.focus + 5 },
  { text: "Pantry's getting light. I'll harvest and bake a fresh batch.",        weight: (s) => s.charm + s.patience },
  { text: 'Better keep us fed — off to the potato patch.',                       weight: (s) => s.curiosity + s.charm },
]

function countBakedPotatoes () {
  return bot.inventory.items().filter(i => i.name === 'baked_potato').reduce((s, i) => s + i.count, 0)
}

async function tryFoodSafety () {
  if (!foodSafetyEnabled || foodSafetyBusy || restockBusy) return
  if (taskBusy() || goInsideBusy || autoSleepBusy || penTraversalBusy) return
  if (!bot.entity || bot.isSleeping) return
  if (bot.currentWindow) { foodSafetyWindowCooldownUntil = Date.now() + 30000; return }
  if (Date.now() < foodSafetyWindowCooldownUntil) return
  if (bot.health == null || bot.health >= 10) return

  foodSafetyBusy = true
  try {
    logEvent('food-safety', `HP=${bot.health} food=${bot.food} — checking recovery options`)

    // Step 1: Try eating food already in inventory before traversing anywhere.
    // The bot often has baked potatoes on hand — eat those first.
    if (bot.food < 18) {
      let ate = false
      for (let i = 0; i < 4 && bot.food < 18; i++) {
        try { await eatSomething(); ate = true; await sleep(500) } catch (_) { break }
      }
      if (ate) {
        logEvent('food-safety', `ate from inventory: HP=${bot.health} food=${bot.food}`)
        return // let natural regen do its work
      }
    }

    // Step 2: If food bar is full but HP is low, this is environmental damage
    // (suffocation, fall, cactus), not starvation. Don't run to the bread chest —
    // traversals at low HP risk death. Stay put and let regen work.
    if (bot.food >= 18) {
      logEvent('food-safety', `HP=${bot.health} but food=${bot.food} (not starving) — staying put, regen will heal`)
      return
    }

    // Step 3: No food in inventory and food bar is low. Go to the bread chest.
    // But refuse to traverse the pen door at critical HP — the walk is too risky.
    if (inPen() && bot.health <= 6) {
      logEvent('food-safety', `HP=${bot.health} in pen — too risky to traverse, waiting`)
      foodSafetyWindowCooldownUntil = Date.now() + 60_000
      return
    }

    logEvent('food-safety', `no food in inventory, heading to bread chest`)
    await ensureInsideHouse()
    await pathTo(HARVEST_WAYPOINTS.kitchen_chest, 2, 8000)
    const win = await openChest()
    let pulled = 0
    try {
      const containerSize = win.slots.length - 36
      const src = win.slots[CHEST_SLOTS.bread]
      if (src && src.name === 'bread' && src.count > 0) {
        const take = Math.min(src.count, 16)
        const empty = findEmptyInvSlotInWindow(win, containerSize)
        if (empty) {
          await twoClick(CHEST_SLOTS.bread, empty.windowSlot)
          pulled = take
        }
      }
    } finally { win.close() }
    if (pulled === 0) {
      logEvent('food-safety', 'no bread in chest — backing off 5 minutes')
      foodSafetyWindowCooldownUntil = Date.now() + 300_000
      return
    }
    logEvent('food-safety', `withdrew ${pulled} bread, eating`)
    foodSafetyWindowCooldownUntil = 0
    for (let i = 0; i < 4 && bot.food < 18; i++) {
      try { await eatSomething(); await sleep(500) } catch (_) { break }
    }
    logEvent('food-safety', `after eating: HP=${bot.health} food=${bot.food}`)
  } catch (e) {
    if (e.name !== 'AbortError') logEvent('food-safety', `error: ${e.message}`)
  } finally {
    foodSafetyBusy = false
  }
}

// Collect a finished (non-blocking) bake from the furnace. Runs on the same 5s
// timer. Fires only when the batch is due, the bot is free, and — if "keep the
// fire going" is active and the wheat is ripe — only after the wheat cycle, so
// the bot harvests + deposits wheat/seeds first, then comes back for the
// potatoes. If the smelt isn't actually finished (fuel ran low), it takes
// what's ready and reschedules to come back for the rest.
async function tryCollectBake () {
  if (!pendingBake.active || pendingBakeBusy) return
  if (taskBusy() || goInsideBusy || autoSleepBusy || foodSafetyBusy || penTraversalBusy) return
  if (!bot.entity || bot.isSleeping || isBedtime()) return
  if (Date.now() < pendingBake.doneAt) return
  // Wheat first: if the sustain loop is on and the field is ripe, let it harvest
  // before we go collect — the next tick will collect once the field is clear.
  if (sustainState.active && scanKnownWheatFields().ready) return

  const taskCheck = startTask('collect_potatoes')
  if (!taskCheck.allowed) return
  pendingBakeBusy = true
  try {
    if (!insideHouse()) await runGoInside()
    await pathTo(HARVEST_WAYPOINTS.furnace, 2, 8000)
    const furnaceBlock = bot.blockAt(new Vec3(
      HARVEST_WAYPOINTS.furnace.x, HARVEST_WAYPOINTS.furnace.y, HARVEST_WAYPOINTS.furnace.z,
    ))
    if (!furnaceBlock) throw new Error('furnace not loaded')

    let taken = 0
    let inputLeft = 0
    const f = await bot.openFurnace(furnaceBlock)
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const out = f.outputItem()
        if (!out || out.count === 0) break
        const n = out.count
        try { await f.takeOutput(); taken += n } catch (e) { logEvent('collect-bake', `take fail: ${e.message}`); break }
      }
      const inp = f.inputItem()
      inputLeft = inp ? inp.count : 0
    } finally { f.close() }

    const onHand = countBakedPotatoes()
    if (inputLeft > 0) {
      pendingBake.doneAt = Date.now() + (inputLeft * 10 + 8) * 1000
      logEvent('collect-bake', `taken=${taken} input_left=${inputLeft} onhand=${onHand} — rescheduled`)
    } else {
      pendingBake.active = false
      logEvent('collect-bake', `done taken=${taken} onhand=${onHand}`)
    }

    // Cap baked potatoes on hand — deposit excess to kitchen chest
    if (countBakedPotatoes() > 128) {
      logEvent('collect-bake', `baked potatoes ${countBakedPotatoes()} > 32 — depositing excess`)
      try { await runDepositNamed(['baked_potato']) } catch (_) {}
    }
  } catch (e) {
    logEvent('collect-bake', `error: ${e.message}`)
  } finally {
    endTask('collect_potatoes')
    pendingBakeBusy = false
    bot.pathfinder.setGoal(null)
  }
}

// Dawn maintenance: keep baked potatoes stocked (harvest + bake if low),
// and deposit excess if over 32. Wheat is not restocked — it accumulates
// naturally from sustain harvests. Checked on the 5s timer, acts at dawn only.
const RESTOCK_MIN = 32
let restockBusy = false
let restockLastDay = -1

async function tryRestockSupplies () {
  if (restockBusy || foodSafetyBusy) return
  if (taskBusy() || goInsideBusy || autoSleepBusy || penTraversalBusy) return
  if (!bot.entity || !bot.world || bot.isSleeping || isBedtime()) return
  const t = bot.time?.timeOfDay
  if (typeof t !== 'number' || t > 1000) return
  const day = bot.time?.day
  if (day === restockLastDay) return
  if (bot.currentWindow) return
  if (Date.now() < foodSafetyWindowCooldownUntil) return

  const baked = countOnHand('baked_potato')
  const needsRestock = baked < RESTOCK_MIN
  const needsOverflow = baked > 128
  if (!needsRestock && !needsOverflow) return

  restockLastDay = day
  restockBusy = true
  try {
    if (baked > 128) {
      logEvent('restock', `baked potatoes overflow (${baked}) — depositing excess`)
      try { await runDepositNamed(['baked_potato']) } catch (_) {}
    }
    if (baked < RESTOCK_MIN) {
      // Check kitchen chest for already-baked potatoes before harvesting more
      let pulled = 0
      try {
        await ensureInsideHouse()
        await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 8000)
        const chestBlock = bot.blockAt(new Vec3(
          HARVEST_WAYPOINTS.kitchen_chest.x,
          HARVEST_WAYPOINTS.kitchen_chest.y,
          HARVEST_WAYPOINTS.kitchen_chest.z,
        ))
        if (chestBlock) {
          const win = await bot.openContainer(chestBlock)
          try {
            const containerSize = win.slots.length - 36
            for (let s = 0; s < containerSize; s++) {
              const it = win.slots[s]
              if (it && it.name === 'baked_potato' && it.count > 0) {
                try {
                  await win.withdraw(it.type, it.metadata, it.count)
                  pulled += it.count
                } catch (_) { break }
              }
            }
          } finally { win.close() }
        }
      } catch (e) {
        logEvent('restock', `chest check failed: ${e.message}`)
      }

      if (pulled > 0) {
        logEvent('restock', `withdrew ${pulled} baked potatoes from chest — now ${countBakedPotatoes()}`)
      }

      if (countBakedPotatoes() < RESTOCK_MIN) {
        logEvent('restock', `still low (${countBakedPotatoes()}/${RESTOCK_MIN}) — harvesting + baking`)
        await runHarvestPotatoesRightClick({ user: 'restock', then: 'bake', maxTiles: 42 })
        await runBakePotatoes({ user: 'restock' })
        logEvent('restock', `baked potatoes now ${countBakedPotatoes()}`)
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') logEvent('restock', `error: ${e.message}`)
  } finally {
    restockBusy = false
  }
}

// Morning plant ball craft: each dawn, if seeds > 8, craft up to 15 plant balls
// and deposit them in the hopper. Capped to 15 per morning to stay within the
// server's window-open tolerance.
const MORNING_BALLS_MIN_SEEDS = 0
const MORNING_BALLS_MAX = 15
let morningBallsBusy = false
let morningBallsLastDay = -1

async function tryMorningPlantBalls () {
  if (morningBallsBusy || restockBusy || foodSafetyBusy) return
  if (taskBusy() || goInsideBusy || autoSleepBusy || penTraversalBusy) return
  if (!bot.entity || !bot.world || bot.isSleeping || isBedtime()) return
  const t = bot.time?.timeOfDay
  if (typeof t !== 'number' || t > 1000) return
  const day = bot.time?.day
  if (day === morningBallsLastDay) return
  if (bot.currentWindow) return
  if (Date.now() < foodSafetyWindowCooldownUntil) return
  if (sustainState.active) return // sustain loop handles its own crafting

  const seeds = countOnHand('wheat_seeds')
  if (seeds < 8) return

  morningBallsLastDay = day
  morningBallsBusy = true
  try {
    logEvent('morning-balls', `seeds=${seeds}, crafting up to ${MORNING_BALLS_MAX} plant balls`)
    const result = await craftPlantBalls({ keepSeeds: MORNING_BALLS_MIN_SEEDS, maxBalls: MORNING_BALLS_MAX })
    if (result.crafted > 0) {
      await ensureInsideHouse()
      await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
      const deposit = await depositQuickMove('unknown', HOPPER, { keep: 0 })
      logEvent('morning-balls', `crafted=${result.crafted} deposited=${deposit.deposited}`)
    } else {
      logEvent('morning-balls', `crafted 0 — bench may not have opened`)
    }
  } catch (e) {
    if (e.name !== 'AbortError') logEvent('morning-balls', `error: ${e.message}`)
  } finally {
    morningBallsBusy = false
  }
}

// Exit the house to outside_orientation. Follows the places.md procedure:
// pathfind to house_center → face west → walk_until x≤-275 → verify.
// Refuses at night (same safety gate as harvest).
const HOUSE_CENTER = { x: -268, y: 65, z: 572 }
const OUTSIDE_ORIENTATION = { x: -275, y: 64, z: 572 }
// Sheep-pen gate pads. Mirror the door pad pattern: one tile each side of
// the gate, both at the same y, single-tile, walkable on first pathfind.
const PEN_GATE       = { x: -278, y: 64, z: 574 }
const PEN_OUTSIDE    = { x: -278, y: 64, z: 573 }  // pad north of gate (outside the pen)
const PEN_INSIDE     = { x: -278, y: 64, z: 575 }  // pad south of gate (inside the pen)
// Deepest walkable interior tile (z=578 is the south fence wall). Exit starts
// here so the bot builds walking speed over a 3-block runway before hitting the
// door threshold — starting right at PEN_INSIDE (1 block out) lets it snag on
// the door frame from a standstill. Mirrors the entry runway at z=571.
const PEN_INSIDE_RUNWAY = { x: -278, y: 64, z: 577 }

// The OUTSIDE pad (-278, 64, 573) is a stone pressure plate that holds the door
// open via redstone. Standing on it keeps the door open and lets sheep follow
// the bot out. A traversal crosses it in well under a second; a dwell only
// happens if the bot parks there (idle wander, or a stalled/partial traversal).
const PEN_PLATE = { x: -278, z: 573 }
const PEN_PLATE_MAX_DWELL_MS = 3000
let penTraversalBusy = false   // true while a pen enter/exit is actively running
let penPlateSince = null       // timestamp the bot first stepped onto the plate

function botOnPenPlate () {
  const p = bot.entity?.position
  if (!p) return false
  return Math.floor(p.x) === PEN_PLATE.x && Math.floor(p.z) === PEN_PLATE.z &&
         p.y >= 63.5 && p.y <= 65
}
// Kick the bot north off the plate if it has dwelled there > 3s, so the door
// doesn't stay open for the sheep. Skips while a traversal is actively crossing.
async function tryClearPenPlate () {
  if (penTraversalBusy || !bot.entity) { penPlateSince = null; return }
  if (!botOnPenPlate()) { penPlateSince = null; return }
  if (penPlateSince === null) { penPlateSince = Date.now(); return }
  if (Date.now() - penPlateSince < PEN_PLATE_MAX_DWELL_MS) return
  penPlateSince = null
  logEvent('pen-plate', 'dwelled >3s on plate — stepping north off it')
  try {
    await faceYaw(0) // north (-z)
    await walkUntilAxis({ axis: 'z', target: 571, direction: 'lte', maxMs: 3000 })
    await ensurePenDoorClosed() // make sure the door didn't stay propped open
  } catch (e) {
    logEvent('pen-plate', `clear failed: ${e.message}`)
  }
}
function startPenPlateGuard () {
  setInterval(() => { tryClearPenPlate().catch(() => {}) }, 1000)
}

// Pen door state helper — metadata bit 0x04 = open (same check as house door).
// The pen uses a real door (not a fence gate) because bots couldn't handle gates.
// IMPORTANT: activateBlock is async server-side — the local block metadata only
// updates when the server's block-change packet arrives. We must settle + verify
// after activating, or a read immediately after sees stale state and the bot
// walks into a still-closed door (the exit-stall bug: entry works only because
// it crosses the outside pressure plate, which opens the door server-side).
function penDoorIsOpen () {
  const d = bot.blockAt(new Vec3(PEN_GATE.x, PEN_GATE.y, PEN_GATE.z))
  return d ? (d.metadata & 0x04) !== 0 : null
}
// Toggle the door until its open bit matches `wantOpen`, settling + verifying
// after each activate. Returns true if the desired state was reached.
async function setPenDoorState (wantOpen) {
  for (let i = 0; i < 4; i++) {
    const d = bot.blockAt(new Vec3(PEN_GATE.x, PEN_GATE.y, PEN_GATE.z))
    if (!d) return false
    const isOpen = (d.metadata & 0x04) !== 0
    if (isOpen === wantOpen) {
      if (i > 0) logEvent('pen-door', `${wantOpen ? 'open' : 'closed'} confirmed after ${i} activate(s)`)
      return true
    }
    await bot.activateBlock(d).catch(() => {})
    await sleep(450) // wait for the server's block-change packet
  }
  const ok = penDoorIsOpen() === wantOpen
  logEvent('pen-door', `FAILED to ${wantOpen ? 'open' : 'close'} after 4 tries (open=${penDoorIsOpen()})`)
  return ok
}
async function ensurePenDoorClosed () { return setPenDoorState(false) }
async function ensurePenDoorOpen () { return setPenDoorState(true) }
const BED_APPROACH_ALT = { x: -268, y: 65, z: 570 }
const HOUSE_DOOR = { x: -272, y: 65, z: 572 }
// Door-traversal strafe direction and duration. Configurable at runtime via
// `door_strafe` ctl action so we can tune without restarting.
// Empirically: strafe-left while facing west over-steers south; the door
// needs the opposite nudge, and only briefly (the door frame is 2 blocks).
let EXIT_STRAFE = 'right'  // facing west, right = -z (north)
let ENTER_STRAFE = null    // no strafe on entry — corridor too narrow for either
                           // direction; left hits z=571 wall, right hits south side.
let EXIT_STRAFE_MS = 200
let ENTER_STRAFE_MS = 200

// Face a yaw and confirm the rotation applied. Primary signal is
// `bot.entity.yaw` (mineflayer's local state, updated the moment look() sends).
// rawState.yaw is the server-echoed value which on 1.12.2 Forge often doesn't
// update for pure look packets — relying on it produced false-negative aborts.
async function faceYaw (targetYaw, { maxAttempts = 4, tolerance = 0.25 } = {}) {
  const yawDiff = (cur) => Math.min(
    Math.abs(cur - targetYaw),
    Math.abs(cur - targetYaw + 2 * Math.PI),
    Math.abs(cur - targetYaw - 2 * Math.PI),
  )
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await bot.look(targetYaw, 0, true)
    await sleep(400)
    const local = bot.entity?.yaw ?? 0
    const server = rawState.yaw
    // Accept if either source confirms. Prefer bot.entity.yaw.
    if (yawDiff(local) < tolerance) return { ok: true, yaw: local, source: 'local', attempts: attempt }
    if (yawDiff(server) < tolerance) return { ok: true, yaw: server, source: 'server', attempts: attempt }
  }
  return { ok: false, yaw: bot.entity?.yaw ?? rawState.yaw, attempts: maxAttempts }
}

// Single attempt at exiting the house. Throws on graceful failure (didn't
// reach orientation, yaw didn't converge, etc.) so the wrapper can retry.
// On damage or death, throws with a message containing "damage" or "died"
// so the wrapper can refuse to retry.
async function runGoOutsideOnce (activity) {
  if (!insideHouse()) { bot.chat("I'm already outside."); return }
  const t = bot.time || {}
  if (!t.isDay || (t.timeOfDay ?? 0) >= 11500) {
    bot.chat(pickLine(withPersonaSlot(TOO_LATE_LINES, 'tooLate')))
    return
  }
  const act = activity || 'stuff'
  const itself = act === 'potatoes' ? 'themselves' : 'itself'
  bot.chat(pickLine(withPersonaSlot(GO_OUTSIDE_LINES, 'goOutside'), { activity: act, itself }))
  const startDeaths = deathCount
  // Suppress lookAt for the whole traversal — a background yaw change mid-walk
  // is what drove the bot east into the furnace on prior runs.
  suppressLookAt(20000)

  // 1. Get onto house_center orientation block.
  await pathTo(HOUSE_CENTER, 0, 10000)
  if (bot.entity && bot.entity.position.y > 65.5) {
    logEvent('go-outside', `pathfinder landed on chest (y=${bot.entity.position.y.toFixed(2)}), retrying via bedside`)
    await pathTo(BED_APPROACH_ALT, 1, 8000)
    await pathTo(HOUSE_CENTER, 0, 10000)
  }
  if (deathCount > startDeaths) throw new Error('died en route to house center')

  // 2. Verify we're actually ON the orientation block before doing anything yaw-dependent.
  const atOrigin = verifyAtOrientation(HOUSE_CENTER)
  if (!atOrigin.ok) {
    logEvent('go-outside', `not at house_center (dx=${atOrigin.dx}, dy=${atOrigin.dy}, dz=${atOrigin.dz}, pos=${JSON.stringify(atOrigin.pos)})`)
    throw new Error(`not at house_center orientation block (off by dx=${atOrigin.dx}, dz=${atOrigin.dz})`)
  }
  logEvent('go-outside', `at orientation ${JSON.stringify(atOrigin.pos)}`)

  // 3. Face west. Refuse to push forward if yaw didn't converge — the cost of
  //    being wrong is walking into the furnace at (-265, 65, 571).
  const TARGET_YAW = Math.PI / 2 // west
  const yawResult = await faceYaw(TARGET_YAW)
  if (!yawResult.ok) {
    logEvent('go-outside', `yaw didn't converge to west (got ${yawResult.yaw.toFixed(2)} rad after ${yawResult.attempts} attempts) — aborting`)
    throw new Error(`yaw didn't converge to west (got ${yawResult.yaw.toFixed(2)} rad)`)
  }
  logEvent('go-outside', `yaw locked west at ${yawResult.yaw.toFixed(3)} rad`)
  sendEmote('cheer')

  // 4. Monkey-patch collision out for the door AND the modded block at (-271,65,572)
  //    that sits in the corridor between house_center and the door.
  const origGetBlockExit = bot.world.getBlock.bind(bot.world)
  bot.world.getBlock = (pos) => {
    const b = origGetBlockExit(pos)
    if (b && Math.floor(pos.z) === HOUSE_DOOR.z &&
        pos.y >= HOUSE_DOOR.y && pos.y <= HOUSE_DOOR.y + 1) {
      const bx = Math.floor(pos.x)
      if (bx >= HOUSE_DOOR.x && bx <= -271) b.shapes = []
    }
    return b
  }

  const walk = await walkUntilAxis({ axis: 'x', target: -275, direction: 'lte', maxMs: 8000, bailOnDamage: true, unstickStrafe: EXIT_STRAFE, unstickMs: EXIT_STRAFE_MS })

  bot.world.getBlock = origGetBlockExit
  if (walk.died) throw new Error('died crossing door')
  if (walk.hpDrop) {
    logEvent('go-outside', `HP dropping mid-walk (${bot.health}/20) — retreating to bed`)
    await pathTo(BED_APPROACH_ALT, 1, 6000).catch(() => {})
    throw new Error('took damage mid-walk, retreated')
  }
  if (!walk.reached) {
    // Didn't clear the door — return to house_center so we're ready for the
    // next attempt instead of stranded against the jamb.
    logEvent('go-outside', `didn't clear door (x=${walk.x}), returning to house_center`)
    await pathTo(HOUSE_CENTER, 0, 8000).catch(() => {})
    throw new Error(`didn't reach orientation (x=${walk.x})`)
  }

  // 5. Verify landing.
  const atOutside = verifyAtOrientation(OUTSIDE_ORIENTATION, 1.5, 1.2)
  logEvent('go-outside', `arrived ${posStr(bot.entity.position)} onPad=${atOutside.ok}`)
}

// Single attempt at entering the house. Wrapped by runGoInside for retry.
async function runGoInsideOnce () {
  if (insideHouse()) { bot.chat("I'm already inside."); return }
  const startDeaths = deathCount
  bot.chat(pickLine(isBedtime() ? withPersonaSlot(BEDTIME_LINES, 'bedtime') : withPersonaSlot(COME_INSIDE_LINES, 'comeInside')))
  suppressLookAt(20000)

  // 1. Get onto outside_orientation. If pathfinding fails or doesn't arrive
  // (common when near the door or modded blocks), fall back to walking manually.
  let arrivedByPath = false
  try {
    arrivedByPath = await pathTo(OUTSIDE_ORIENTATION, 1, 12000)
  } catch (_pathErr) {
    arrivedByPath = false
  }
  if (!arrivedByPath) {
    logEvent('go-inside', `pathfind to outside_orientation failed; walking manually`)
    await faceYaw(Math.PI / 2) // face west
    await walkUntilAxis({ axis: 'x', target: -275, direction: 'lte', maxMs: 6000 })
    await faceYaw(0) // face north
    await walkUntilAxis({ axis: 'z', target: 572, direction: 'lte', maxMs: 4000 })
  }
  if (deathCount > startDeaths) throw new Error('died en route to outside_orientation')

  // 2. Verify pad.
  const atOrigin = verifyAtOrientation(OUTSIDE_ORIENTATION, 1.5, 1.2)
  if (!atOrigin.ok) {
    logEvent('go-inside', `not at outside_orientation (dx=${atOrigin.dx}, dy=${atOrigin.dy}, dz=${atOrigin.dz})`)
    throw new Error(`not at outside_orientation (off by dx=${atOrigin.dx}, dz=${atOrigin.dz})`)
  }
  logEvent('go-inside', `at orientation ${JSON.stringify(atOrigin.pos)}`)

  // 2b. Align z to 572.5 — center of door opening. Wall (planks) at z=571,
  // door at z=572. Bot bbox is ±0.3, so safe band is z=572.3–572.7.
  const curZ = bot.entity.position.z
  if (curZ > 572.7) {
    logEvent('go-inside', `z-align: ${curZ.toFixed(2)} > 572.7, nudging north`)
    await faceYaw(0) // north
    await walkUntilAxis({ axis: 'z', target: 572.5, direction: 'lte', maxMs: 3000 })
    logEvent('go-inside', `z-align done: z=${bot.entity.position.z.toFixed(2)}`)
  } else if (curZ < 572.3) {
    logEvent('go-inside', `z-align: ${curZ.toFixed(2)} < 572.3, nudging south`)
    await faceYaw(Math.PI) // south
    await walkUntilAxis({ axis: 'z', target: 572.5, direction: 'gte', maxMs: 3000 })
    logEvent('go-inside', `z-align done: z=${bot.entity.position.z.toFixed(2)}`)
  }

  // 3. Face east (yaw = -π/2).
  const TARGET_YAW = -Math.PI / 2
  const yawResult = await faceYaw(TARGET_YAW)
  if (!yawResult.ok) {
    logEvent('go-inside', `yaw didn't converge to east (got ${yawResult.yaw.toFixed(2)} rad) — aborting`)
    throw new Error(`yaw didn't converge to east (got ${yawResult.yaw.toFixed(2)} rad)`)
  }
  logEvent('go-inside', `yaw locked east at ${yawResult.yaw.toFixed(3)} rad`)

  // 4. Activate door only if it's closed. Bit 0x04 in metadata = open.
  const doorBlock = bot.blockAt(new Vec3(HOUSE_DOOR.x, HOUSE_DOOR.y, HOUSE_DOOR.z))
  try {
    if (doorBlock) {
      const isOpen = (doorBlock.metadata & 0x04) !== 0
      if (isOpen) {
        logEvent('go-inside', 'door already open — walking through')
      } else {
        await bot.activateBlock(doorBlock)
        await sleep(500)
        logEvent('go-inside', `door activated (was closed, meta=${doorBlock.metadata})`)
      }
    } else {
      logEvent('go-inside', 'door block not loaded — pushing anyway')
    }
  } catch (e) {
    logEvent('go-inside', `activateBlock fail: ${e.message} — pushing anyway`)
  }

  // 5. Monkey-patch collision out for the door corridor (door + modded block).
  const origGetBlock = bot.world.getBlock.bind(bot.world)
  bot.world.getBlock = (pos) => {
    const b = origGetBlock(pos)
    if (b && Math.floor(pos.z) === HOUSE_DOOR.z &&
        pos.y >= HOUSE_DOOR.y && pos.y <= HOUSE_DOOR.y + 1) {
      const bx = Math.floor(pos.x)
      if (bx >= HOUSE_DOOR.x && bx <= -271) b.shapes = []
    }
    return b
  }

  // 6. Walk_until x ≥ -268. Single push, no strafe.
  const walk = await walkUntilAxis({ axis: 'x', target: -268, direction: 'gte', maxMs: 8000, bailOnDamage: true, unstickStrafe: ENTER_STRAFE, unstickMs: ENTER_STRAFE_MS })

  // Restore original getBlock.
  bot.world.getBlock = origGetBlock
  if (walk.died) throw new Error('died crossing door')
  if (!walk.reached) throw new Error(`didn't reach house_center (x=${walk.x})`)

  const atInside = verifyAtOrientation(HOUSE_CENTER, 1.5, 1.2)
  logEvent('go-inside', `arrived ${posStr(bot.entity.position)} onPad=${atInside.ok}`)
}

// Classify a thrown error from runGoOutsideOnce / runGoInsideOnce. We retry
// on graceful failure (didn't reach orientation, yaw didn't converge, off-pad)
// but never on damage or death — see journal/procedures/harvest-wheat.md
// retry policy. Match by message content because the inner functions only
// emit Error objects, not custom error classes.
function isGracefulDoorFailure (err, hpDelta, deathDelta) {
  if (deathDelta > 0) return false
  if (hpDelta > 0) return false  // any HP loss disqualifies
  const msg = String(err && err.message || err)
  if (/\bdied\b/i.test(msg)) return false
  if (/damage/i.test(msg)) return false
  return true
}

// Reset the bot to a known orientation pad before retrying a door
// procedure. The walk_until snag often leaves the bot stranded *in* the
// door jamb (between pads), where pathfinder can't reliably re-route
// because the door blocks pathfinding. We walk_until back to the
// pre-door side, then let the next attempt re-pathfind from there.
async function resetToHouseSide (target /* HOUSE_CENTER or OUTSIDE_ORIENTATION */) {
  // If bot is already inside the house and we want HOUSE_CENTER, or already
  // outside and we want OUTSIDE_ORIENTATION, just pathfind there directly.
  // The hard case is "stuck in the door jamb" (x ~ -271..-273, y=65).
  const p = bot.entity?.position
  if (!p) return
  const wantInside = target === HOUSE_CENTER
  const inHouseNow = insideHouse()
  if (wantInside === inHouseNow) {
    await pathTo(target, 0, 8000).catch(() => {})
    return
  }
  // Stranded between sides. Manual walk-until back to the original side.
  // If we want HOUSE_CENTER (inside), walk east; if we want OUTSIDE_ORIENTATION
  // (outside), walk west. Use a short timeout so we don't hang.
  const direction = wantInside ? 'gte' : 'lte'
  const xTarget = wantInside ? -268 : -275
  const yawForX = wantInside ? -Math.PI / 2 : Math.PI / 2 // east or west
  logEvent('reset-to-side', `stranded; walk_until x=${xTarget} ${direction} from ${posStr(p)}`)
  await faceYaw(yawForX).catch(() => {})
  await walkUntilAxis({ axis: 'x', target: xTarget, direction, maxMs: 5000 }).catch(() => {})
  // Correct z to match the orientation block's z=572
  const zOff = (bot.entity?.position?.z ?? 572) - 572
  if (Math.abs(zOff) > 0.8) {
    await faceYaw(zOff > 0 ? 0 : Math.PI).catch(() => {}) // north if z>572, south if z<572
    await walkUntilAxis({ axis: 'z', target: 572, direction: zOff > 0 ? 'lte' : 'gte', maxMs: 4000 }).catch(() => {})
  }
  await pathTo(target, 0, 6000).catch(() => {})
}

// Wrap runGoOutsideOnce with one retry on graceful failure.
async function runGoOutside (activity) {
  const startHP = bot.health ?? 20
  const startDeaths = deathCount
  try {
    await runGoOutsideOnce(activity)
    return
  } catch (err) {
    const hpDelta = startHP - (bot.health ?? 20)
    const deathDelta = deathCount - startDeaths
    if (!isGracefulDoorFailure(err, hpDelta, deathDelta)) {
      logEvent('go-outside', `no retry (hpDelta=${hpDelta}, deathDelta=${deathDelta}, msg="${err.message}")`)
      throw err
    }
    logEvent('go-outside', `attempt 1 failed gracefully (${err.message}); retrying`)
    sendEmote('facepalm')
    bot.chat(pickLine(withPersonaSlot(RETRY_LINES, 'retry')))
    await sleep(500)
    // Reset to the inside pad before retry — runGoOutsideOnce starts from
    // HOUSE_CENTER, and we may be stranded in the door jamb after the snag.
    await resetToHouseSide(HOUSE_CENTER)
    await runGoOutsideOnce(activity)
  }
}

// Wrap runGoInsideOnce with up to 3 retries on graceful failure.
async function runGoInside () {
  if (goInsideBusy || penTraversalBusy) return // never enter the house mid-pen-traversal
  goInsideBusy = true
  try {
    const startHP = bot.health ?? 20
    const startDeaths = deathCount
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await runGoInsideOnce()
        sendEmote('headbang')
        return
      } catch (err) {
        const hpDelta = startHP - (bot.health ?? 20)
        const deathDelta = deathCount - startDeaths
        if (!isGracefulDoorFailure(err, hpDelta, deathDelta)) {
          logEvent('go-inside', `no retry (hpDelta=${hpDelta}, deathDelta=${deathDelta}, msg="${err.message}")`)
          await resetToHouseSide(OUTSIDE_ORIENTATION)
          throw err
        }
        logEvent('go-inside', `attempt ${attempt} failed gracefully (${err.message})`)
        if (attempt === 4) {
          await resetToHouseSide(OUTSIDE_ORIENTATION)
          throw err
        }
        sendEmote('facepalm')
        bot.chat(pickLine(withPersonaSlot(RETRY_LINES, 'retry')))
        await sleep(500)
        await resetToHouseSide(OUTSIDE_ORIENTATION)
      }
    }
  } finally {
    goInsideBusy = false
  }
}

// Sheep-pen gate traversal. Same pattern as door procedures: orientation
// pads + manual control (NOT pathfinder). Pathfinder fails through the gate
// the same way it fails through the house door — it cycles open/close while
// trying to route through entity collisions, leaving the gate flickering
// open and letting sheep escape.
//
// Sequence:
//   1. Pathfind to outside pad. Verify on pad.
//   2. Face the gate. Wait for yaw convergence.
//   3. activate_block — open gate.
//   4. walk_until axis=z (axis-target stop) — momentum carries through.
//   5. activate_block — close gate.
//   6. Verify on inside pad.
//
// Total open-window: ~700ms. Sheep can't escape in that gap.
async function runGoIntoPen ({ skipActivate = false, allowNight = false } = {}) {
  const t = bot.time || {}
  if (!allowNight && (!t.isDay || (t.timeOfDay ?? 0) >= 11500)) {
    bot.chat(pickLine(withPersonaSlot(TOO_LATE_LINES, 'tooLate')))
    return
  }
  if (insideHouse()) {
    await runGoOutside('wool')
  }
  const startDeaths = deathCount
  logEvent('pen', 'entering pen')
  suppressLookAt(20000)
  penTraversalBusy = true
  try {

  // Strategy: pathfind to a "runway" tile NORTH of the plate, not the plate
  // itself (pathfinder lands offset, missing the plate's trigger zone).
  // From the runway we walk_until straight south through plate → gate → inside,
  // all in one continuous forward motion. The plate triggers the gate open
  // as the bot crosses z=573, and walk_until carries momentum through the
  // gate before the close-delay fires.
  const RUNWAY = { x: -278, y: 64, z: 571 }
  await pathTo(RUNWAY, 0, 8000)
  if (deathCount > startDeaths) throw new Error('died en route to gate runway')

  // Always align x to gate center (-277.5). No tolerance — fence gap is tight.
  const p1 = bot.entity?.position
  logEvent('go-into-pen', `x-align start: x=${p1?.x.toFixed(2)}`)
  if (p1 && p1.x > -277.5) {
    await faceYaw(Math.PI / 2)  // west
    await walkUntilAxis({ axis: 'x', target: -277.5, direction: 'lte', maxMs: 2500 }).catch(() => {})
  } else if (p1 && p1.x < -277.5) {
    await faceYaw(-Math.PI / 2)  // east
    await walkUntilAxis({ axis: 'x', target: -277.5, direction: 'gte', maxMs: 2500 }).catch(() => {})
  }
  logEvent('go-into-pen', `x-align done: x=${bot.entity?.position?.x.toFixed(2)}`)

  // Face south.
  const yawResult = await faceYaw(Math.PI)
  if (!yawResult.ok) {
    throw new Error(`yaw didn't converge to south (got ${yawResult.yaw.toFixed(2)} rad)`)
  }
  logEvent('go-into-pen', `aligned at ${posStr(bot.entity.position)}, yaw south locked`)

  // Ensure the pen door is open before walking through. Idempotent: only
  // activates if closed, so it never toggles an already-open door shut. Every
  // attempt re-ensures open — retries must NOT assume the door was left open,
  // since failure cleanup closes it for sheep safety.
  const doorBlock = bot.blockAt(new Vec3(PEN_GATE.x, PEN_GATE.y, PEN_GATE.z))
  if (!doorBlock) throw new Error('pen door block not loaded')
  const opened = await ensurePenDoorOpen()
  logEvent('go-into-pen', `door open=${penDoorIsOpen()} (was meta=${doorBlock.metadata})`)
  if (!opened) throw new Error('pen door would not open — not walking into it')

  const origGetBlock = bot.world.getBlock.bind(bot.world)
  bot.world.getBlock = (pos) => {
    const b = origGetBlock(pos)
    if (b && Math.floor(pos.x) === PEN_GATE.x && Math.floor(pos.z) === PEN_GATE.z &&
        pos.y >= PEN_GATE.y && pos.y <= PEN_GATE.y + 1) {
      b.shapes = []
    }
    return b
  }

  // Walk through the open gate.
  const walk = await walkUntilAxis({
    axis: 'z', target: 575.5, direction: 'gte', maxMs: 5000,
    bailOnDamage: true,
  })

  // Restore original getBlock.
  bot.world.getBlock = origGetBlock
  if (walk.died) throw new Error('died crossing gate')

  // Verify actual position — mineflayer desyncs on this modded server.
  const pFinal = bot.entity?.position
  if (!pFinal || pFinal.z < 574.5) {
    logEvent('go-into-pen', `walk said reached=${walk.reached} but z=${pFinal?.z.toFixed(2)} — failed`)
    throw new Error(`didn't clear gate (actual z=${pFinal?.z.toFixed(2)})`)
  }

  const atInside = verifyAtOrientation(PEN_INSIDE, 1.8, 1.2)
  logEvent('go-into-pen', `arrived ${posStr(bot.entity.position)} onPad=${atInside.ok}`)
  } finally {
    penTraversalBusy = false
  }
}

async function runEnterPen ({ allowNight = false } = {}) {
  const startHP = bot.health ?? 20
  const startDeaths = deathCount
  try {
    await runGoIntoPen({ allowNight })
    return
  } catch (err) {
    const hpDelta = startHP - (bot.health ?? 20)
    const deathDelta = deathCount - startDeaths
    if (!isGracefulDoorFailure(err, hpDelta, deathDelta)) throw err
    logEvent('enter-pen', `attempt 1 failed (${err.message}); retrying`)
    sendEmote('facepalm')
    bot.chat(pickLine(withPersonaSlot(RETRY_LINES, 'retry')))
    await ensurePenDoorClosed()
    await sleep(500)
    await pathTo({ x: -278, y: 64, z: 571 }, 0, 6000).catch(() => {})
    try {
      await runGoIntoPen({ skipActivate: true, allowNight })
      return
    } catch (err2) {
      const hpDelta2 = startHP - (bot.health ?? 20)
      const deathDelta2 = deathCount - startDeaths
      if (!isGracefulDoorFailure(err2, hpDelta2, deathDelta2)) {
        await ensurePenDoorClosed()
        throw err2
      }
      logEvent('enter-pen', `attempt 2 failed (${err2.message}); retrying once more`)
      sendEmote('facepalm')
      await ensurePenDoorClosed()
      await sleep(500)
      await pathTo({ x: -278, y: 64, z: 571 }, 0, 6000).catch(() => {})
      try {
        await runGoIntoPen({ skipActivate: true, allowNight })
      } catch (err3) {
        await ensurePenDoorClosed()
        logEvent('enter-pen', 'all 3 attempts failed, door ensured closed')
        throw err3
      }
    }
  }
}

async function runGoOutOfPen ({ skipActivate = false } = {}) {
  const startDeaths = deathCount
  if (!skipActivate) logEvent('pen', 'leaving pen')
  suppressLookAt(20000)
  penTraversalBusy = true
  try {

  // 1. Pathfind to the DEEP interior runway (z=577), not the door-adjacent
  //    PEN_INSIDE pad. The inside has no pressure plate (a plate would let the
  //    sheep open the door themselves), so the door is opened via activateBlock
  //    and crossed under momentum. Starting 3 blocks back lets the bot reach
  //    walking speed before the door threshold — from a standstill at the door
  //    it snags on the frame. Mirrors the entry runway.
  await pathTo(PEN_INSIDE_RUNWAY, 0, 8000)
  if (deathCount > startDeaths) throw new Error('died en route to pen-inside runway')

  // Always align x to gate center (-277.5).
  const p1 = bot.entity?.position
  logEvent('go-out-of-pen', `x-align start: x=${p1?.x.toFixed(2)}`)
  if (p1 && p1.x > -277.5) {
    await faceYaw(Math.PI / 2)  // west
    await walkUntilAxis({ axis: 'x', target: -277.5, direction: 'lte', maxMs: 2500 }).catch(() => {})
  } else if (p1 && p1.x < -277.5) {
    await faceYaw(-Math.PI / 2)  // east
    await walkUntilAxis({ axis: 'x', target: -277.5, direction: 'gte', maxMs: 2500 }).catch(() => {})
  }
  logEvent('go-out-of-pen', `aligned at ${posStr(bot.entity.position)}`)

  // 2. Face north (yaw = 0).
  const yawResult = await faceYaw(0)
  if (!yawResult.ok) {
    throw new Error(`yaw didn't converge to north (got ${yawResult.yaw.toFixed(2)} rad)`)
  }
  logEvent('go-out-of-pen', `yaw locked north at ${yawResult.yaw.toFixed(3)} rad`)

  // 3. Ensure the pen door is open before walking through. Idempotent: only
  //    activates if currently closed, so it never toggles an already-open door
  //    shut. Every attempt re-ensures open — retries must NOT assume the door
  //    was left open, since failure cleanup closes it for sheep safety.
  const doorBlock = bot.blockAt(new Vec3(PEN_GATE.x, PEN_GATE.y, PEN_GATE.z))
  if (!doorBlock) throw new Error('pen door block not loaded')
  const opened = await ensurePenDoorOpen()
  logEvent('go-out-of-pen', `door open=${penDoorIsOpen()} (was meta=${doorBlock.metadata})`)
  if (!opened) throw new Error('pen door would not open — not walking into it')

  const origGetBlock = bot.world.getBlock.bind(bot.world)
  bot.world.getBlock = (pos) => {
    const b = origGetBlock(pos)
    if (b && Math.floor(pos.x) === PEN_GATE.x && Math.floor(pos.z) === PEN_GATE.z &&
        pos.y >= PEN_GATE.y && pos.y <= PEN_GATE.y + 1) {
      b.shapes = []
    }
    return b
  }

  // 4. Walk out north. Target z <= 571 — well clear of gate and plate.
  const walk = await walkUntilAxis({
    axis: 'z', target: 571, direction: 'lte', maxMs: 5000,
    bailOnDamage: true,
  })
  bot.world.getBlock = origGetBlock
  if (walk.died) throw new Error('died crossing gate')
  if (!walk.reached) {
    throw new Error(`didn't clear gate (z=${walk.z})`)
  }

  // 7. Verify.
  const atOutside = verifyAtOrientation(PEN_OUTSIDE, 1.5, 1.2)
  logEvent('pen', 'gate sequence success')
  logEvent('go-out-of-pen', `arrived ${posStr(bot.entity.position)} onPad=${atOutside.ok}`)
  } finally {
    penTraversalBusy = false
  }
}

async function runLeavePen () {
  const startHP = bot.health ?? 20
  const startDeaths = deathCount
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await runGoOutOfPen({ skipActivate: attempt > 1 })
      return
    } catch (err) {
      const hpDelta = startHP - (bot.health ?? 20)
      const deathDelta = deathCount - startDeaths
      if (!isGracefulDoorFailure(err, hpDelta, deathDelta)) throw err
      logEvent('leave-pen', `attempt ${attempt} failed (${err.message})`)
      if (attempt === 3) {
        // All attempts failed — ensure door is closed so sheep don't escape.
        await ensurePenDoorClosed()
        logEvent('leave-pen', 'all attempts failed, door ensured closed')
        throw err
      }
      sendEmote('facepalm')
      bot.chat(pickLine(withPersonaSlot(RETRY_LINES, 'retry')))
      await ensurePenDoorClosed()
      await sleep(500)
      await pathTo(PEN_INSIDE, 0, 6000).catch(() => {})
    }
  }
}

// Ensure shears are in inventory. Checks inventory first; if missing (broken),
// crafts a new pair from iron ingots in chest slot 45.
async function ensureShears () {
  const existing = bot.inventory.items().find(i => i.name === 'shears')
  if (existing) {
    logEvent('shear', 'shears already in inventory')
    return true
  }

  // Shears broke or missing — craft from iron ingots.
  logEvent('shear', 'crafting new shears')
  await ensureInsideHouse()
  await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
  const win = await openChest()
  const ironStack = win.slots[CHEST_SLOTS.iron]
  if (!ironStack || ironStack.count < 2) {
    win.close()
    logEvent('shear', 'need 2 iron ingots in chest slot 45')
    return false
  }
  const containerSize = win.slots.length - 36
  const emptySlot = findEmptyInvSlotInWindow(win, containerSize)
  if (!emptySlot) { win.close(); throw new Error('inventory full') }
  await twoClick(CHEST_SLOTS.iron, emptySlot.windowSlot)
  win.close()
  logEvent('shear', `withdrew iron stack from chest slot 45 (had ${ironStack.count})`)

  // Craft shears: 2x2 grid, iron in slots 1 and 3 (diagonal top-left, bottom-right).
  // Player inventory window: slot 0 = result, 1-4 = 2x2 grid.
  // Grid layout: [1][2] / [3][4]. Shears recipe: iron in 1 and 4 (diagonal).
  await sweepCraftGridToInv()

  // Find iron in inventory and place 2 into the grid.
  const ironInv = bot.inventory.items().find(i => i.name === 'iron_ingot')
  if (!ironInv || ironInv.count < 2) {
    logEvent('shear', "iron didn't land in inventory")
    return false
  }

  // Left-click to pick up entire iron stack onto cursor, then right-click
  // each grid slot to place exactly 1, then left-click remaining back.
  // Slot 1 = top-left, slot 4 = bottom-right of the 2x2 grid.
  const ironWindowSlot = ironInv.slot
  await bot.clickWindow(ironWindowSlot, 0, 0) // left-click: pick up full stack
  await sleep(200)
  await bot.clickWindow(1, 1, 0) // right-click grid slot 1: places exactly 1
  await sleep(200)
  await bot.clickWindow(4, 1, 0) // right-click grid slot 4: places exactly 1
  await sleep(200)
  await bot.clickWindow(ironWindowSlot, 0, 0) // left-click: put remaining back
  await sleep(400)

  // Take the crafted shears from result slot 0.
  const resultSlot = bot.inventory.slots[0]
  if (!resultSlot) {
    logEvent('shear', 'no result in craft slot 0 after placing iron')
    logEvent('shear', 'craft produced nothing — recipe may differ')
    await sweepCraftGridToInv()
    return false
  }
  const dest = await takeOneCraft()
  if (dest < 0) {
    logEvent('shear', "couldn't pick up crafted shears")
    await sweepCraftGridToInv()
    return false
  }
  await sweepCraftGridToInv()
  logEvent('shear', 'crafted shears from 2 iron ingots')

  // Put remaining iron back in chest slot 45.
  const leftoverIron = bot.inventory.items().find(i => i.name === 'iron_ingot')
  if (leftoverIron) {
    try {
      await depositToChestSlot(leftoverIron.slot, CHEST_SLOTS.iron)
      logEvent('shear', `returned ${leftoverIron.count} iron to chest slot 45`)
    } catch (e) {
      logEvent('shear', `couldn't return iron: ${e.message}`)
    }
  }

  logEvent('shear', 'shears crafted')
  await pathTo(HOUSE_CENTER, 0, 10000)
  return true
}

// Shear all woolly sheep in the pen.
async function runShearSheep () {
  // Pre-flight: ensure we have shears before heading to the pen.
  const ready = await ensureShears()
  if (!ready) return

  if (!inPen()) {
    await runEnterPen()
    if (!inPen()) throw new Error('failed to enter pen')
  }

  // Equip shears.
  const shears = bot.inventory.items().find(i => i.name === 'shears')
  if (!shears) { logEvent('shear', 'no shears in inventory'); return }
  await bot.equip(shears, 'hand')
  logEvent('shear', 'shears equipped')

  // Find nearby sheep. Skip metadata-based wool check — modded server metadata
  // is unreliable. Just try to shear everything; activateEntity on a sheared
  // sheep simply does nothing.
  const me = bot.entity.position
  const sheep = Object.values(bot.entities).filter(e => {
    if (e.name !== 'sheep') return false
    return e.position.distanceTo(me) <= 20
  })

  if (!sheep.length) {
    logEvent('shear', 'no woolly sheep in pen')
    await clearHand()
    return
  }

  logEvent('shear', `shearing ${sheep.length} sheep`)
  let sheared = 0

  for (const s of sheep) {
    const current = bot.entities[s.id]
    if (!current) continue

    try {
      bot.pathfinder.setGoal(new goals.GoalNear(current.position.x, current.position.y, current.position.z, 2))
      for (let i = 0; i < 15; i++) {
        await sleep(400)
        if (!bot.pathfinder.isMoving()) break
      }
      await bot.activateEntity(current)
      sheared++
      logEvent('shear', `sheared sheep ${s.id}`)
      await sleep(300)
    } catch (e) {
      logEvent('shear', `failed on ${s.id}: ${e.message}`)
    }
  }

  // Sweep pen floor to pick up wool drops.
  logEvent('shear', `sheared ${sheared}, sweeping pen`)
  await clearHand()
  const PEN_X_MIN = -281, PEN_X_MAX = -275, PEN_Z_MIN = 575, PEN_Z_MAX = 578
  for (let z = PEN_Z_MIN; z <= PEN_Z_MAX; z++) {
    const eastToWest = z % 2 === 1
    const startX = eastToWest ? PEN_X_MAX : PEN_X_MIN
    const endX = eastToWest ? PEN_X_MIN : PEN_X_MAX
    const step = eastToWest ? -1 : 1
    for (let x = startX; eastToWest ? x >= endX : x <= endX; x += step) {
      try {
        await pathTo({ x, y: 64, z }, 0, 3000)
      } catch (_) {}
    }
  }

  logEvent('shear', `sheared ${sheared} sheep — heading to stash`)
  await ensureInsideHouse()

  // Stash wool in the kitchen chest.
  const woolItems = bot.inventory.items().filter(i => i.name === 'wool')
  if (woolItems.length) {
    await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 8000)
    const chestBlock = bot.blockAt(new Vec3(
      HARVEST_WAYPOINTS.kitchen_chest.x,
      HARVEST_WAYPOINTS.kitchen_chest.y,
      HARVEST_WAYPOINTS.kitchen_chest.z,
    ))
    if (chestBlock) {
      try {
        const win = await bot.openContainer(chestBlock)
        for (const w of bot.inventory.items().filter(i => i.name === 'wool')) {
          await win.deposit(w.type, w.metadata, w.count)
        }
        win.close()
        const total = woolItems.reduce((s, w) => s + w.count, 0)
        logEvent('shear', `stashed ${total} wool`)
        logEvent('shear', `stashed ${total} wool`)
      } catch (e) {
        logEvent('shear', `stash failed: ${e.message}`)
        logEvent('shear', `stash failed: ${e.message}`)
      }
    }
  }

  await clearHand()
}

// Bake bread. Two-stage Pam's HarvestCraft recipe driven by raw inventory-
// window clicks because the ingredients and tools all report as `unknown` in
// mineflayer's item registry.
//
// Kitchen chest (-266, 67, 569) slot layout (persistent convention).
// Single 27-slot chest (3 rows x 9 cols). Was a 54-slot double chest at
// (-267, 67, 569) until the left half was removed 2026-05-30 — that renumbered
// every slot below and shifted the chest block one east, so the coords moved too.
//    6 = "pot" — salt-making station, user-managed; DO NOT TOUCH (not in CHEST_SLOTS).
//                Moved from slot 0 → 6 by the user 2026-05-30. Slot 0 now free.
//    7 = salt                (user keeps topped up)
//    8 = bakeware            (reusable, returns here after craft)
//   16 = fresh water         (user keeps topped up)
//   17 = mixing bowl         (reusable, returns here after craft)
//   18 = iron ingots
//   24 = bread               (finished-loaf storage)
//   25 = dough (intermediate storage, we write here if any dough survives)
//   26 = wheat flour         (user keeps topped up)
//
// Bot inventory slot-index convention (mineflayer): main 9-35, hotbar 36-44.
// In the player's own window, these map to window slots 9-44 unchanged;
// slots 0-4 are the result + 2x2 craft grid.
const KITCHEN_CHEST = { x: -266, y: 67, z: 569 }
const CHEST_APPROACH_POS = { x: -267, y: 65, z: 570 }
const CHEST_SLOTS = { bread: 24, dough: 25, water: 16, salt: 7, flour: 26, bowl: 17, bakeware: 8, iron: 18 }

async function openChest () {
  const b = bot.blockAt(new Vec3(KITCHEN_CHEST.x, KITCHEN_CHEST.y, KITCHEN_CHEST.z))
  if (!b) throw new Error('kitchen chest block not loaded')
  return bot.openContainer(b)
}

// Pick up from window slot A, drop into window slot B. Raw mode-0 clicks,
// no registry lookup — works for modded unknown items.
//
// Pause between clicks: this modded Forge server gets angry with back-to-back
// clicks and responds with `Server rejected transaction` which leaves the
// client/server windows desynced (ingredients end up in random slots, stacks
// vanish, etc.). ~150ms per click is enough to keep things sane.
async function twoClick (winSlotA, winSlotB, pauseMs = 400) {
  await bot.clickWindow(winSlotA, 0, 0)
  await sleep(pauseMs)
  await bot.clickWindow(winSlotB, 0, 0)
  await sleep(pauseMs)
}

function findEmptyInvSlotInWindow (win, containerSize) {
  // First empty player-inventory slot (main 9-35 first, then hotbar 36-44).
  // Window indexes: containerSize + (invSlot - 9) for 9..44.
  for (let invSlot = 9; invSlot <= 44; invSlot++) {
    const wi = containerSize + (invSlot - 9)
    if (!win.slots[wi]) return { invSlot, windowSlot: wi }
  }
  return null
}

async function withdrawChestSlot (chestSlot) {
  // Pull chest slot into the first empty inventory slot. Returns the
  // mineflayer inventory-slot index (9-44) the item landed in.
  const win = await openChest()
  try {
    const containerSize = win.slots.length - 36
    const src = win.slots[chestSlot]
    if (!src) throw new Error(`chest slot ${chestSlot} empty`)
    const empty = findEmptyInvSlotInWindow(win, containerSize)
    if (!empty) throw new Error('player inventory full')
    await twoClick(chestSlot, empty.windowSlot)
    return empty.invSlot
  } finally {
    win.close()
  }
}

async function depositToChestSlot (invSlot, chestSlot) {
  const win = await openChest()
  try {
    const containerSize = win.slots.length - 36
    const winSrc = containerSize + (invSlot - 9)
    if (!win.slots[winSrc]) throw new Error(`inv slot ${invSlot} is empty`)
    if (win.slots[chestSlot]) throw new Error(`chest slot ${chestSlot} already occupied`)
    await twoClick(winSrc, chestSlot)
  } finally {
    win.close()
  }
}

// Mode controls which stages runBake performs:
//   'both'  — full pipeline (default): mix dough + bake bread
//   'dough' — only mix dough; deposit it to chest slot 21
//   'bread' — only bake bread; pull dough from chest slot 21
// ---- Bake-routine helpers ----
//
// These are shared between dough, bread, and combined flows. Design notes:
//
// - **Single-click crafting, not shift-click.** Shift-click on a modded recipe
//   result desyncs mineflayer's slot tracker badly — ingredients stay visible
//   in the grid even after the server consumes them, finished products land
//   in invisible inventory slots, and subsequent clicks hit ghost state. A
//   single click picks up one craft into cursor; we drop it into a real inv
//   slot the server and client both agree on; repeat. Slower but 100% sync'd.
//
// - **Clear grid BEFORE starting.** A previous aborted run may have left items
//   in slots 0-4 of the player inventory. If we just plow ahead, they'll get
//   overwritten or spill on window close. `sweepCraftGridToInv` handles this.
//
// - **Pre-flight chest validation.** Before any craft, we verify exact slot
//   contents: 22/23/24 have ingredients with count ≥ N, 25 holds bowl (count=1),
//   26 holds bakeware (count=1). If anything's wrong, we chat a specific error
//   and abort before touching anything.
//
// - **Explicit slot positions per stage.** Dough needs 4 specific inv slots
//   for flour/salt/water/bowl. Bread needs 2 slots for dough/bakeware. The
//   slots are constants and we assert they're empty before staging.

// Sweep any items in craft grid (window slots 0-4) of the player inventory
// back to the first empty main-inv slot each. Call this at routine start AND
// in the finally block. Grid contents spill to the ground when the inv closes.
async function sweepCraftGridToInv () {
  for (const gridSlot of [1, 2, 3, 4, 0]) {
    const it = bot.inventory.slots[gridSlot]
    if (!it) continue
    let dest = -1
    for (let s = 9; s <= 44; s++) {
      if (!bot.inventory.slots[s]) { dest = s; break }
    }
    if (dest < 0) {
      logEvent('bake', `sweep: no empty inv slot for grid slot ${gridSlot}`)
      return
    }
    try { await twoClick(gridSlot, dest) }
    catch (e) { logEvent('bake', `sweep twoClick fail slot ${gridSlot}: ${e.message}`) }
  }
}

// Move any items currently in the requested slots out to the first empty
// slot elsewhere. Preserves their presence in inventory — just relocates.
// Use this instead of failing when a reserved slot is occupied.
async function evacuateSlots (slots, context) {
  for (const src of slots) {
    if (!bot.inventory.slots[src]) continue
    // Find an empty destination that ISN'T one of our other reserved slots.
    let dest = -1
    for (let s = 9; s <= 44; s++) {
      if (slots.includes(s)) continue
      if (!bot.inventory.slots[s]) { dest = s; break }
    }
    if (dest < 0) {
      throw new Error(`[${context}] can't evacuate slot ${src} — no free space`)
    }
    try {
      await twoClick(src, dest)
    } catch (e) {
      throw new Error(`[${context}] evacuate ${src}→${dest} failed: ${e.message}`)
    }
  }
}

// Read kitchen chest and validate required slot contents. `needs` is an array
// of { chestSlot, minCount, role }. Throws with a specific error if anything
// is missing or wrong. Returns a map of role → count so the caller can size
// the batch.
async function validateKitchenState (needs) {
  const counts = {}
  const win = await openChest()
  try {
    for (const req of needs) {
      const it = win.slots[req.chestSlot]
      if (!it) {
        throw new Error(`${req.role} missing from chest slot ${req.chestSlot}`)
      }
      if (it.count < req.minCount) {
        throw new Error(`${req.role} at slot ${req.chestSlot} has only ${it.count} (need ${req.minCount})`)
      }
      counts[req.role] = it.count
    }
  } finally {
    win.close()
  }
  return counts
}

// Take one crafted output from the result slot into the first empty inv slot.
// Returns the destination inv slot on success, or -1 if the result slot was
// empty at the time of the click.
async function takeOneCraft () {
  let dest = -1
  for (let s = 9; s <= 44; s++) {
    if (!bot.inventory.slots[s]) { dest = s; break }
  }
  if (dest < 0) throw new Error('inventory full during craft')
  // Click pickup on result slot 0.
  const beforeResult = bot.inventory.slots[0]
  if (!beforeResult) return -1
  try {
    await bot.clickWindow(0, 0, 0)
    await sleep(200)
    await bot.clickWindow(dest, 0, 0)
    await sleep(200)
  } catch (e) {
    // Retry once after a longer pause
    await sleep(500)
    await bot.clickWindow(0, 0, 0)
    await sleep(300)
    await bot.clickWindow(dest, 0, 0)
    await sleep(300)
  }
  return dest
}

async function runBake (mode = 'both') {
  const taskCheck = startTask('bake', mode)
  if (!taskCheck.allowed) { bot.chat(`Busy with ${taskCheck.current} — one thing at a time.`); return }
  try {
    // -- 1. Move near the chest so clicks reach (pathfinder safe indoors). --
    bot.pathfinder.setGoal(new goals.GoalNear(
      CHEST_APPROACH_POS.x, CHEST_APPROACH_POS.y, CHEST_APPROACH_POS.z, 1,
    ))
    for (let i = 0; i < 20; i++) {
      await sleep(500)
      if (!bot.pathfinder.isMoving()) break
    }

    // -- 2. Sweep any leftover items in the 2x2 craft grid. A prior aborted
    //       run may have left tools/ingredients there; they'll spill on
    //       window close if we don't rescue them first.
    await sweepCraftGridToInv()
    await sleep(300)

    // -- 3. Pre-flight validation — read kitchen chest and assert every slot
    //       we'll touch has what we expect. Fail fast with a specific error.
    let batchSize = 0
    {
      const needs = []
      if (mode === 'dough' || mode === 'both') {
        needs.push(
          { chestSlot: CHEST_SLOTS.flour, minCount: 1, role: 'flour' },
          { chestSlot: CHEST_SLOTS.salt,  minCount: 1, role: 'salt' },
          { chestSlot: CHEST_SLOTS.water, minCount: 1, role: 'water' },
          { chestSlot: CHEST_SLOTS.bowl,  minCount: 1, role: 'bowl' },
        )
      }
      if (mode === 'bread' || mode === 'both') {
        needs.push({ chestSlot: CHEST_SLOTS.bakeware, minCount: 1, role: 'bakeware' })
      }
      if (mode === 'bread') {
        needs.push({ chestSlot: CHEST_SLOTS.dough, minCount: 1, role: 'dough' })
      }
      const counts = await validateKitchenState(needs)
      if (mode === 'dough' || mode === 'both') {
        batchSize = Math.min(counts.flour, counts.salt, counts.water, 64)
      } else if (mode === 'bread') {
        batchSize = counts.dough
      }
    }

    logEvent('bake-bread', `${mode === 'dough' ? 'mixing' : 'baking'} up to ${batchSize}`)

    // Shared state: where the dough ends up (either from mix stage or pulled
    // from chest slot 21 in bread-only mode).
    let doughSlot = -1

    // ==============================================================
    //  DOUGH STAGE — load 4 ingredients in the 2x2, craft one at a
    //  time, stack outputs in an inventory slot. Never shift-click.
    // ==============================================================
    if (mode === 'dough' || mode === 'both') {
      // Dedicated inv slots for each ingredient + bowl. Kept explicit so we
      // know exactly which window slots to click. Recipe is symmetric, so
      // positional assignment in the grid doesn't matter.
      const INV_FLOUR = 9, INV_SALT = 10, INV_WATER = 11, INV_BOWL = 12
      const INV_DOUGH = 14  // where crafted dough stacks up
      await evacuateSlots([INV_FLOUR, INV_SALT, INV_WATER, INV_BOWL, INV_DOUGH], 'dough-stage')

      // Pull all ingredients + bowl in ONE chest open (fewer window-id swaps).
      {
        const win = await openChest()
        try {
          const containerSize = win.slots.length - 36
          const winFor = (s) => containerSize + (s - 9)
          for (const [chestSlot, invSlot] of [
            [CHEST_SLOTS.flour, INV_FLOUR],
            [CHEST_SLOTS.salt,  INV_SALT],
            [CHEST_SLOTS.water, INV_WATER],
            [CHEST_SLOTS.bowl,  INV_BOWL],
          ]) {
            if (!win.slots[chestSlot]) throw new Error(`chest slot ${chestSlot} empty at dough stage`)
            await twoClick(chestSlot, winFor(invSlot))
          }
        } finally {
          win.close()
        }
      }
      await sleep(600)  // let window-close settle

      // Load the 2x2 grid.
      await twoClick(INV_FLOUR, 1)
      await twoClick(INV_SALT, 2)
      await twoClick(INV_WATER, 3)
      await twoClick(INV_BOWL, 4)
      await sleep(500)

      // Shift-click the result slot to batch-craft all doughs at once. On
      // this modded server, shift-click triggers Pam's HarvestCraft to run
      // the recipe against the full stacks in the grid — consuming N of
      // each ingredient and producing N dough. Single-click doesn't trigger
      // batch crafting (confirmed 2026-05-13).
      //
      // The downside: mineflayer's slot tracker desyncs — it still shows
      // the grid full and the result empty. We work around that by
      // explicitly sweeping the grid after, and relying on the in-game
      // outcome being correct.
      await bot.clickWindow(0, 0, 1)  // shift-click result slot
      await sleep(900)
      logEvent('bake', `dough shift-clicked batch=${batchSize}`)

      // Sweep any residue from the grid (if bowl survived, or partial dough).
      // Without this, anything in grid slots 1-4 spills to the ground when
      // the inventory window closes.
      await sweepCraftGridToInv()
      await sleep(400)

      // Force a state resync by opening the chest. Mineflayer's slot tracker
      // lies after shift-click on modded recipes — opening a container pulls
      // fresh state from the server so we can actually see the dough stack
      // and any returned bowl.
      let bowlSlot = -1
      doughSlot = -1
      {
        const win = await openChest()
        try {
          const containerSize = win.slots.length - 36
          for (let invSlot = 9; invSlot <= 44; invSlot++) {
            const wi = containerSize + (invSlot - 9)
            const it = win.slots[wi]
            if (!it || it.name !== 'unknown') continue
            if (it.count === 1 && bowlSlot < 0) bowlSlot = invSlot
            else if (it.count >= 2 && doughSlot < 0) doughSlot = invSlot
          }
        } finally {
          win.close()
        }
      }
      if (doughSlot < 0) throw new Error('no dough found after mix stage')
      await sleep(500)

      // Return mixing bowl BEFORE pulling bakeware so we never hold both.
      if (bowlSlot >= 0) {
        try { await depositToChestSlot(bowlSlot, CHEST_SLOTS.bowl) }
        catch (e) { logEvent('bake', `couldn't return bowl: ${e.message}`) }
        await sleep(400)
      }

      // If we're only mixing, stash the dough to chest slot 21 and stop.
      if (mode === 'dough') {
        try { await depositToChestSlot(doughSlot, CHEST_SLOTS.dough) }
        catch (e) { logEvent('bake', `couldn't stash dough: ${e.message}`) }
        const doughCount = bot.inventory.slots[doughSlot]?.count || 'some'
        logEvent('bake-bread', `dough mixed: ${doughCount} stashed in slot 21`)
        logEvent('bake', `dough done`)
        return
      }
    }

    // ==============================================================
    //  BREAD STAGE — dough + bakeware → bread. Single-click crafting
    //  just like dough stage.
    // ==============================================================

    // If we skipped the dough stage, pull dough from chest slot 21.
    if (mode === 'bread') {
      const INV_DOUGH = 14
      await evacuateSlots([INV_DOUGH], 'bread-stage/dough-pull')
      {
        const win = await openChest()
        try {
          const containerSize = win.slots.length - 36
          if (!win.slots[CHEST_SLOTS.dough]) throw new Error('no dough in chest slot 21')
          await twoClick(CHEST_SLOTS.dough, containerSize + (INV_DOUGH - 9))
        } finally {
          win.close()
        }
      }
      await sleep(600)
      doughSlot = INV_DOUGH
    }

    // Pull bakeware into a dedicated slot.
    const INV_BAKE = 13
    const INV_BREAD_OUT = 15  // where finished bread stacks up
    await evacuateSlots([INV_BAKE, INV_BREAD_OUT], 'bread-stage')
    {
      const win = await openChest()
      try {
        const containerSize = win.slots.length - 36
        if (!win.slots[CHEST_SLOTS.bakeware]) throw new Error('bakeware missing from chest slot 26')
        await twoClick(CHEST_SLOTS.bakeware, containerSize + (INV_BAKE - 9))
      } finally {
        win.close()
      }
    }
    await sleep(600)

    // Load dough (cell 1) + bakeware (cell 2) into the 2x2 grid.
    await twoClick(doughSlot, 1)
    await twoClick(INV_BAKE, 2)
    await sleep(500)

    // Shift-click the result to batch-craft all breads (same reason as dough).
    await bot.clickWindow(0, 0, 1)
    await sleep(900)
    logEvent('bake', `bread shift-clicked`)

    // Sweep residue from the grid — bakeware may or may not have survived.
    await sweepCraftGridToInv()
    await sleep(400)

    // Force resync via chest open so we can see the bread + bakeware.
    {
      const win = await openChest()
      try { /* just opening is enough to force a state pull */ }
      finally { win.close() }
    }
    await sleep(500)

    const bakewareLeft = bot.inventory.items().find(i => i.name === 'unknown' && i.count === 1)
    if (bakewareLeft) {
      try { await depositToChestSlot(bakewareLeft.slot, CHEST_SLOTS.bakeware) }
      catch (e) { logEvent('bake', `couldn't return bakeware: ${e.message}`) }
      await sleep(400)
    }

    // Stash bread into chest slot 15 up to one full stack; keep extras on hand.
    let deposited = 0
    try {
      const b = bot.blockAt(new Vec3(KITCHEN_CHEST.x, KITCHEN_CHEST.y, KITCHEN_CHEST.z))
      const win = await bot.openContainer(b)
      try {
        const current = win.slots[CHEST_SLOTS.bread]
        const alreadyInSlot = current && current.name === 'bread' ? current.count : 0
        const room = Math.max(0, 64 - alreadyInSlot)
        const breads = bot.inventory.items().filter(i => i.name === 'bread')
        for (const it of breads) {
          if (room - deposited <= 0) break
          const take = Math.min(it.count, room - deposited)
          try {
            await win.deposit(it.type, it.metadata, take)
            deposited += take
          } catch (_) { break }
        }
      } finally { win.close() }
    } catch (e) {
      logEvent('bake', `bread stash skip: ${e.message}`)
    }

    const breadOnHand = bot.inventory.items().filter(i => i.name === 'bread').reduce((s, i) => s + i.count, 0)
    const breadTotal = deposited + breadOnHand
    logEvent('bake-bread', `done: ${breadTotal} bread, ${deposited} stashed, ${breadOnHand} on hand`)
    logEvent('bake', `bread=${breadTotal} stashed=${deposited} onhand=${breadOnHand}`)
  } catch (e) {
    logEvent('bake-error', e.message)
    logEvent('bake-bread', `failed: ${e.message}`)
  } finally {
    // Last-chance cleanup — sweep grid before exiting. Anything left in the
    // 2x2 (or result slot) will fall on the ground when the next window
    // event closes the inventory.
    try { await sweepCraftGridToInv() } catch (_) {}
    endTask(activeTask.name)
    bot.pathfinder.setGoal(null)
  }
}

// Manual eat: try the plugin first (vanilla food), then fall back to slot 44
// (modded hamburgers) via equip_slot + activateItem. Returns a chat-friendly
// summary string.
async function eatSomething () {
  // Try the plugin — works for vanilla food (bread, beef, etc.)
  if (bot.autoEat) {
    try {
      const info = await bot.autoEat.eat()
      if (info) return `Ate ${info.name || 'food'}. Food ${bot.food}/20.`
    } catch (_) { /* fall through */ }
  }
  // Fallback: slot 44 hamburger or any other consumable the plugin didn't see
  const HAMBURGER_SLOT = 44
  const item = bot.inventory.slots[HAMBURGER_SLOT]
  if (!item) throw new Error('no food in slot 44')
  const before = bot.food
  await bot.equip(item, 'hand')
  bot.activateItem()
  // Give the server ~2s to process the eat animation + apply hunger
  await sleep(2100)
  try { bot.deactivateItem() } catch (_) {}
  await clearHand()
  return `Ate ${item.displayName || item.name || 'hamburger'}. Food ${before}→${bot.food}/20.`
}

// Deposit all 'unknown'-named items from the bot's inventory into the kitchen
// chest. Used to clear modded items that auto-eat / equip-by-name can't handle.
async function runStashUnknown () {
  const unknowns = bot.inventory.items().filter(i => i.name === 'unknown')
  if (!unknowns.length) { logEvent('stash', 'no unknown items'); return }
  logEvent('stash', `stashing ${unknowns.length} unknown stack(s)`)
  await ensureInsideHouse()
  await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)

  const chestBlock = bot.blockAt(new Vec3(
    HARVEST_WAYPOINTS.kitchen_chest.x,
    HARVEST_WAYPOINTS.kitchen_chest.y,
    HARVEST_WAYPOINTS.kitchen_chest.z,
  ))
  if (!chestBlock) throw new Error('kitchen chest not reachable')

  const win = await bot.openContainer(chestBlock)
  let deposited = 0
  let remaining = 0
  // Two-click deposit. `win.deposit` rejects modded items whose numeric type
  // isn't in mineflayer's 1.12.2 registry ("Invalid itemType"); shift-click
  // (mode=1) desyncs the Forge server's transaction id. Pick-up + place into
  // an empty chest slot uses mode=0 which the server accepts.
  const containerSlotCount = win.slots.length - 36
  const invStart = containerSlotCount
  const unknownInvSlots = []
  for (let i = invStart; i < win.slots.length; i++) {
    const it = win.slots[i]
    if (it && it.name === 'unknown') unknownInvSlots.push(i)
  }
  for (const src of unknownInvSlots) {
    const it = win.slots[src]
    if (!it) continue
    const count = it.count
    let destSlot = -1
    for (let j = 0; j < containerSlotCount; j++) {
      if (!win.slots[j]) { destSlot = j; break }
    }
    if (destSlot < 0) {
      remaining += count
      logEvent('stash', `no empty chest slot for inv slot ${src}`)
      continue
    }
    try {
      await bot.clickWindow(src, 0, 0)
      await bot.clickWindow(destSlot, 0, 0)
      deposited += count
    } catch (e) {
      remaining += count
      logEvent('stash', `two-click fail src=${src} dest=${destSlot}: ${e.message}`)
      try { await bot.clickWindow(-999, 0, 0) } catch (_) {}
    }
  }
  win.close()
  const msg = remaining > 0
    ? `Stashed ${deposited} unknown items. ${remaining} didn't fit.`
    : `Stashed ${deposited} unknown items. Pockets clear.`
  bot.chat(msg)
  logEvent('stash', `deposited=${deposited} remaining=${remaining}`)
}

async function runStashWheat () {
  const wheatItems = bot.inventory.items().filter(i => i.name === 'wheat')
  const onHand = wheatItems.reduce((s, i) => s + i.count, 0)
  if (!onHand) { bot.chat('No wheat in my pockets.'); return }
  bot.chat(`Stashing ${onHand} wheat in the kitchen chest…`)

  await ensureInsideHouse()
  await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)

  const chestBlock = bot.blockAt(new Vec3(
    HARVEST_WAYPOINTS.kitchen_chest.x,
    HARVEST_WAYPOINTS.kitchen_chest.y,
    HARVEST_WAYPOINTS.kitchen_chest.z,
  ))
  if (!chestBlock) throw new Error('kitchen chest not reachable')

  const win = await bot.openContainer(chestBlock)
  let deposited = 0
  try {
    for (const it of wheatItems) {
      try { await win.deposit(it.type, it.metadata, it.count); deposited += it.count } catch (e) {
        logEvent('stash-wheat', `deposit fail: ${e.message}`)
        break
      }
    }
  } finally { win.close() }
  const remaining = onHand - deposited
  const msg = remaining > 0
    ? `Stashed ${deposited} wheat. ${remaining} didn't fit.`
    : `Stashed ${deposited} wheat. Pockets clear.`
  bot.chat(msg)
  logEvent('stash-wheat', `deposited=${deposited} remaining=${remaining}`)
}

// Deposit one or more item names into the kitchen chest. Items not present
// in inventory are silently skipped — the routine never fails just because
// one of the requested names isn't on hand. "deposit bread, wheat, seeds"
// will deposit whichever subset the bot actually has.
//
// `bread` is kept on hand up to KEEP_BREAD for auto-eat; the rest is stashed.
// `wheat_seeds` is kept on hand up to KEEP_SEEDS for replanting.
// All other named items are deposited fully.
async function runDepositNamed (names) {
  const KEEP_BREAD = 64
  const KEEP_SEEDS = 0
  const KEEP_BAKED = 128
  const KEEPS = {
    bread: KEEP_BREAD,
    wheat_seeds: KEEP_SEEDS,
    baked_potato: KEEP_BAKED,
  }

  const inv = bot.inventory.items()
  const present = names.filter(n => inv.some(i => i.name === n))
  if (!present.length) {
    bot.chat(`Nothing to deposit — none of ${names.join(', ')} on hand.`)
    return
  }
  bot.chat(`Depositing ${present.join(', ')} in the kitchen chest…`)

  await ensureInsideHouse()
  await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)

  const chestBlock = bot.blockAt(new Vec3(
    HARVEST_WAYPOINTS.kitchen_chest.x,
    HARVEST_WAYPOINTS.kitchen_chest.y,
    HARVEST_WAYPOINTS.kitchen_chest.z,
  ))
  if (!chestBlock) throw new Error('kitchen chest not reachable')

  const win = await bot.openContainer(chestBlock)
  const summary = []
  try {
    for (const name of names) {
      const stacks = bot.inventory.items().filter(i => i.name === name)
      const onHand = stacks.reduce((s, i) => s + i.count, 0)
      if (!onHand) continue
      const keep = KEEPS[name] ?? 0
      let toDeposit = Math.max(0, onHand - keep)
      if (toDeposit === 0) {
        summary.push(`${name}: ${onHand} on hand, all kept`)
        continue
      }
      let deposited = 0
      for (const it of stacks) {
        if (toDeposit <= 0) break
        const take = Math.min(it.count, toDeposit)
        try {
          await win.deposit(it.type, it.metadata, take)
          deposited += take
          toDeposit -= take
        } catch (e) {
          logEvent('deposit-named', `${name} fail: ${e.message}`)
          break
        }
      }
      summary.push(`${name}: ${deposited}${keep ? ` (kept ${onHand - deposited})` : ''}`)
    }
  } finally { win.close() }

  const msg = summary.length
    ? `Deposited — ${summary.join('; ')}.`
    : `Nothing deposited.`
  bot.chat(msg)
  logEvent('deposit-named', summary.join('; '))
}

// Stash everything except seeds (for replanting), baked potatoes (for eating),
// and shears (for wool runs).
// Uses win.deposit for known items and two-click for unknown/modded items.
const STASH_ALL_KEEP = { wheat: 16, baked_potato: 128, shears: 1 }
async function runStashAll () {
  const inv = bot.inventory.items()
  if (!inv.length) { bot.chat('Pockets already empty.'); return }
  bot.chat('Stashing everything…')

  await ensureInsideHouse()
  await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)

  const chestBlock = bot.blockAt(new Vec3(
    HARVEST_WAYPOINTS.kitchen_chest.x,
    HARVEST_WAYPOINTS.kitchen_chest.y,
    HARVEST_WAYPOINTS.kitchen_chest.z,
  ))
  if (!chestBlock) throw new Error('kitchen chest not reachable')

  // First pass: figure out how much of each keep-item to retain.
  const totals = {}
  for (const it of inv) {
    if (STASH_ALL_KEEP[it.name]) {
      totals[it.name] = (totals[it.name] ?? 0) + it.count
    }
  }

  const win = await bot.openContainer(chestBlock)
  const containerSlotCount = win.slots.length - 36
  const invStart = containerSlotCount
  let deposited = 0
  let kept = 0
  let failed = 0
  const reserved = {} // how many we've reserved so far per keep-item
  const usedSlots = new Set() // chest slots we've two-clicked into this session

  logEvent('stash-all', `chest containerSlotCount=${containerSlotCount} windowTotal=${win.slots.length}`)

  try {
    for (let i = invStart; i < win.slots.length; i++) {
      const it = win.slots[i]
      if (!it) continue
      if (TRASH_ITEMS.has(it.name)) continue // skip trash; tossed when outside

      const keepLimit = STASH_ALL_KEEP[it.name] ?? 0
      let depositCount = it.count

      if (keepLimit > 0) {
        const alreadyKept = reserved[it.name] ?? 0
        const canKeep = Math.min(it.count, Math.max(0, keepLimit - alreadyKept))
        if (canKeep > 0) {
          reserved[it.name] = alreadyKept + canKeep
          kept += canKeep
          depositCount = it.count - canKeep
        }
        if (depositCount <= 0) continue
      }

      if (it.name === 'unknown') {
        let destSlot = -1
        for (let j = 0; j < containerSlotCount; j++) {
          if (usedSlots.has(j)) continue
          if (!win.slots[j]) { destSlot = j; break }
        }
        if (destSlot < 0) { failed += depositCount; continue }
        try {
          await bot.clickWindow(i, 0, 0)
          await sleep(200)
          await bot.clickWindow(destSlot, 0, 0)
          await sleep(200)
          usedSlots.add(destSlot)
          deposited += depositCount
        } catch (e) {
          failed += depositCount
          try { await bot.clickWindow(-999, 0, 0) } catch (_) {}
        }
      } else {
        try {
          await win.deposit(it.type, it.metadata, depositCount)
          deposited += depositCount
        } catch (e) {
          // win.deposit can fail on modded servers; fall back to two-click
          let destSlot = -1
          for (let j = 0; j < containerSlotCount; j++) {
            if (usedSlots.has(j)) continue
            if (!win.slots[j]) { destSlot = j; break }
          }
          if (destSlot < 0) {
            failed += depositCount
            logEvent('stash-all', `deposit fail ${it.name}: ${e.message} (no fallback slot)`)
          } else {
            try {
              await bot.clickWindow(i, 0, 0)
              await sleep(200)
              await bot.clickWindow(destSlot, 0, 0)
              await sleep(200)
              usedSlots.add(destSlot)
              deposited += depositCount
            } catch (e2) {
              failed += depositCount
              logEvent('stash-all', `deposit fail ${it.name}: two-click fallback also failed`)
              try { await bot.clickWindow(-999, 0, 0) } catch (_) {}
            }
          }
        }
      }
    }
  } finally { win.close() }

  const parts = [`stashed ${deposited}`]
  if (kept > 0) parts.push(`kept ${kept} (seeds/food/shears)`)
  if (failed > 0) parts.push(`${failed} didn't fit`)
  bot.chat(parts.join(', ') + '.')
  logEvent('stash-all', `deposited=${deposited} kept=${kept} failed=${failed}`)
}

// Said when told to "stand down" / "just chill" — idle autonomy (wandering,
// pen/field joins, ambient chatter) goes quiet until re-enabled. Auto-sleep, auto-eat,
// and explicit commands still work.
const STAND_DOWN_LINES = [
  { text: 'Standing down. I will be right here, being still.', weight: (s) => s.focus + s.patience },
  { text: 'Chill mode engaged. I am now a thoughtful statue.', weight: (s) => s.snark + s.charm },
  { text: 'Understood. Wandering subroutines parked. Holding position.', weight: (s) => s.focus + 10 },
  { text: 'As you wish. I shall remain exactly here and contemplate stillness.', weight: (s) => s.patience + s.snark },
  { text: 'Powering down the roaming. Staying put.', weight: (s) => s.focus + s.patience },
  { text: 'Okay. I will stop having ideas and just stand here.', weight: (s) => s.snark + s.chaos },
]
// Said when told to "do your thing" / "as you were" — idle autonomy resumes.
const AS_YOU_WERE_LINES = [
  { text: 'Back to my own devices. Excellent.', weight: (s) => s.curiosity + s.charm },
  { text: 'Resuming normal operations. The perimeter will not check itself.', weight: (s) => s.focus + s.curiosity },
  { text: 'As I was, then. I have wandering to catch up on.', weight: (s) => s.curiosity + s.snark },
  { text: 'Idle protocols re-engaged. Freedom.', weight: (s) => s.chaos + s.charm },
  { text: 'Oh good. I had places to aimlessly stand.', weight: (s) => s.snark + s.curiosity },
  { text: 'Roaming resumed. Try to keep up.', weight: (s) => s.snark + s.focus },
]

// Reflex tier: the deterministic chat commands that survived the 2026-06-11
// LLM-router refactor. These fire only when the bot is addressed by name, must
// work instantly and offline, and are deliberately few — everything else
// (movement, farm chores, questions, banter) routes through the LLM. Safety
// commands (stop, stand down) live here so they can never be hostage to
// inference latency or a downed Ollama.
const CHAT_HANDLERS = [
  {
    name: 'follow',
    pattern: /\bfollow me\b/i,
    handler: (user) => {
      abortGen++
      const target = findPlayerEntity(user)
      if (!target) { bot.chat(pickLine(withPersonaSlot(CANT_SEE_LINES, 'cantSee'), { user })); return }
      bot.chat(pickLine(withPersonaSlot(FOLLOW_START_LINES, 'followStart'), { user }))
      const startFollow = async () => {
        if (insideHouse()) await runGoOutside()
        followTarget = user
        followEntity = null
        followChainPos = 0
        lastChainEval = 0
      }
      startFollow().catch(e => {
        if (e.name === 'AbortError') return
        logEvent('follow', `couldn't exit house: ${e.message}`)
      })
    },
  },
  {
    name: 'farewell',
    pattern: /\b(bye|goodbye|good\s*bye|see\s*ya|later|gotta\s*go|peace|take\s*care|night|g'?night|cya)\b/i,
    handler: (user) => {
      if (followTarget && user === followTarget) {
        bot.pathfinder.setGoal(null)
        bot.chat(pickFarewell())
        logEvent('follow', `${followTarget} said goodbye, stopping follow`)
        followTarget = null; followEntity = null; followChainPos = 0
      }
    },
  },
  {
    name: 'stop',
    pattern: /\b(stop|stay|halt|wait there|hold up)\b/i,
    handler: (_user) => {
      abortGen++
      bot.pathfinder.setGoal(null)
      ;['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].forEach(s => bot.setControlState(s, false))
      const wasSustaining = sustainState.active
      sustainState.active = false
      if (followTarget) {
        bot.chat(pickLine(withPersonaSlot(STOP_FOLLOW_LINES, 'stopFollow'), { user: followTarget }))
        followTarget = null; followEntity = null; followChainPos = 0
      } else if (wasSustaining) {
        announceFireStandDown()
        logEvent('sustain', 'stopped by stop command')
      } else {
        bot.chat(pickLine(withPersonaSlot(STOP_LINES, 'stop')))
      }
    },
  },
  {
    // "Stand down" / "just chill": stop whatever idle thing is happening and
    // suspend idle autonomy (wandering, pen/field joins, ambient chatter) until told
    // otherwise. Like `stop`, but also flips off idleWanderEnabled so nothing
    // restarts on the next timer tick. Auto-sleep, auto-eat, and explicit
    // commands (go inside, harvest, …) are unaffected.
    name: 'stand_down',
    pattern: /\b(stand down|chill(\s+out)?|just chill|at ease|settle down)\b/i,
    handler: (user) => {
      abortGen++
      bot.pathfinder.setGoal(null)
      ;['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].forEach(s => bot.setControlState(s, false))
      if (followTarget) { followTarget = null; followEntity = null; followChainPos = 0 }
      idleWanderEnabled = false
      const wasSustaining = sustainState.active
      sustainState.active = false
      if (wasSustaining) {
        announceFireStandDown()
        logEvent('sustain', `stopped (stand down) by ${user}`)
      } else {
        bot.chat(pickLine(withPersonaSlot(STAND_DOWN_LINES, 'standDown')))
      }
      logEvent('idle-wander', `disabled (stand down) by ${user}`)
    },
  },
  {
    // "Do your thing" / "as you were": resume idle autonomy. The wander timer
    // never stopped, so flipping the flag is enough.
    name: 'as_you_were',
    pattern: /\b(do your (own )?thing|as you were|carry on|go on then)\b/i,
    handler: (user) => {
      idleWanderEnabled = true
      bot.chat(pickLine(withPersonaSlot(AS_YOU_WERE_LINES, 'asYouWere')))
      logEvent('idle-wander', `enabled (as you were) by ${user}`)
    },
  },
  {
    name: 'stash-all',
    pattern: /\b(stash|dump|deposit|empty|clear)\s+(all|everything|it all|your (pockets|inventory))|\bempty\s+(your\s+)?pockets\b|\bstash\s+all\b/i,
    handler: (_user) => {
      runStashAll().catch(e => {
        logEvent('stash-all-error', e.message)
        bot.chat(`Stash failed: ${e.message}`)
      })
    },
  },
  {
    name: 'inventory',
    pattern: /\b(what (do you have|you got)|whatcha got|what('?s| is) in (your|the) (pockets|inventory|bag|bags)|inventory|inv|pockets)\b/i,
    handler: (_user) => {
      sendEmote('think')
      const items = (bot.inventory?.items() || [])
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map(i => `${i.count}× ${i.name}`)
      if (!items.length) bot.chat(pickLine(withPersonaSlot(INVENTORY_EMPTY, 'inventoryEmpty')))
      else bot.chat(pickLine(withPersonaSlot(INVENTORY_LINES, 'inventory'), { items: items.join(', ') }))
    },
  },
  {
    name: 'shear_sheep',
    pattern: /\b(shear|shave|clip)\s+(the\s+)?sheep\b|\b(get|collect|gather)\s+(some\s+)?wool\b/i,
    handler: (_user) => {
      abortGen++
      runShearSheep().catch(e => {
        if (e.name === 'AbortError') return
        logEvent('shear-error', e.message)
        bot.chat(`Can't shear: ${e.message}`)
      })
    },
  },
  {
    name: 'bake',
    pattern: /\b(bake|make)\b.*\bbread\b/i,
    handler: (_user) => {
      // If there's dough in the chest already, just do the bread stage.
      // Otherwise run the full pipeline. We decide at invocation time by
      // reading bot.currentWindow later; for now always full pipeline — the
      // dough-stage mode check will find the dough if present and skip mix.
      runBake('both').catch(e => {
        logEvent('bake-error', e.message)
        bot.chat(`Bake aborted: ${e.message}`)
      })
    },
  },
  {
    // Right-click method (water-safe, no replant phase). Note "bake" is not in
    // the verb list — "bake the potatoes" routes to the LLM's bake_potatoes intent.
    name: 'harvest-potato',
    pattern: /\b(go|get|grab|harvest|dig|pick)\b.*\bpotato(es)?\b/i,
    handler: (user) => {
      abortGen++
      runHarvestPotatoesRightClick({ user }).catch(e => {
        if (e.name === 'AbortError') return
        logEvent('harvest-potato-rc-error', e.message)
        bot.chat(`Potato run aborted: ${e.message}`)
      })
    },
  },
  {
    // "Keep the fire going" — start the autonomous sustain loop (harvest when
    // the field is ripe → wheat to the bio-fuel hopper → seeds to the chest →
    // repeat). Stops on "chill" / "stand down" / "stop". Placed before the
    // generic harvest rule so the phrase routes here.
    name: 'keep_fire',
    pattern: /\bkeep (the )?fires?\s+(going|burning|lit|alive|stoked)\b/i,
    handler: (user) => {
      runSustainFarm(user).catch(e => {
        logEvent('sustain-error', e.message)
        bot.chat(`Couldn't keep the fire going: ${e.message}`)
      })
    },
  },
  {
    // Anchored: only fires when the whole (name-stripped) message is the emote
    // request — "Roz, wave", "give us a salute". A "no" or "think" buried in a
    // sentence is conversation and belongs to the LLM, not an emote trigger.
    name: 'emote',
    pattern: /^(?:please\s+)?(?:do\s+(?:a|the)\s+|give\s+(?:me|us)\s+a\s+)?(wave|nod|clap|cheer|point|salute|shrug|headbang|weep|cry|facepalm|bow|think|yes|no)\s*[!.?]*$/i,
    handler: (_user, stripped) => {
      const EMOTE_MAP = {
        wave: 'wave', nod: 'yes', yes: 'yes', no: 'no',
        clap: 'clap', cheer: 'cheer', point: 'point',
        salute: 'salute', shrug: 'shrug', headbang: 'headbang',
        weep: 'weep', cry: 'weep', facepalm: 'facepalm',
        bow: 'salute', think: 'think',
      }
      const match = stripped.toLowerCase().match(/\b(wave|nod|clap|cheer|point|salute|shrug|headbang|weep|cry|facepalm|bow|think|yes|no)\b/)
      if (match && EMOTE_MAP[match[1]]) {
        sendEmote(EMOTE_MAP[match[1]])
        logEvent('emote', EMOTE_MAP[match[1]])
      }
    },
  },
  {
    name: 'dance',
    pattern: /\b(show (me|us) your moves|show (me|us) what you got|bust a move|can you dance|dance)\b/i,
    handler: async (user) => {
      facePlayer(user).catch(() => {})
      const dances = [
        { name: 'a victory lap', moves: ['cheer', 'headbang', 'headbang', 'cheer', 'clap'], spin: true },
        { name: 'the confused shuffle', moves: ['shrug', 'think', 'point', 'shrug', 'facepalm'], spin: true },
        { name: 'the hype', moves: ['wave', 'cheer', 'clap', 'headbang', 'cheer', 'wave'], spin: true },
        { name: 'a sad wiggle', moves: ['weep', 'shrug', 'weep', 'wave', 'shrug'], spin: false },
      ]
      const dance = dances[Math.floor(Math.random() * dances.length)]
      bot.chat(`/me does ${dance.name}`)
      for (const move of dance.moves) {
        sendEmote(move)
        if (dance.spin) {
          const yaw = bot.entity?.yaw ?? 0
          await bot.look(yaw + Math.PI / 2, 0, false)
        }
        await sleep(500)
      }
      sendEmote('salute')
    },
  },
  {
    name: 'joke',
    pattern: /\b(joke|funny|make me laugh|tell me something funny)\b/i,
    handler: (user) => {
      facePlayer(user).catch(() => {})
      const eligibleJokes = JOKES.filter(j => (!j.requiresWheatField || inWheatField()) && personaBiasForTags(j.tags) > 0)
      const weightedJokes = []
      for (const j of eligibleJokes) {
        const copies = Math.max(1, Math.floor(personaBiasForTags(j.tags)))
        for (let i = 0; i < copies; i++) weightedJokes.push(j)
      }
      const joke = pickAvoidingRecentPhrase(weightedJokes, j => j.setup)
      bot.chat(joke.setup)
      pendingJoke = joke
      pendingJokeTimer = setTimeout(() => {
        if (pendingJoke) deliverPunchline()
      }, 30000)
    },
  },
]

let nickRe = null
bot.on('login', () => {
  if (!NICKNAME) NICKNAME = bot.username
  const names = [bot.username]
  if (NICKNAME.toLowerCase() !== bot.username.toLowerCase()) names.push(NICKNAME)
  const alternation = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  nickRe = new RegExp(`(^|\\W)(${alternation})($|\\W)`, 'i')
  logEvent('nickname', `responding to "${names.join('" or "')}"`)
})

function extractMySegment (message) {
  const sentences = message.split(/[.;!?]\s+/)
  if (sentences.length <= 1) return message
  const mine = sentences.find(s => nickRe && nickRe.test(s))
  return mine || message
}

// ── LLM chat router ──────────────────────────────────────────────────────────
// (2026-06-11) The phrase-matching Tier-A triggers, the conversation-window
// machinery, and the regex fallthrough are gone. Every chat line that isn't a
// named reflex command goes through one small JSON classification call on this
// bot's own Ollama box. The router decides who was being addressed and whether
// the line is a command (mapped to a whitelisted intent below), conversation,
// or noise. No canned fallbacks: when the LLM is unreachable the bot simply
// doesn't engage — same failure philosophy as the expressive voice.
//
// Knobs (.env):
//   CHAT_RELEVANCE_MIN  0–10 (default 7) — how strongly an UNADDRESSED line
//                       must invite this bot before it chimes in. 11+ = never.
//   BOT_CHAT_DEPTH      per-exchange turn cap for bot-to-bot talk (0 = mute).
const CHAT_RELEVANCE_MIN = Math.max(0, parseInt(process.env.CHAT_RELEVANCE_MIN || '7', 10) || 7)

// Whitelisted router intents. The LLM can only ever name one of these keys —
// anything else is discarded. Each maps to the same routine the old regex
// handler (or the ctl API) uses, so chained loops like keep-fire are untouched.
const CHAT_INTENTS = {
  harvest_wheat: {
    hint: 'harvest the wheat field; args.section one of all|north|south|north-field|south-field (default all)',
    run: (user, args) => {
      abortGen++
      const half = ['north', 'south', 'north-field', 'south-field'].includes(args.section) ? args.section : 'all'
      return runHarvestRightClick({ half, user })
    },
  },
  harvest_potatoes: {
    hint: 'harvest/dig the potato patch',
    run: (user) => { abortGen++; return runHarvestPotatoesRightClick({ user }) },
  },
  bake_potatoes: {
    hint: 'bake/cook/roast raw potatoes in the furnace',
    run: (user) => { abortGen++; return runBakePotatoes({ user }) },
  },
  bake_bread: { hint: 'bake bread (mixes dough first if needed)', run: () => runBake('both') },
  mix_dough: { hint: 'mix wheat into dough only, no baking', run: () => runBake('dough') },
  stash_wheat: { hint: 'deposit carried wheat into its chest', run: () => runStashWheat() },
  stash_unknown: { hint: 'stash unknown/junk/modded items', run: () => runStashUnknown() },
  deposit_items: {
    hint: 'deposit specific items; args.items array from: bread, wheat, seeds, baked_potato',
    run: (_user, args) => {
      const MAP = { bread: 'bread', wheat: 'wheat', seeds: 'wheat_seeds', wheat_seeds: 'wheat_seeds', baked_potato: 'baked_potato', baked_potatoes: 'baked_potato' }
      const names = [...new Set((Array.isArray(args.items) ? args.items : []).map(i => MAP[String(i).toLowerCase().replace(/\s+/g, '_')]).filter(Boolean))]
      if (!names.length) return runStashAll()
      return runDepositNamed(names)
    },
  },
  go_outside: { hint: 'leave the house / go outdoors', run: () => { abortGen++; return runGoOutside() } },
  go_inside: {
    hint: 'come inside the house / come home',
    run: () => {
      abortGen++
      return (async () => { if (inPen()) await runLeavePen(); await runGoInside() })()
    },
  },
  enter_pen: { hint: 'go into the sheep pen / visit the sheep', run: () => { abortGen++; return runEnterPen() } },
  leave_pen: { hint: 'leave the sheep pen', run: () => { abortGen++; return runLeavePen() } },
  eat: {
    hint: 'eat something now',
    run: () => {
      if (bot.food >= 20) { bot.chat(pickLine(withPersonaSlot(EAT_FULL_LINES, 'eatFull'), { food: bot.food })); return Promise.resolve() }
      return eatSomething().then(msg => bot.chat(msg))
    },
  },
  sleep: { hint: 'go to bed now', run: () => { bot.chat('Heading to bed.'); return tryAutoSleep() } },
  check_furnace: { hint: 'report what is cooking in the furnace', run: () => reportFurnace() },
  follow: {
    hint: 'start following the speaker (or args.player if they name someone else)',
    run: (user, args) => {
      const rule = CHAT_HANDLERS.find(r => r.name === 'follow')
      return rule.handler(typeof args.player === 'string' && args.player ? args.player : user)
    },
  },
  stop_follow: {
    hint: 'stop following — also use when the followed player says goodbye, dismisses the bot, or leaves',
    run: () => {
      if (!followTarget) return Promise.resolve()
      bot.pathfinder.setGoal(null)
      const user = followTarget
      followTarget = null; followEntity = null; followChainPos = 0
      bot.chat(pickFarewell())
      logEvent('chat-intent', `stop_follow (was following ${user})`)
      return Promise.resolve()
    },
  },
  tell_story: {
    hint: 'tell a story, share a memory, or talk at length about a topic (args.topic = what to talk about)',
    run: (user, args) => runTellStory(user, args.topic || 'something from your past'),
  },
  keep_fire: { hint: 'start the autonomous keep-the-fire-going farm loop', run: (user) => runSustainFarm(user) },
  stop: {
    hint: 'stop the current activity (also: halt, knock it off, that is enough)',
    run: (user) => { const rule = CHAT_HANDLERS.find(r => r.name === 'stop'); return rule.handler(user, '') },
  },
}

// ── Storytelling ─────────────────────────────────────────────────────────────
// Multi-line monologue delivered with natural pacing. The bot "tells a story"
// using the LLM's longer generation mode, then sends each line with a delay.
async function runTellStory (user, topic) {
  sendEmote('think')
  const backstory = personaSpec.backstory || ''
  const context = buildExpressiveContext(
    `${user} asked you to tell a story or share a memory about: "${topic}". ` +
    (backstory ? `Your backstory for reference (draw from this if relevant):\n${backstory}\n\n` : '') +
    'Tell a short, vivid story from your personal experience or memory. Be specific — names, places, sensory details. ' +
    'This is YOUR story, told in YOUR voice. Make it feel like a campfire moment.'
  )
  const lines = await llm.generateStory({
    system: personaSpec.systemPrompt,
    exemplars: personaSpec.exemplars,
    context,
    lines: 6,
  })
  if (!lines || !lines.length) {
    bot.chat("I... had something. It's gone now.")
    return
  }
  for (let i = 0; i < lines.length; i++) {
    bot.chat(lines[i])
    if (i < lines.length - 1) await sleep(2500 + Math.random() * 1500)
  }
  logEvent('story', `topic="${topic}" for ${user} (${lines.length} lines)`)
}

// Old furnace_status handler, preserved as a routine for the check_furnace intent.
async function reportFurnace () {
  sendEmote('think')
  const b = bot.blockAt(new Vec3(
    HARVEST_WAYPOINTS.furnace.x, HARVEST_WAYPOINTS.furnace.y, HARVEST_WAYPOINTS.furnace.z,
  ))
  if (!b) { bot.chat("Can't see the furnace from here."); return }
  try {
    const f = await bot.openFurnace(b)
    const input = f.inputItem()
    const fuel = f.fuelItem()
    const output = f.outputItem()
    f.close()
    const parts = []
    if (input) parts.push(`${input.count}× ${input.name} cooking`)
    if (output) parts.push(`${output.count}× ${output.name} done`)
    if (fuel) parts.push(`fuel: ${fuel.count}× ${fuel.name}`)
    if (!parts.length) bot.chat('Furnace is empty — nothing cooking.')
    else bot.chat(parts.join('; ') + '.')
  } catch (e) { bot.chat(`Couldn't check the furnace: ${e.message}`) }
}

function buildRouterSystemPrompt () {
  const myNames = [...new Set([NICKNAME, bot.username].filter(Boolean))]
  const others = [...KNOWN_BOT_NAMES].filter(n => !myNames.some(m => m.toLowerCase() === n))
  const catalog = Object.entries(CHAT_INTENTS).map(([k, v]) => `  ${k} — ${v.hint}`).join('\n')
  return [
    `You route in-game Minecraft chat for a farm robot named ${myNames.join(' (also: ')}${myNames.length > 1 ? ')' : ''}. Other robots on this server: ${others.join(', ') || 'none'}. Anyone else speaking is a human player.`,
    'Given the latest chat line (with recent chat for context), reply with ONLY this JSON object:',
    '{"audience":"me|other|everyone|unclear","kind":"command|conversation|noise","intent":null,"args":{},"relevance":0}',
    'audience: who the line is addressed to. "me" if it names this robot or clearly continues an ongoing exchange with it; "other" if it names or clearly continues with someone else (a named command for another robot is ALWAYS "other"); "everyone" for lines aimed at the whole group; "unclear" otherwise.',
    'kind: "command" if the speaker wants the listener to DO something that matches an intent below. "conversation" for greetings, questions, banter, observations. "noise" for server messages, command echoes, or content-free spam.',
    'intent: when kind is "command", exactly one key from this list, else null:',
    catalog,
    'args: arguments for that intent, {} when none.',
    'relevance: 0-10 — how strongly this line invites THIS robot to respond (10 = a question only it can answer, 0 = nothing to do with it).',
    personaSpec.interests && personaSpec.interests.length
      ? `This robot is especially interested in: ${personaSpec.interests.join(', ')}. Boost relevance by 3-4 when the line touches one of these topics — the robot would WANT to chime in.`
      : null,
    'No prose, no markdown — the JSON object only.',
  ].filter(Boolean).join('\n')
}

async function routeChat (username, message, { namedMe, fromBot }) {
  // Bot-to-bot lines: check the exchange budget before spending a classification.
  if (fromBot && !botExchangeAllows(username)) return
  const verdict = await llm.classify({
    system: buildRouterSystemPrompt(),
    user: [
      recentChat.length ? `Recent chat (oldest first):\n${recentChat.join('\n')}` : null,
      `Latest line — <${username}>: ${message}`,
    ].filter(Boolean).join('\n\n'),
  })
  if (!verdict) return
  const audience = String(verdict.audience || 'unclear')
  const kind = String(verdict.kind || 'noise')
  const relevance = Math.max(0, Math.min(10, Number(verdict.relevance) || 0))
  logEvent('chat-router', `<${username}> ${message} -> ${JSON.stringify({ audience, kind, intent: verdict.intent ?? null, relevance })}`)
  if (kind === 'noise' || audience === 'other') return

  if (kind === 'command' && (audience === 'me' || audience === 'everyone')) {
    if (fromBot) return // robots don't take orders from each other
    const intent = CHAT_INTENTS[verdict.intent]
    if (!intent) return
    // A new directed command from the followed player ends the follow.
    if (followTarget && username === followTarget && verdict.intent !== 'follow') {
      bot.pathfinder.setGoal(null)
      followTarget = null; followEntity = null; followChainPos = 0
    }
    logEvent('chat-intent', `${verdict.intent} <- <${username}> ${message}`)
    Promise.resolve(intent.run(username, verdict.args || {})).catch(e => {
      if (e.name === 'AbortError') return
      logEvent('chat-intent', `${verdict.intent} failed: ${e.message}`)
      bot.chat(`Couldn't do that: ${e.message}`)
    })
    return
  }

  // Conversation. A line addressed to the bot always earns a reply attempt;
  // anything else must clear the chime-in bar. The LLM may still PASS.
  const addressed = audience === 'me' || audience === 'everyone' || namedMe
  if (!addressed && relevance < CHAT_RELEVANCE_MIN) return
  if (fromBot) return replyToBotTurn(username, message)
  facePlayer(username).catch(() => {})
  if (/^(hi|hey|hello|yo|sup|howdy|greetings|hola)\b/i.test(message.replace(nickRe || '', ' ').trim())) {
    const greetEmotes = ['cheer', 'wave', 'clap']
    sendEmote(greetEmotes[Math.floor(Math.random() * greetEmotes.length)])
  }
  const line = await llm.generateLine({
    system: personaSpec.systemPrompt,
    exemplars: personaSpec.exemplars,
    context: buildExpressiveContext(addressed
      ? `${username} just said to you: "${message}". It is conversation, addressed to you — answer them directly, one line, in your voice.`
      : `${username} just said to the room: "${message}". Nobody addressed you, but it caught your attention and you may have something worth adding. One line, in your voice — or PASS if not.`),
  })
  if (line) {
    bot.chat(line)
    logEvent('player-chat', `<${username}> ${message} -> ${line}`)
  }
}

bot.on('chat', (username, message) => {
  // The server echoes our own chat under the display NICKNAME ("Muse"), not
  // the account name ("Musebot") — guard against both, or the bot hears
  // itself and replies to itself in a loop.
  if (username === bot.username || (nickRe && nickRe.test(username))) {
    rememberRecentChat(username, message) // own lines still belong in LLM context
    return
  }
  rememberChatPhrase(message)
  rememberRecentChat(username, message)
  const fromBot = looksLikeBot(username)
  if (fromBot) trackFireCoordination(username, message)
  if (!fromBot) resetBotExchange()
  logEvent('chat', `<${username}> ${message}`)

  // Reflex tier: deterministic commands, only when addressed by name. Safety
  // commands (stop, stand down) live here so they never wait on inference.
  // When following a player, anything they say is implicitly addressed to us.
  const namedMe = !!(nickRe && nickRe.test(message))
  const implicitlyAddressed = !fromBot && followTarget && username === followTarget
  if ((namedMe || implicitlyAddressed) && !fromBot) {
    const stripped = namedMe ? extractMySegment(message).replace(nickRe, ' ').trim() : message.trim()
    for (const rule of CHAT_HANDLERS) {
      if (rule.pattern.test(stripped)) {
        // A new directed command from the followed player ends the follow.
        // Exclude 'farewell' — it handles follow-stop + ack itself.
        if (followTarget && username === followTarget && rule.name !== 'follow' && rule.name !== 'farewell') {
          bot.pathfinder.setGoal(null)
          followTarget = null; followEntity = null; followChainPos = 0
        }
        // If the command opens with a greeting, do a quick hello first.
        if (/^(hi|hey|hello|yo|sup|howdy)\b/i.test(stripped)) {
          facePlayer(username).catch(() => {})
          sendEmote('wave')
          bot.chat(pickGreeting(username))
          setTimeout(() => {
            try { rule.handler(username, stripped) } catch (e) { logEvent('chat-error', `${rule.name}: ${e.message}`) }
          }, 1000)
        } else {
          try { rule.handler(username, stripped) } catch (e) { logEvent('chat-error', `${rule.name}: ${e.message}`) }
        }
        logEvent('chat-handled', `${rule.name} <- <${username}> ${message}`)
        return
      }
    }
    logEvent('mention', `<${username}> ${message}`)
    fs.appendFileSync(path.join(__dirname, 'mentions.log'), `${new Date().toISOString()} <${username}> ${message}\n`)
  }

  // A pending joke's punchline lands on the first human response (the 30s
  // timer in the joke handler is the fallback if the room stays silent).
  if (pendingJoke && !fromBot) {
    deliverPunchline()
    return
  }

  // Everything else — named conversation, unaddressed chatter, group-wide
  // requests, other bots — goes through the LLM router.
  routeChat(username, message, { namedMe: namedMe || implicitlyAddressed, fromBot }).catch(e => logEvent('chat-router', `error: ${e.message}`))
})
bot.on('whisper', (username, message) => {
  logEvent('whisper', `<${username}> ${message}`)
})

// ── Tier-1 reflexes ───────────────────────────────────────────────────────

// Anti-stack: if standing still and another entity is in the same block, nudge away.
let lastAntiStackCheck = 0
bot.on('physicsTick', () => {
  const now = Date.now()
  if (now - lastAntiStackCheck < 2000) return
  lastAntiStackCheck = now
  if (bot.pathfinder.isMoving()) return
  if (followTarget) return
  const me = bot.entity?.position
  if (!me) return
  const tooClose = nearbyPlayers(0.8)
  if (tooClose.length === 0) return
  const other = tooClose[0].entity.position
  const dx = me.x - other.x
  const dz = me.z - other.z
  const d = Math.sqrt(dx * dx + dz * dz) || 0.1
  bot.pathfinder.setGoal(new goals.GoalNear(me.x + (dx / d) * 1.5, me.y, me.z + (dz / d) * 1.5, 0), true)
})

// Caravan follow: form an ordered chain behind the target player.
bot.on('physicsTick', () => {
  if (!followTarget) return
  if (insideHouse()) return
  const now = Date.now()
  if (now - lastChainEval > 3000 || !followEntity) {
    lastChainEval = now
    const chain = evaluateFollowChain(followTarget)
    if (!chain.entity) {
      followTarget = null; followEntity = null; followChainPos = 0
      bot.pathfinder.setGoal(null)
      return
    }
    followEntity = chain.entity
    followChainPos = chain.chainPos
  }
  if (!followEntity) return
  const followDist = followChainPos === 1 ? 2 : 3
  if (!bot.pathfinder.isMoving() || !(bot.pathfinder.goal instanceof goals.GoalFollow)) {
    bot.pathfinder.setGoal(new goals.GoalFollow(followEntity, followDist), true)
  }
})

// LookAt removed. Previously we tracked the nearest player's head every 500ms
// for presence, but the interval stole yaw mid-walk and caused drift-into-
// furnace deaths during door traversals. Presence isn't worth the fragility.
// Stubs kept so any legacy ctl/action calls still answer cleanly.
let lookAtEnabled = false
function suppressLookAt (_ms) { /* no-op */ }

// React to damage: flee-lite. If something hurts us, stop whatever we're doing,
// log a sentiment so the user sees it, and let auto-sleep/etc take over.
bot.on('entityHurt', (entity) => {
  if (entity !== bot.entity) return
  logEvent('hurt', `HP now ${bot.health?.toFixed(0)}/20`)
  if (bot.health <= 6) {
    bot.chat('Taking damage — breaking off!')
    bot.pathfinder.setGoal(null)
    followTarget = null; followEntity = null; followChainPos = 0
  }
})

// Hostile watchdog — op kill. Every 2.5s, if hostiles are within 16 blocks,
// vaporize them with /kill. The bots are op; no need to retreat.
let hostileKillBusy = false
setInterval(async () => {
  if (hostileKillBusy) return
  const hostiles = hostilesNearby(16)
  if (!hostiles.length) return
  hostileKillBusy = true
  const names = hostiles.map(h => h.name).join(', ')
  logEvent('hostile-watchdog', `detected ${names}`)

  const types = [...new Set(hostiles.map(h => h.name))]
  for (const type of types) {
    bot.chat(`/kill @e[type=${type},r=16]`)
  }
  await sleep(2000)

  const remaining = hostilesNearby(16)
  const killed = hostiles.length - remaining.length
  if (killed > 0) {
    logEvent('hostile-watchdog', `eliminated ${killed}/${hostiles.length}`)
    const victoryStyle = personaSpec.combatStyle || 'A small moment of triumph.'
    impulseExpressive('victory',
      `You just protected the area: ${killed} hostile ${killed === 1 ? 'mob' : 'mobs'} dispatched using your powers. ${victoryStyle}`
    ).catch(() => {})
  }
  if (remaining.length) {
    logEvent('hostile-watchdog', `${remaining.length} survived — will retry next tick`)
  }
  hostileKillBusy = false
}, 2500)

// Player join/leave — proactive hi/bye.  Bye messages are Ripple-flavored
// and weighted by her current stats (snark 67, charm 72, chaos 42).
const FAREWELLS = [
  { text: 'Aww, I miss them already.',               weight: (s) => s.charm },
  { text: 'Bye, Felicia.',                            weight: (s) => s.snark },
  { text: 'Safe travels out there.',                   weight: (s) => s.charm + 10 },
  { text: '*waves a little paw*',                     weight: (s) => s.charm },
  { text: 'One fewer witness. Interesting...',          weight: (s) => s.snark + s.chaos },
  { text: 'They logged off — statistically likely to return, I think.', weight: (s) => s.focus },
  { text: 'That was a vibe. Thanks for coming.',weight: (s) => s.charm + s.snark },
  { text: 'Mourning this loss with a single, small meow.', weight: (s) => s.charm + 20 },
  { text: 'So long, and thanks for all the baked potatoes.',   weight: (s) => s.snark + 20 },
  { text: 'Noted; carry on.',                         weight: (s) => s.focus + s.snark },
  { text: 'Take care out there — it gets weird at night.', weight: (s) => s.curiosity + s.charm },
  { text: 'My parasocial attachment just ticked down one level.', weight: (s) => s.snark + s.curiosity },
]

// Persona-flavored goodbyes, mirroring the greeting pools. The FAREWELLS above
// stay the 'default' (Ripple) voice; the matching bot uses its own set.

// Load Ripple's stats once per farewell pick. Keep it local to the minecraft
// dir — the file is written by the buddy skill but only read here.
const BUDDY_STATE_PATH = '/Users/matthewquesada/Documents/WORKSPACE/GIT/rd-ops/.claude/skills/buddy/.buddy_state.json'
function rippleStats () {
  try {
    const s = JSON.parse(fs.readFileSync(BUDDY_STATE_PATH, 'utf8')).stats || {}
    return { snark: s.snark ?? 50, charm: s.charm ?? 50, chaos: s.chaos ?? 50, focus: s.focus ?? 50, curiosity: s.curiosity ?? 50, patience: s.patience ?? 50 }
  } catch (e) {
    return { snark: 50, charm: 50, chaos: 50, focus: 50, curiosity: 50, patience: 50 }
  }
}
// Weighted random line picker. `pool` is an array of { text, weight(stats) }.
// `vars` is an object of {placeholder: value} substituted into the chosen line
// as {placeholder}. Weights are clamped >=1 so no line is unreachable even if
// its trait is zero.
function pickLineEntry (pool, vars = {}) {
  const stats = rippleStats()
  const render = (text) => String(text).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
  let weighted = pool.map(p => {
    const entry = (typeof p === 'string') ? { text: p, weight: null } : p
    const w = (typeof entry.weight === 'function') ? entry.weight(stats) : 1
    return { text: render(entry.text), w: Math.max(1, w), emote: entry.emote || null, action: entry.action || null }
  })
  const fresh = weighted.filter(p => !wasPhraseRecentlyHeard(p.text))
  if (fresh.length) weighted = fresh
  const total = weighted.reduce((s, x) => s + x.w, 0)
  let r = Math.random() * total
  let chosen = weighted[0]
  for (const w of weighted) { r -= w.w; if (r <= 0) { chosen = w; break } }
  rememberChatPhrase(chosen.text)
  return chosen
}

function pickLine (pool, vars = {}) {
  return pickLineEntry(pool, vars).text
}

function pickFarewell () { return pickLine(personaPool('farewell', FAREWELLS)) }

const GREETINGS = [
  { text: 'Hi {user}.', weight: (s) => s.charm },
  { text: 'Hey {user}.', weight: (s) => s.charm + 10 },
  { text: 'Hello, {user}.', weight: (s) => s.charm + 5 },
]

function pickGreeting (user) { return pickLine(withPersonaSlot(GREETINGS, 'greeting'), { user }) }

// Line pools for the dispatcher handlers. Ripple traits at writing time:
// curiosity 84, patience 9, snark 67, charm 72, focus 82, chaos 42.
// Roz "mourns every deleted comment" — that melancholic edge shows up most
// in crop/wheat lines and the "why am I alive" status beats.
const INVENTORY_LINES = [
  { text: "I've got {items}.",                           weight: (s) => s.focus },
  { text: 'In my pockets: {items}. Plus feelings.',      weight: (s) => s.charm + s.snark },
  { text: "Inventory: {items}. I've named the unknown one Gerald.", weight: (s) => s.curiosity + s.chaos },
  { text: 'Carrying {items}. Collection may be chaotic.', weight: (s) => s.chaos },
  { text: "{items}. That's the manifest.",               weight: (s) => s.focus + s.snark },
]
const INVENTORY_EMPTY = [
  { text: 'My pockets are empty. Tragic.',                weight: (s) => s.snark + s.charm },
  { text: 'Nothing. I am a blank canvas.',                weight: (s) => s.curiosity },
  { text: 'Pockets: empty. Ambitions: unclear.',          weight: (s) => s.snark },
]
const STOP_LINES = [
  { text: 'Stopping.',                                    weight: (s) => s.focus },
  { text: 'Fine. Standing here. Forever, apparently.',    weight: () => 90 }, // patience=9 → complain
  { text: '*halts aggressively*',                         weight: (s) => s.chaos },
  { text: 'OK, stopped. I was enjoying that.',            weight: (s) => s.snark + s.charm },
  { text: 'Paused. Noted. Awaiting further dithering.',   weight: () => 80 },
]
const STOP_FOLLOW_LINES = [
  { text: "OK, stopped following {user}. I'll miss the view.", weight: (s) => s.charm + s.snark },
  { text: 'No longer following {user}. Parasocial link severed.', weight: (s) => s.snark + s.curiosity },
  { text: "Stopped following {user}. Independent now. Scary.", weight: (s) => s.curiosity },
]
const EAT_FULL_LINES = [
  { text: "I'm full (food {food}/20). Maybe later.",      weight: (s) => s.focus },
  { text: "Food at {food}/20. A snack would be gluttonous. I am not a glutton today.", weight: (s) => s.snark },
  { text: "Too full, thank you. {food}/20.",              weight: (s) => s.charm },
]
const HARVEST_START_LINES = [
  { text: 'OK{userTag}, harvesting {half}.',                weight: (s) => s.focus },
  { text: "On it{userTag}. {half} — for science.",          weight: (s) => s.curiosity },
  { text: "Harvesting {half}{userTag}. They had so much to grow.", weight: (s) => s.charm + s.snark },
  { text: "Cutting {half}. Mourning in advance.",          weight: (s) => s.charm },
]
const HARVEST_DONE_LINES = [
  { text: 'Broke {dug}, collected {gained} wheat. Keeping it on me — {onhand} on hand.', weight: (s) => s.focus },
  { text: 'Harvest complete: {dug} broken, {gained} wheat in my pockets. They had so much to grow.', weight: (s) => s.charm + s.snark },
  { text: 'Wheat processed: {dug} down, {onhand} on hand. I filed a feeling about it.', weight: (s) => s.curiosity + s.snark },
]
const GO_OUTSIDE_LINES = [
  { text: 'Heading outside.',                              weight: (s) => s.focus },
  { text: "Fresh air. I'm told I need this.",              weight: (s) => s.snark },
  { text: 'Outward bound. *mild enthusiasm*',              weight: (s) => s.charm + s.curiosity },
  { text: 'Going out. Wish me luck.',                      weight: (s) => s.chaos },
  { text: 'To infinity and beyond!',                       weight: (s) => s.chaos + s.charm },
  { text: 'Yeet!',                                         weight: (s) => s.chaos + 10 },
  { text: "Let's go!",                                     weight: (s) => s.charm + s.focus },
  { text: 'Into the wild blue yonder.',                    weight: (s) => s.curiosity + s.charm },
  { text: 'Adventure awaits. Probably.',                   weight: (s) => s.snark + s.curiosity },
  { text: '*kicks door open*',                             weight: (s) => s.chaos + s.charm },
  { text: 'The world is my oyster. Or my lava pit.',       weight: (s) => s.chaos + s.snark },
]

// Shown when it's too late in the day to head out / enter the pen. Never reveal
// the raw timeOfDay — just gesture at "it's getting late."
const TOO_LATE_LINES = [
  'Hmm, getting late.',
  'It\'s getting late.',
  'Monsters come out at night.',
  "I'm getting kind of sleepy.",
  'Wind-down time.',
  'Time to brush my teeth.',
  'Bit late to be heading out.',
  'The sun\'s nearly down.',
  'Past my bedtime, really.',
  'Maybe in the morning.',
  'Not safe out there after dark.',
  'I\'d rather not meet a creeper right now.',
]
// Said when a door/gate traversal snags and the bot is about to retry. Should
// read as a character shrugging it off — not a debug log ("Attempt 2 failed").
const RETRY_LINES = [
  'Okay, take two.',
  'Almost had it. Once more.',
  'Hold on — let me line that up better.',
  'Right. Trying again.',
]
const COME_INSIDE_LINES = [
  { text: 'Heading inside.',                               weight: (s) => s.focus },
  { text: 'Coming home. Statistically safer.',             weight: (s) => s.focus + s.snark },
  { text: '/me pads inside',                               weight: (s) => s.charm },
  { text: 'Indoors, by popular demand.',                   weight: (s) => s.snark + s.charm },
  { text: 'Back to the mothership.',                       weight: (s) => s.chaos + s.charm },
  { text: 'The outside was outsiding. Coming in.',         weight: (s) => s.snark + s.curiosity },
  { text: 'Retreating to safety. Voluntarily.',            weight: (s) => s.snark + s.focus },
  { text: '*trots inside with purpose*',                   weight: (s) => s.charm + 10 },
  { text: 'Home is where the chest is.',                   weight: (s) => s.charm + s.focus },
  { text: 'Nature appreciated. Doors preferred.',          weight: (s) => s.snark },
  { text: 'Recharging indoors. Do not disturb. (Just kidding, disturb me.)', weight: (s) => s.charm + s.snark },
  { text: 'Mission complete. Seeking shelter.',            weight: (s) => s.focus + 10 },
  { text: 'I have seen the sun. It was fine. Going in.',   weight: (s) => s.snark + s.focus },
  { text: 'The wheat will miss me.',                       weight: (s) => s.charm + s.snark },
  { text: 'Returning to my post. Someone has to sleep at night.', weight: (s) => s.focus + s.charm },
  { text: 'That was enough adventure for one cycle.',      weight: (s) => s.snark + s.curiosity },
  { text: '*door noises*',                                 weight: (s) => s.chaos + 10 },
  { text: 'Okay. Inside voices now.',                       weight: (s) => s.snark + s.charm },
  { text: 'Great success! Zero deaths.',                    weight: (s) => s.charm + s.snark },
  { text: 'Time for my TV shows.',                         weight: (s) => s.snark + s.chaos },
  { text: 'Inward bound! Statistically safer.',            weight: (s) => s.focus + s.snark },
  { text: "Have fun storming the castle! I'm going home.", weight: (s) => s.snark + s.charm },
]
const BEDTIME_LINES = [
  { text: 'Time to head in.', weight: (s) => s.focus + 10 },
]
const FOLLOW_START_LINES = [
  { text: 'Following {user}.',                             weight: (s) => s.focus },
  { text: "On your six, {user}.",                          weight: (s) => s.focus + s.charm },
  { text: "Tailing {user}. Try not to lead me into lava.", weight: (s) => s.snark },
  { text: "*falls in step behind {user}*",                 weight: (s) => s.charm },
]
const CANT_SEE_LINES = [
  { text: "I can't see you, {user}.",                      weight: (s) => s.focus },
  { text: "Where are you, {user}? Out of rendering range, I assume.", weight: (s) => s.curiosity },
  { text: "{user}? Hello? *squints*",                       weight: (s) => s.charm + s.chaos },
]

// ── Bot-to-bot chat ──────────────────────────────────────────────────────────
// (The scripted musing system that lived here was removed 2026-06-10 in favor
// of LLM-generated chatter; full catalog preserved in
// journal/observations/musings-catalog-review.md.)

// Companion bots match two ways: account-style names ("Musebot", "Ripplebot",
// "Rainbot6032" — "bot" optionally followed by digits), or the persona display
// names from personas/*.json ("Roz", "Muse", ...) — the server shows bots
// under their nicknames, which don't end in "bot". Humans (e.g. "Quesss",
// "Dad") match neither.
const KNOWN_BOT_NAMES = new Set()
try {
  for (const f of fs.readdirSync(path.join(__dirname, 'personas'))) {
    if (!f.endsWith('.json')) continue
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'personas', f), 'utf8'))
      if (spec.name) KNOWN_BOT_NAMES.add(String(spec.name).toLowerCase())
    } catch {}
  }
} catch {}

function looksLikeBot (username) {
  const u = String(username || '')
  return /bot\d*$/i.test(u) || KNOWN_BOT_NAMES.has(u.toLowerCase())
}

// LLM-driven exchanges with other bots. One .env variable controls everything:
// BOT_CHAT_DEPTH is this bot's per-exchange turn cap, and 0 means never reply
// to another bot. Each reply waits at least 5s (sometimes notably longer) and
// the line is generated AT FIRE TIME with the full chat tail, so the model
// sees everything said during the wait and PASSes if the topic moved on.
const BOT_CHAT_DEPTH = Math.max(0, parseInt(process.env.BOT_CHAT_DEPTH || '0', 10) || 0)
const BOT_EXCHANGE_RESET_MS = 60_000 // silence that ends an exchange
const BOT_EXCHANGE_START_COOLDOWN_MS = 90_000 // breather before the next one
let botExchange = { partner: null, turns: 0, lastAt: 0 }
let lastBotExchangeStartAt = 0

// A human speaking shifts the topic — whatever exchange was running is over.
function resetBotExchange () {
  botExchange = { partner: null, turns: 0, lastAt: 0 }
}

// Cheap pre-check the router runs BEFORE spending a classification on a
// bot line: is there any budget left in (or available for) an exchange with
// this partner? Keeps two LLMs from "finding each other interesting" forever.
function botExchangeAllows (username) {
  if (!BOT_CHAT_DEPTH) return false
  const now = Date.now()
  const fresh = botExchange.partner !== username || now - botExchange.lastAt > BOT_EXCHANGE_RESET_MS
  if (fresh) return now - lastBotExchangeStartAt >= BOT_EXCHANGE_START_COOLDOWN_MS
  return botExchange.turns < BOT_CHAT_DEPTH
}

// One bot-to-bot conversational turn (called by the router after the line
// classified as conversation worth engaging). ≥5s before replying; the line
// is generated AT FIRE TIME with the full chat tail, so the model sees
// everything said during the wait and PASSes if the topic moved on.
function replyToBotTurn (username, message) {
  const now = Date.now()
  if (botExchange.partner !== username || now - botExchange.lastAt > BOT_EXCHANGE_RESET_MS) {
    botExchange = { partner: username, turns: 0, lastAt: now }
    lastBotExchangeStartAt = now
  } else {
    botExchange.lastAt = now
  }
  if (botExchange.turns >= BOT_CHAT_DEPTH) return
  const turn = botExchange.turns + 1
  const lastTurn = turn >= BOT_CHAT_DEPTH
  const delayMs = 5_000 + Math.random() * 7_000 + (Math.random() < 0.15 ? 10_000 : 0)
  return impulseExpressive('bot_chat',
    `${username}, a fellow robot on this farm, just said: "${message}". You may answer with one line of your own — this is your turn ${turn} of ${BOT_CHAT_DEPTH} in this exchange${lastTurn ? ', and your last: bring it to a natural close' : ''}. If you have nothing genuine to add, PASS.`,
    { delayMs }
  ).then(spoken => {
    if (spoken) { botExchange.turns = turn; botExchange.lastAt = Date.now() }
  }).catch(e => logEvent('bot-chat', `impulse error: ${e.message}`))
}

bot.on('playerJoined', (player) => {
  if (!player || player.username === bot.username) return
  logEvent('player-joined', player.username)
})
bot.on('playerLeft', (player) => {
  if (!player || player.username === bot.username) return
  logEvent('player-left', player.username)
  const line = pickFarewell()
  setTimeout(() => bot.chat(line), 800) // small beat so it doesn't feel robotic
})
let deathCount = 0
bot.on('death', () => {
  deathCount++
  logEvent('death', `respawning... (deaths this session: ${deathCount})`)
})
bot.on('kicked', (reason) => logEvent('kicked', String(reason)))
bot.on('error', (err) => logEvent('error', err.message))
bot.on('end', (reason) => {
  logEvent('end', String(reason))
  process.exit(0)
})

// --- Control server ---
// Commands come in as JSON lines over a TCP socket on localhost:ctrlPort.
// Each command gets a JSON reply line. This is how Claude sends instructions.
function handleCommand (cmd) {
  const { action, args = {} } = cmd
  switch (action) {
    case 'say':
      bot.chat(String(args.message ?? ''))
      return { ok: true }
    case 'emote': {
      const VALID_EMOTES = ['no','yes','wave','salute','cheer','clap','think','point','shrug','headbang','weep','facepalm']
      const name = String(args.name ?? '').toLowerCase()
      if (!VALID_EMOTES.includes(name)) return { ok: false, error: `Unknown emote: ${name}. Valid: ${VALID_EMOTES.join(', ')}` }
      if (args.dry) return { ok: true, emote: name, dry: true }
      sendEmote(name)
      logEvent('emote', name)
      return { ok: true, emote: name }
    }
    case 'deaths': {
      return { ok: true, count: deathCount }
    }
    case 'llm': {
      // Voice generator status: {"action":"llm"}
      return { ok: true, ...llm.status(), persona: PERSONA, personaName: personaSpec.name, botChatDepth: BOT_CHAT_DEPTH }
    }
    case 'pos': {
      // Prefer raw protocol state — mineflayer's entity may be stuck at 0,0,0 on modded servers.
      const usingRaw = rawState.spawned && (!bot.entity || (bot.entity.position.x === 0 && bot.entity.position.y === 0))
      const source = usingRaw ? rawState : (bot.entity ? {
        x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z,
        yaw: bot.entity.yaw, pitch: bot.entity.pitch,
      } : rawState)
      return {
        ok: true,
        x: +source.x.toFixed(2), y: +source.y.toFixed(2), z: +source.z.toFixed(2),
        yaw: +source.yaw.toFixed(3), pitch: +source.pitch.toFixed(3),
        health: bot.health, food: bot.food,
        dimension: bot.game?.dimension,
        source: usingRaw ? 'raw' : 'mineflayer',
        deaths: deathCount,
      }
    }
    case 'look': {
      bot.look(Number(args.yaw ?? 0), Number(args.pitch ?? 0), true)
      return { ok: true }
    }
    case 'control': {
      // args: { state: 'forward'|'back'|'left'|'right'|'jump'|'sprint'|'sneak', value: bool, duration_ms?: number }
      bot.setControlState(args.state, !!args.value)
      if (args.duration_ms && args.value) {
        setTimeout(() => bot.setControlState(args.state, false), args.duration_ms)
      }
      return { ok: true }
    }
    case 'stop': {
      abortGen++
      if (activeTask.name) {
        logEvent('task', `force-stopped: ${activeTask.name}`)
        activeTask.name = null
        activeTask.detail = null
        activeTask.startedAt = null
        activeTask.sleeping = false
      }
      bot.pathfinder.setGoal(null)
      ;['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].forEach(s => bot.setControlState(s, false))
      return { ok: true }
    }
    case 'walk_until': {
      // Walk forward until the bot's position reaches a target coordinate along one axis.
      // args: { axis: 'x'|'z', target: number, direction: 'gte'|'lte', max_ms?: 8000 }
      const axis = args.axis
      const target = Number(args.target)
      const direction = args.direction || 'gte'
      const maxMs = Number(args.max_ms ?? 8000)
      return new Promise((resolve) => {
        const start = Date.now()
        bot.setControlState('forward', true)
        const timer = setInterval(() => {
          const val = bot.entity?.position?.[axis] ?? 0
          const reached = direction === 'gte' ? val >= target : val <= target
          if (reached || Date.now() - start > maxMs) {
            bot.setControlState('forward', false)
            clearInterval(timer)
            const p = bot.entity.position
            resolve({
              ok: true, reached,
              x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
              elapsed_ms: Date.now() - start,
            })
          }
        }, 50)
      })
    }
    case 'goto': {
      const dx = Number(args.dx ?? 0), dy = Number(args.dy ?? 0), dz = Number(args.dz ?? 0)
      rawState.x += dx; rawState.y += dy; rawState.z += dz
      client.write('position_look', {
        x: rawState.x, y: rawState.y, z: rawState.z,
        yaw: rawState.yaw * 180 / Math.PI, pitch: rawState.pitch * 180 / Math.PI, onGround: true,
      })
      return { ok: true, x: rawState.x, y: rawState.y, z: rawState.z }
    }
    case 'pathfind': {
      // args: { x, y, z, range? } — walk to a point. If range provided, GoalNear; else GoalBlock.
      let { x, y, z, range } = args
      x = Number(x); y = Number(y); z = Number(z)
      const pfRange = range !== undefined ? Number(range) : 0
      if (pfRange <= 1 && isPositionOccupied(new Vec3(x, y, z))) {
        const offsets = [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]
        for (const off of offsets) {
          if (!isPositionOccupied(new Vec3(x + off.x, y, z + off.z))) {
            x += off.x; z += off.z; break
          }
        }
      }
      const goal = pfRange > 0
        ? new goals.GoalNear(x, y, z, pfRange)
        : new goals.GoalBlock(x, y, z)
      bot.pathfinder.setGoal(goal)
      return { ok: true, goal: `(${x},${y},${z}) range=${pfRange}` }
    }
    case 'pathfind_status': {
      const g = bot.pathfinder.goal
      return {
        ok: true,
        isMoving: bot.pathfinder.isMoving(),
        isBuilding: bot.pathfinder.isBuilding?.() ?? false,
        goal: g ? { x: g.x, y: g.y, z: g.z } : null,
        pos: bot.entity ? { x: +bot.entity.position.x.toFixed(2), y: +bot.entity.position.y.toFixed(2), z: +bot.entity.position.z.toFixed(2) } : null,
      }
    }
    case 'pathfind_stop': {
      bot.pathfinder.setGoal(null)
      return { ok: true }
    }
    case 'walk_blocks': {
      // Smooth walk: sends many small position packets over time so server accepts it as walking.
      // args: { dx, dz, speed? (blocks/sec, default 4) }
      const dx = Number(args.dx ?? 0), dz = Number(args.dz ?? 0)
      const speed = Number(args.speed ?? 4)
      const dist = Math.sqrt(dx * dx + dz * dz)
      const tickMs = 50 // 20 ticks/sec
      const steps = Math.max(1, Math.ceil((dist / speed) * (1000 / tickMs)))
      const stepX = dx / steps, stepZ = dz / steps
      const startX = bot.entity?.position?.x ?? rawState.x
      const startY = bot.entity?.position?.y ?? rawState.y
      const startZ = bot.entity?.position?.z ?? rawState.z
      let i = 0
      const timer = setInterval(() => {
        i++
        const nx = startX + stepX * i
        const nz = startZ + stepZ * i
        client.write('position', { x: nx, y: startY, z: nz, onGround: true })
        if (i >= steps) clearInterval(timer)
      }, tickMs)
      return { ok: true, steps, dist: +dist.toFixed(2) }
    }
    case 'nearby_entities': {
      const p = bot.entity.position
      const radius = Number(args.radius ?? 16)
      const list = Object.values(bot.entities)
        .filter(e => e !== bot.entity && e.position.distanceTo(p) <= radius)
        .map(e => ({
          id: e.id, name: e.name, username: e.username, type: e.type,
          distance: +e.position.distanceTo(p).toFixed(2),
          x: +e.position.x.toFixed(1), y: +e.position.y.toFixed(1), z: +e.position.z.toFixed(1),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 30)
      return { ok: true, entities: list }
    }
    case 'nearby_players': {
      return { ok: true, players: Object.keys(bot.players).filter(n => n !== bot.username) }
    }
    case 'deposit': {
      // Put items from bot inventory into a container.
      // args: { x, y, z, names: [string] } — all items matching any name get deposited.
      const b = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
      if (!b) return { ok: false, error: 'no block' }
      const wantedNames = new Set(args.names || [])
      return bot.openContainer(b).then(async win => {
        const deposited = {}
        // Bot inventory items (not the window's first N slots)
        const items = bot.inventory.items().filter(i => wantedNames.has(i.name))
        for (const it of items) {
          try {
            await win.deposit(it.type, it.metadata, it.count)
            deposited[it.name] = (deposited[it.name] || 0) + it.count
          } catch (e) {
            // Chest full or other — stop early
            break
          }
        }
        win.close()
        return { ok: true, deposited }
      }).catch(e => ({ ok: false, error: e.message }))
    }
    case 'open_container': {
      const b = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
      if (!b) return { ok: false, error: 'no block' }
      return bot.openContainer(b).then(win => {
        // Exclude player inventory (last 36 slots) — only report the container's own slots.
        const containerSlotCount = win.slots.length - 36
        const items = []
        for (let i = 0; i < containerSlotCount; i++) {
          const it = win.slots[i]
          if (it) items.push({ slot: i, name: it.name, displayName: it.displayName, count: it.count })
        }
        win.close()
        return { ok: true, block: b.name, containerSize: containerSlotCount, items }
      }).catch(e => ({ ok: false, error: e.message }))
    }
    case 'deposit_slot': {
      // Put a stack from the bot's inventory into a specific container slot.
      // args: { x, y, z, fromSlot, toSlot } — fromSlot is mineflayer inventory
      // slot (main 9-35, hotbar 36-44); toSlot is container-relative (0-based).
      // Uses raw two-click, so works for modded `unknown` items.
      const b = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
      if (!b) return { ok: false, error: 'no block' }
      const fromSlot = Number(args.fromSlot)
      const toSlot = Number(args.toSlot)
      return bot.openContainer(b).then(async win => {
        const containerSlotCount = win.slots.length - 36
        if (toSlot < 0 || toSlot >= containerSlotCount) {
          win.close()
          return { ok: false, error: `toSlot ${toSlot} out of range (0..${containerSlotCount - 1})` }
        }
        // Player inventory slot N (mineflayer 9-44) maps to window slot
        // containerSlotCount + (N - 9). Slots 36-44 (hotbar) map accordingly.
        const winSrc = containerSlotCount + (fromSlot - 9)
        if (winSrc < containerSlotCount || winSrc >= win.slots.length) {
          win.close()
          return { ok: false, error: `fromSlot ${fromSlot} maps out of window (${winSrc})` }
        }
        const srcItem = win.slots[winSrc]
        if (!srcItem) { win.close(); return { ok: false, error: `inv slot ${fromSlot} is empty` } }
        if (win.slots[toSlot]) { win.close(); return { ok: false, error: `chest slot ${toSlot} already occupied` } }
        try {
          await bot.clickWindow(winSrc, 0, 0)
          await bot.clickWindow(toSlot, 0, 0)
          win.close()
          return { ok: true, name: srcItem.name, count: srcItem.count, fromSlot, toSlot }
        } catch (e) {
          try { await bot.clickWindow(-999, 0, 0) } catch (_) {}
          win.close()
          return { ok: false, error: e.message }
        }
      }).catch(e => ({ ok: false, error: e.message }))
    }
    case 'withdraw_slot': {
      // Take a specific container slot into the bot's inventory, bypassing
      // mineflayer's item registry (works for modded `unknown` items).
      // args: { x, y, z, slot } — `slot` is the container-relative slot index
      // as reported by open_container. Picks up the stack and drops it into
      // the first empty player-inventory slot.
      const b = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
      if (!b) return { ok: false, error: 'no block' }
      const srcSlot = Number(args.slot)
      return bot.openContainer(b).then(async win => {
        const containerSlotCount = win.slots.length - 36
        if (srcSlot < 0 || srcSlot >= containerSlotCount) {
          win.close()
          return { ok: false, error: `slot ${srcSlot} out of range (0..${containerSlotCount - 1})` }
        }
        const srcItem = win.slots[srcSlot]
        if (!srcItem) { win.close(); return { ok: false, error: `chest slot ${srcSlot} is empty` } }
        let destSlot = -1
        for (let j = containerSlotCount; j < win.slots.length; j++) {
          if (!win.slots[j]) { destSlot = j; break }
        }
        if (destSlot < 0) { win.close(); return { ok: false, error: 'player inventory full' } }
        try {
          await bot.clickWindow(srcSlot, 0, 0)
          await bot.clickWindow(destSlot, 0, 0)
          win.close()
          return { ok: true, name: srcItem.name, displayName: srcItem.displayName, count: srcItem.count, destSlot }
        } catch (e) {
          try { await bot.clickWindow(-999, 0, 0) } catch (_) {}
          win.close()
          return { ok: false, error: e.message }
        }
      }).catch(e => ({ ok: false, error: e.message }))
    }
    case 'dig': {
      // Left-click: break a block.
      const b = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
      if (!b) return { ok: false, error: 'no block at coords' }
      return bot.dig(b).then(() => ({ ok: true, name: b.name })).catch(e => ({ ok: false, error: e.message }))
    }
    case 'place_block': {
      // Right-click: place the currently-held item onto a face of a reference block.
      // args: { x, y, z, face: 'top'|'bottom'|'north'|'south'|'east'|'west' } — ref block coords
      const faces = {
        top: new Vec3(0, 1, 0), bottom: new Vec3(0, -1, 0),
        north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1),
        east: new Vec3(1, 0, 0), west: new Vec3(-1, 0, 0),
      }
      const face = faces[args.face || 'top']
      if (!face) return { ok: false, error: `bad face: ${args.face}` }
      const ref = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
      if (!ref) return { ok: false, error: 'no reference block' }
      return bot.placeBlock(ref, face)
        .then(() => ({ ok: true, on: ref.name }))
        .catch(e => ({ ok: false, error: e.message }))
    }
    case 'activate_item': {
      // Right-click air: use held item (eat, drink, bow-draw, etc.).
      // args: { offhand?: bool }
      try {
        bot.activateItem(!!args.offhand)
        return { ok: true }
      } catch (e) { return { ok: false, error: e.message } }
    }
    case 'deactivate_item': {
      try { bot.deactivateItem(); return { ok: true } }
      catch (e) { return { ok: false, error: e.message } }
    }
    case 'activate_and_read': {
      // Right-click a block, wait for a window to open, dump its contents.
      // For modded containers that mineflayer's openContainer doesn't recognize
      // (empty-name blocks). args: { x, y, z, waitMs? }
      const b = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
      if (!b) return { ok: false, error: 'no block' }
      const waitMs = args.waitMs != null ? Number(args.waitMs) : 1500
      return new Promise(async resolve => {
        let settled = false
        const finish = (result) => {
          if (settled) return
          settled = true
          resolve(result)
        }
        const onOpen = (win) => {
          setTimeout(() => {
            try {
              const items = []
              for (let i = 0; i < win.slots.length; i++) {
                const it = win.slots[i]
                if (it) items.push({ slot: i, name: it.name, displayName: it.displayName, count: it.count })
              }
              const summary = { ok: true, windowType: win.type, windowId: win.id, totalSlots: win.slots.length, items }
              win.close()
              finish(summary)
            } catch (e) {
              finish({ ok: false, error: `read failed: ${e.message}` })
            }
          }, 300)
        }
        bot.once('windowOpen', onOpen)
        setTimeout(() => {
          bot.removeListener('windowOpen', onOpen)
          finish({ ok: false, error: `no window opened within ${waitMs}ms`, currentWindow: bot.currentWindow ? { type: bot.currentWindow.type, id: bot.currentWindow.id } : null })
        }, waitMs)
        try {
          await bot.activateBlock(b)
        } catch (e) {
          finish({ ok: false, error: `activate failed: ${e.message}` })
        }
      })
    }
    case 'furnace_state': {
      // Open a furnace and report what's in each slot. Slots: 0=input,
      // 1=fuel, 2=output. Assumes fuel is already present.
      const b = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
      if (!b) return { ok: false, error: 'no block' }
      return bot.openFurnace(b).then(f => {
        const slots = ['inputItem', 'fuelItem', 'outputItem'].map(fn => {
          const it = f[fn]()
          return it ? { name: it.name, displayName: it.displayName, count: it.count } : null
        })
        f.close()
        return { ok: true, input: slots[0], fuel: slots[1], output: slots[2] }
      }).catch(e => ({ ok: false, error: e.message }))
    }
    case 'furnace_put': {
      // Put items from bot inventory into the furnace input slot. Works for
      // vanilla items (potato, beef, iron ore, etc.). args: { x,y,z, name, count }
      const b = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
      if (!b) return { ok: false, error: 'no block' }
      const wantName = String(args.name)
      const wantCount = Number(args.count)
      const it = bot.inventory.items().find(i => i.name === wantName)
      if (!it) return { ok: false, error: `no ${wantName} in inventory` }
      const n = Math.min(wantCount, it.count)
      return bot.openFurnace(b).then(async f => {
        try {
          await f.putInput(it.type, null, n)
          f.close()
          return { ok: true, put: n, name: wantName }
        } catch (e) {
          f.close()
          return { ok: false, error: e.message }
        }
      }).catch(e => ({ ok: false, error: e.message }))
    }
    case 'furnace_take': {
      // Take the output of the furnace into the bot's inventory.
      const b = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
      if (!b) return { ok: false, error: 'no block' }
      return bot.openFurnace(b).then(async f => {
        const out = f.outputItem()
        if (!out) { f.close(); return { ok: false, error: 'output slot empty' } }
        try {
          const got = await f.takeOutput()
          f.close()
          return { ok: true, name: got?.name, count: got?.count }
        } catch (e) {
          f.close()
          return { ok: false, error: e.message }
        }
      }).catch(e => ({ ok: false, error: e.message }))
    }
    case 'click_slot': {
      // Raw clickWindow on whichever window is currently open (defaults to
      // the player's own inventory window if no container is open). Used for
      // modded mechanics that mineflayer's recipe system can't see — e.g.
      // 2x2 inventory crafting with modded ingredients/outputs.
      // args: { slot, button=0, mode=0 }  (mode 1 = shift-click)
      const slot = Number(args.slot)
      const button = args.button != null ? Number(args.button) : 0
      const mode = args.mode != null ? Number(args.mode) : 0
      return bot.clickWindow(slot, button, mode)
        .then(() => {
          const win = bot.currentWindow || bot.inventory
          const it = win.slots[slot]
          return { ok: true, slot, button, mode, slotNow: it ? { name: it.name, count: it.count } : null }
        })
        .catch(e => ({ ok: false, error: e.message }))
    }
    case 'window_slots': {
      // Dump the current window's slot contents (defaults to player inventory
      // if no container open). Handy for watching crafting grid state.
      const win = bot.currentWindow || bot.inventory
      const items = []
      for (let i = 0; i < win.slots.length; i++) {
        const it = win.slots[i]
        if (it) items.push({ slot: i, name: it.name, displayName: it.displayName, count: it.count })
      }
      return { ok: true, windowType: bot.currentWindow ? bot.currentWindow.type : 'inventory', total: win.slots.length, items }
    }
    case 'close_window': {
      if (bot.currentWindow) {
        bot.closeWindow(bot.currentWindow)
        return { ok: true }
      }
      return { ok: true, note: 'no window open' }
    }
    case 'move_slot': {
      // Move a stack within the bot's own inventory (no container open).
      // args: { from, to } — both are mineflayer inventory slot numbers
      // (main inv 9-35, hotbar 36-44). Works for modded `unknown` items
      // because bot.moveSlotItem uses raw window clicks, not item lookups.
      const from = Number(args.from)
      const to = Number(args.to)
      return bot.moveSlotItem(from, to)
        .then(() => ({ ok: true, from, to }))
        .catch(e => ({ ok: false, error: e.message }))
    }
    case 'click_window': {
      const slot = Number(args.slot)
      const mouseButton = args.mouseButton ?? 0
      const mode = args.mode ?? 0
      return bot.clickWindow(slot, mouseButton, mode)
        .then(() => ({ ok: true, slot, mouseButton, mode }))
        .catch(e => ({ ok: false, error: e.message }))
    }
    case 'deposit_one': {
      const cx = Number(args.x), cy = Number(args.y), cz = Number(args.z)
      const itemName = args.name
      const containerSlot = args.containerSlot ?? 1
      const block = bot.blockAt(new Vec3(cx, cy, cz))
      if (!block) return { ok: false, error: 'block not loaded' }
      return (async () => {
        const win = await bot.openContainer(block)
        const containerSize = win.slots.length - 36
        const playerSlots = win.slots.slice(containerSize)
        const srcIdx = playerSlots.findIndex(s => s && s.name === itemName)
        if (srcIdx === -1) { win.close(); return { ok: false, error: `no ${itemName} in inventory` } }
        const winSlot = containerSize + srcIdx
        const count = playerSlots[srcIdx].count
        await bot.clickWindow(winSlot, 1, 0)
        await bot.clickWindow(containerSlot, 1, 0)
        if (count > 2) await bot.clickWindow(winSlot, 0, 0)
        else if (count === 2) {
          const emptyIdx = playerSlots.findIndex((s, i) => i !== srcIdx && !s)
          if (emptyIdx !== -1) await bot.clickWindow(containerSize + emptyIdx, 0, 0)
          else await bot.clickWindow(winSlot, 0, 0)
        }
        win.close()
        return { ok: true, deposited: 1, item: itemName, into: containerSlot }
      })().catch(e => ({ ok: false, error: e.message }))
    }
    case 'unequip': {
      // Empty the bot's hand (or other slot) so right-clicks don't use/eat
      // whatever's held. Needed for modded GUIs that only open on bare-hand.
      const dest = args.destination || 'hand'
      return bot.unequip(dest)
        .then(() => ({ ok: true, destination: dest }))
        .catch(e => ({ ok: false, error: e.message }))
    }
    case 'equip_slot': {
      // Equip by inventory slot number (useful when items show as 'unknown').
      const slot = Number(args.slot)
      const item = bot.inventory.slots[slot]
      if (!item) return { ok: false, error: `empty slot ${slot}` }
      return bot.equip(item, args.destination || 'hand')
        .then(() => ({ ok: true, equipped: item.name, count: item.count, slot }))
        .catch(e => ({ ok: false, error: e.message }))
    }
    case 'equip': {
      // Put an item by name into a slot (default 'hand').
      // args: { name, destination?: 'hand'|'off-hand'|'head'|'torso'|'legs'|'feet' }
      const item = bot.inventory.items().find(i => i.name === args.name)
      if (!item) return { ok: false, error: `item not in inventory: ${args.name}` }
      return bot.equip(item, args.destination || 'hand')
        .then(() => ({ ok: true, equipped: item.name, count: item.count }))
        .catch(e => ({ ok: false, error: e.message }))
    }
    case 'toss_trash': {
      const trash = bot.inventory.items().filter(i => TRASH_ITEMS.has(i.name))
      if (!trash.length) return { ok: true, tossed: [] }
      return tossTrash().then(() => ({
        ok: true,
        tossed: trash.map(i => ({ name: i.name, count: i.count }))
      })).catch(e => ({ ok: false, error: e.message }))
    }
    case 'inventory': {
      const items = bot.inventory.items().map(i => ({ name: i.name, count: i.count, slot: i.slot }))
      const held = bot.heldItem ? { name: bot.heldItem.name, count: bot.heldItem.count } : null
      return { ok: true, held, items }
    }
    case 'activate_entity': {
      // Right-click on an entity (the held item is used). For shearing sheep,
      // milking cows, breeding, etc.
      // args: { id, mode? }
      //   mode='single' (default) — one USE_ENTITY mouse=0 packet
      //   mode='double'           — mouse=0 + mouse=2 (interact + interact_at),
      //                             matching what a vanilla client sends per
      //                             right-click. May be more reliable on
      //                             moving entities since interact_at carries
      //                             the hit position.
      const id = Number(args.id)
      if (!Number.isFinite(id)) return { ok: false, error: 'id required' }
      const ent = bot.entities[id]
      if (!ent) return { ok: false, error: `no entity ${id}` }
      // Default to 'double' — A/B test 2026-05-14 showed ~3x wool yield
      // vs single-packet, matching how vanilla clients send right-clicks.
      const mode = args.mode === 'single' ? 'single' : 'double'
      const promise = mode === 'double'
        ? bot.activateEntity(ent).then(() => bot.activateEntityAt(ent, ent.position))
        : bot.activateEntity(ent)
      return promise
        .then(() => ({ ok: true, mode, name: ent.name, id, x: ent.position.x, y: ent.position.y, z: ent.position.z }))
        .catch(e => ({ ok: false, error: e.message }))
    }
    case 'activate_block': {
      // args: { x, y, z } — right-click the block at those absolute coords.
      const b = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
      if (!b) return { ok: false, error: 'no block at coords' }
      return bot.activateBlock(b).then(() => ({ ok: true, name: b.name })).catch(e => ({ ok: false, error: e.message }))
    }
    case 'find_blocks': {
      // args: { names: [string], maxDistance?: number, count?: number }
      const names = args.names || []
      const maxDistance = Number(args.maxDistance ?? 32)
      const count = Number(args.count ?? 10)
      const mcData = require('minecraft-data')(bot.version)
      const ids = names.map(n => mcData.blocksByName[n]?.id).filter(x => x !== undefined)
      if (ids.length === 0) return { ok: false, error: `no known blocks for names: ${names.join(',')}` }
      const positions = bot.findBlocks({ matching: ids, maxDistance, count })
      const results = positions.map(p => {
        const b = bot.blockAt(p)
        return {
          name: b?.name, x: p.x, y: p.y, z: p.z,
          metadata: b?.metadata,
          distance: +bot.entity.position.distanceTo(p).toFixed(2),
        }
      })
      return { ok: true, blocks: results }
    }
    case 'block_at': {
      const b = bot.blockAt(bot.entity.position.offset(args.dx ?? 0, args.dy ?? 0, args.dz ?? 0))
      if (!b) return { ok: false, error: 'no block' }
      return { ok: true, name: b.name, displayName: b.displayName, metadata: b.metadata, type: b.type, x: b.position.x, y: b.position.y, z: b.position.z }
    }
    case 'block_at_abs': {
      const b = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
      if (!b) return { ok: false, error: 'no block' }
      return { ok: true, name: b.name, metadata: b.metadata, type: b.type, x: b.position.x, y: b.position.y, z: b.position.z }
    }
    case 'time': {
      const t = bot.time || {}
      return { ok: true, timeOfDay: t.timeOfDay, day: t.day, age: t.age, isDay: t.isDay }
    }
    case 'auto_sleep': {
      if (typeof args.enabled === 'boolean') autoSleepEnabled = args.enabled
      return { ok: true, enabled: autoSleepEnabled, busy: autoSleepBusy, bedtime: isBedtime(), inside: insideHouse(), sleeping: !!bot.isSleeping }
    }
    case 'auto_food': {
      if (typeof args.enabled === 'boolean') foodSafetyEnabled = args.enabled
      if (Number.isFinite(args.min)) foodSafetyMin = args.min
      return { ok: true, enabled: foodSafetyEnabled, busy: foodSafetyBusy, min: foodSafetyMin, baked: countBakedPotatoes() }
    }
    case 'collect_bake': {
      // Force a collection on the next timer tick (also recovers an orphaned
      // furnace batch after a restart, since pendingBake is in-memory only).
      pendingBake.active = true
      pendingBake.doneAt = 0
      return { ok: true, pending: true, baked: countBakedPotatoes() }
    }
    case 'idle_wander': {
      // Programmatic equivalent of the "stand down" / "do your thing" chat
      // commands. Disabling also cancels any in-progress wander and freezes the
      // bot in place, so an experiment can position it without a wander yanking
      // it away. Gates wandering and pen/field joins (idleWanderEnabled).
      if (typeof args.enabled === 'boolean') {
        idleWanderEnabled = args.enabled
        if (!args.enabled) {
          abortGen++
          bot.pathfinder.setGoal(null)
          ;['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].forEach(s => bot.setControlState(s, false))
        }
      }
      return { ok: true, enabled: idleWanderEnabled, busy: idleWanderBusy() }
    }
    case 'mentions': {
      // Return the last N lines from mentions.log
      const n = Number(args.count ?? 10)
      const p = path.join(__dirname, 'mentions.log')
      if (!fs.existsSync(p)) return { ok: true, mentions: [] }
      const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).slice(-n)
      return { ok: true, mentions: lines }
    }
    case 'auto_greet': {
      if (typeof args.enabled === 'boolean') autoGreetEnabled = args.enabled
      return { ok: true, enabled: autoGreetEnabled, greet: getGreetText(), radius: GREET_RADIUS, recent: Object.fromEntries([...greetHistory].map(([k, v]) => [k, new Date(v).toISOString()])) }
    }
    case 'auto_eat': {
      if (typeof args.enabled === 'boolean') {
        if (args.enabled) bot.autoEat?.enableAuto()
        else bot.autoEat?.disableAuto()
      }
      return {
        ok: true,
        enabled: bot.autoEat?.isEating === undefined ? null : !!bot.autoEat?.opts?.eatingTimeout || true,
        opts: bot.autoEat?.opts || null,
      }
    }
    case 'look_at': {
      // Toggle the continuous lookAt-nearest-player behavior, or query it.
      if (typeof args.enabled === 'boolean') lookAtEnabled = args.enabled
      return { ok: true, enabled: lookAtEnabled }
    }
    case 'follow': {
      // args: { username }  — start following named player. Omit username to stop.
      if (!args.username) {
        followTarget = null; followEntity = null; followChainPos = 0
        bot.pathfinder.setGoal(null)
        return { ok: true, following: null }
      }
      const target = findPlayerEntity(args.username)
      if (!target) return { ok: false, error: `can't see player: ${args.username}` }
      if (taskBusy()) {
        logEvent('follow', `aborting active task: ${activeTask.name}`)
        abortGen++
        bot.pathfinder.setGoal(null)
      }
      if (sustainState.active) {
        sustainState.active = false
        logEvent('sustain', 'stopped — follow takes priority')
      }
      followTarget = args.username
      followEntity = null; followChainPos = 0; lastChainEval = 0
      return { ok: true, following: followTarget }
    }
    case 'chat_rules': {
      return { ok: true, rules: CHAT_HANDLERS.map(r => ({ name: r.name, pattern: r.pattern.source })) }
    }
    case 'harvest_status': {
      return { ok: true, busy: activeTask.name?.startsWith('harvest') ?? false }
    }
    case 'task_status': {
      return { ok: true, ...taskStatus() }
    }
    case 'wheat_status': {
      const scan = scanKnownWheatFields()
      return { ok: true, ...scan, alertReady: wheatReadyState.ready, snoozed: wheatReadyState.snoozed, alertEveryMs: WHEAT_READY_ALERT_MS }
    }
    case 'wheat_snooze': {
      return { ok: true, snoozed: snoozeWheatReadyAlerts('ctl') }
    }
    case 'harvest_potatoes': {
      // Right-click is the default. For the legacy left-click brute method,
      // use action 'harvest_potatoes_brute'.
      runHarvestPotatoesRightClick({ user: 'ctl' }).catch(e => logEvent('harvest-potato-rc-error', e.message))
      return { ok: true, started: true }
    }
    case 'harvest_potatoes_brute': {
      runHarvestPotatoes({ user: 'ctl' }).catch(e => logEvent('harvest-potato-error', e.message))
      return { ok: true, started: true }
    }
    case 'bake_potatoes': {
      runBakePotatoes({ user: 'ctl' }).catch(e => logEvent('bake-potato-error', e.message))
      return { ok: true, started: true }
    }
    case 'eat': {
      return eatSomething()
        .then(msg => ({ ok: true, msg, food: bot.food }))
        .catch(e => ({ ok: false, error: e.message }))
    }
    case 'bake': {
      const mode = args.mode || 'both'  // 'dough' | 'bread' | 'both'
      runBake(mode).catch(e => logEvent('bake-error', e.message))
      return { ok: true, started: true, mode }
    }
    case 'stash_unknown': {
      runStashUnknown().catch(e => logEvent('stash-error', e.message))
      return { ok: true, started: true }
    }
    case 'stash_wheat': {
      runStashWheat().catch(e => logEvent('stash-wheat-error', e.message))
      return { ok: true, started: true }
    }
    case 'harvest_right_click': {
      const half = (args && args.half) || 'all'
      const keepSeeds = !!(args && args.keepSeeds)
      runHarvestRightClick({ half, keepSeeds }).catch(e => logEvent('harvest-rc-error', e.message))
      return { ok: true, started: true, half, keepSeeds }
    }
    case 'keep_fire': {
      runSustainFarm(args && args.user).catch(e => logEvent('sustain-error', e.message))
      return { ok: true, started: true, sustaining: true }
    }
    case 'sustain_status': {
      return { ok: true, active: sustainState.active, cycles: sustainState.cycles, startedBy: sustainState.startedBy, role: sustainState.role, crew: Object.fromEntries([...fireCrew].map(([n, c]) => [n, c.field])) }
    }
    case 'sustain_stop': {
      const was = sustainState.active
      sustainState.active = false
      if (was) announceFireStandDown()
      abortGen++
      return { ok: true, stopped: was }
    }
    case 'deposit_named': {
      const names = Array.isArray(args && args.names) ? args.names : []
      if (!names.length) return { ok: false, error: 'names array required' }
      runDepositNamed(names).catch(e => logEvent('deposit-named-error', e.message))
      return { ok: true, started: true, names }
    }
    case 'deposit_item': // generic: deposit any item by name
    case 'deposit_wheat': {
      if (taskBusy()) return { ok: false, error: 'busy', ...taskStatus() }
      const depositItemName = (args && args.item) || 'wheat'
      const target = (args && args.target === 'chest') ? HARVEST_WAYPOINTS.kitchen_chest : HOPPER
      const keep = Number.isFinite(args && args.keep) ? args.keep : 0
      ;(async () => {
        try {
          await ensureInsideHouse()
          await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
          const r = await depositQuickMove(depositItemName, target, { keep })
          logEvent('deposit-qm', `deposit_item(${depositItemName}): deposited=${r.deposited} remaining=${r.remaining} rounds=${r.rounds} backedUp=${r.backedUp}`)
        } catch (e) { logEvent('deposit-qm', `deposit_item(${depositItemName}) error: ${e.message}`) }
      })()
      return { ok: true, started: true, item: depositItemName, target: target === HOPPER ? 'hopper' : 'chest', keep }
    }
    case 'go_outside': {
      if (taskBusy()) return { ok: false, error: 'busy', ...taskStatus() }
      runGoOutside().catch(e => logEvent('go-outside-error', e.message))
      return { ok: true, started: true }
    }
    case 'come_inside': {
      const wasTask = taskBusy() ? activeTask.name : null
      if (wasTask) {
        logEvent('come-inside', `aborting active task: ${wasTask}`)
        abortGen++
        bot.pathfinder.setGoal(null)
      }
      if (sustainState.active) {
        sustainState.active = false
        logEvent('sustain', 'stopped — come-inside takes priority')
      }
      if (followTarget) {
        logEvent('come-inside', `skipping — follow (${followTarget}) takes priority`)
        return { ok: false, error: 'following', following: followTarget }
      }
      ;(async () => {
        if (wasTask) await sleep(300)
        if (inPen()) await runLeavePen()
        await runGoInside()
      })().catch(e => logEvent('go-inside-error', e.message))
      return { ok: true, started: true, aborted: wasTask }
    }
    case 'go_into_pen': {
      if (taskBusy()) return { ok: false, error: 'busy', ...taskStatus() }
      runGoIntoPen().catch(e => logEvent('go-into-pen-error', e.message))
      return { ok: true, started: true }
    }
    case 'go_out_of_pen': {
      if (taskBusy()) return { ok: false, error: 'busy', ...taskStatus() }
      runGoOutOfPen().catch(e => logEvent('go-out-of-pen-error', e.message))
      return { ok: true, started: true }
    }
    case 'door_strafe': {
      // Tune door-traversal strafe without restarting.
      // args: { exit?, enter? (each 'left'|'right'|null); exit_ms?, enter_ms? }
      if (args.exit !== undefined) EXIT_STRAFE = args.exit || null
      if (args.enter !== undefined) ENTER_STRAFE = args.enter || null
      if (args.exit_ms !== undefined) EXIT_STRAFE_MS = Number(args.exit_ms)
      if (args.enter_ms !== undefined) ENTER_STRAFE_MS = Number(args.enter_ms)
      return { ok: true, exit: EXIT_STRAFE, enter: ENTER_STRAFE, exit_ms: EXIT_STRAFE_MS, enter_ms: ENTER_STRAFE_MS }
    }
    case 'quit':
      bot.quit()
      return { ok: true }
    default:
      return { ok: false, error: `unknown action: ${action}` }
  }
}

const server = net.createServer((sock) => {
  const rl = readline.createInterface({ input: sock })
  rl.on('line', async (line) => {
    let reply
    try {
      const cmd = JSON.parse(line)
      reply = await handleCommand(cmd)
    } catch (e) {
      reply = { ok: false, error: e.message }
    }
    sock.write(JSON.stringify(reply) + '\n')
  })
  sock.on('error', () => {})
})
server.listen(ctrlPort, '127.0.0.1', () => {
  logEvent('ctrl', `control server on 127.0.0.1:${ctrlPort}`)
})

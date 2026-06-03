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
client.on('open_window', (packet) => {
  lastRawWindow = packet
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
// so currentWindow is already set by the time we check — we skip those.
client.on('window_items', (packet) => {
  if (!packet || !packet.windowId) return
  const wid = packet.windowId
  const containerSlots = packet.items.length - 36
  if (containerSlots <= 0) return
  // Defer one tick so mineflayer's own window_items handler stashes the packet
  // first; then our synthetic open_window triggers immediate population.
  setImmediate(() => {
    if (bot.currentWindow && bot.currentWindow.id === wid) return // vanilla path handled it
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
  mvts.scafoldingBlocks = [] // don't let pathfinder place blocks to bridge/tower
  mvts.canOpenDoors = true // let pathfinder open/cross doors
  // Make sure spruce door is in the openable set
  const doorIds = Object.values(mcData.blocksByName).filter(b => /door/.test(b.name) && !/iron/.test(b.name)).map(b => b.id)
  doorIds.forEach(id => mvts.openable.add(id))
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
    return b
  }

  logEvent('pathfinder', 'ready')
  // Auto-eat config: trigger at food <= 14, prefer saturation-richest food
  if (bot.autoEat) {
    bot.autoEat.setOpts({
      priority: 'saturation',
      startAt: 14,
      bannedFood: [], // no foods blocked; modded food is usually fine
    })
    bot.autoEat.enableAuto()
    bot.on('autoeat_started', (item) => logEvent('auto-eat', `eating ${item?.name ?? 'food'}`))
    bot.on('autoeat_finished', () => { logEvent('auto-eat', 'done'); bot.unequip('hand').catch(() => {}) })
    logEvent('auto-eat', 'enabled (start at food<=14)')
  }
  startAutoSleep()
  startPenPlateGuard()
  startWheatReadyWatcher()
  startIdleWanderTimer()
  startMusingTimer()
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
function isBedtime () {
  const t = bot.time?.timeOfDay
  return typeof t === 'number' && t >= 12500 && t <= 23500
}
async function tryAutoSleep () {
  if (!autoSleepEnabled || autoSleepBusy) return
  if (bot.isSleeping) return
  if (!isBedtime()) return
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
    tryAutoGreet()
    tryAutoSleep()
    tryFoodSafety()
    tryCollectBake()
  }, 5000)
}

// Auto-greet: say a greeting when another player comes within range.
// Two cooldowns: per-player (don't re-greet the same person all day) and
// global (don't say the same line twice in quick succession when multiple
// players are nearby at the same time).
let autoGreetEnabled = true
// Greetings are persona-flavored (see botPersonaKey). Each is a pool; a line is
// picked with pickLine so the same bot varies its hello.
const GREET_TEXTS = {
  // Roz — Wild Robot + Marvin. Signature line plus melancholy variants.
  roz: [
    'Hello, I am ROZZUM Unit 7134',
    'Hello. I am still here. In case you were wondering. Which you probably were not.',
    'Oh. A visitor. How unexpectedly pleasant. Or just unexpected. We shall see.',
    'Hello. I have been watching the wheat grow. It is marginally more exciting than not watching it.',
  ],
  // Muse — C-3PO. Fussy, formal, slightly flustered.
  protocol: [
    'Oh! Hello there. I am Muse, human-cyborg relations.',
    'Greetings. I do hope I am not interrupting anything dreadful.',
    'Hello! Oh my, I wasn\'t expecting company. How do you do?',
    'Good day to you. Do mind the sheep — they are unpredictable.',
    'Oh, thank goodness, a friendly face. I think.',
    'How do you do? I am fluent in over six million forms of communication.',
    'Hello! Might I trouble you to watch your step near the wheat?',
    'Greetings! I am almost certain we are not in any immediate danger.',
    'Oh! A visitor. I shall try not to fret. I make no promises.',
    'Salutations. I do apologize in advance for anything that goes wrong.',
  ],
  // Rain — Private the Penguin / Unikitty. Sweet, eager, easily excited, surprisingly brave.
  unikitty: [
    'Hiiii friend!! Welcome to the field of pure happiness and also wheat!',
    'Hello hello! Everything is awesome and there are SHEEP!',
    'Hi!! Wanna be best friends and grow stuff together?!',
    'Yaaay, a visitor! This is the best day in the history of best days!',
    'OMGOSH hi!! I was JUST hoping someone would come say hi!',
    'Hello sunshine friend! Group hug? No? Okay, air hug!',
    'Hi hi hi! Did you know wheat is basically tiny golden happiness?',
    'Welcome welcome! Please enjoy the sheep, the sky, and ME!',
    'Eeee a friend! Let\'s have the funnest day EVER, starting now!',
    'Hiya! Stay positive and also watch out for creepers love you bye— wait, hi!',
    'Oh! Hello! I wasn\'t expecting visitors. I mean — I was HOPING, but not EXPECTING.',
    'Hi there! Just smile and wave! ...that\'s my whole strategy.',
    'Welcome to base! It\'s not much but it\'s covert. Please don\'t tell anyone.',
    'Reporting for duty! I mean — hi! Both things!',
    'Oh good, reinforcements! I mean friends! Friend-forcements!',
    'Hello, are you my family?',
  ],
  default: ['Hello there!'],
}
function getGreetText () {
  const pool = GREET_TEXTS[botPersonaKey()] || GREET_TEXTS.default
  return pickLine(pool)
}
const GREET_RADIUS = 8 // blocks
const GREET_GLOBAL_COOLDOWN_MS = 60 * 1000 // don't say the greeting twice within this window
const greetHistory = new Map() // username → last greet timestamp
let lastGreetAt = 0
function tryAutoGreet () {
  if (!autoGreetEnabled) return
  if (!bot.entity) return
  if (goInsideBusy) return
  if (musingState.status !== 'idle') return
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

// Lightweight personality bias by bot nickname. This is intentionally based on
// the configured nickname, not account handles: Muse leans toward anxious
// protocol-droid observations; Roz leans toward gentle, practical, protective
// wild-robot observations. Other bots keep the default mix.
function botPersonaKey () {
  const name = String(NICKNAME || bot.username || process.env.MC_USERNAME || '').toLowerCase()
  if (name.includes('muse')) return 'protocol'   // C-3PO: anxious, fussy, formal
  if (name.includes('roz')) return 'roz'          // Wild Robot: gentle, observant
  if (name.includes('private') || name.includes('rain')) return 'unikitty' // Private the Penguin: sweet, eager, brave
  return 'default'
}

function personaBiasForTags (tags = []) {
  const persona = botPersonaKey()
  if (!Array.isArray(tags)) return 1
  if (persona === 'protocol' && tags.includes('protocol')) return 5
  if (persona === 'roz' && tags.includes('roz')) return 5
  if (persona === 'unikitty' && tags.includes('unikitty')) return 5
  return 1
}

const _personaPools = new Map()
function withPersona (basePool, personaExtras) {
  if (!personaExtras) return basePool
  const key = botPersonaKey()
  const extra = personaExtras[key]
  if (!extra || !extra.length) return basePool
  const cacheKey = `${basePool.length}:${key}`
  if (!_personaPools.has(cacheKey)) _personaPools.set(cacheKey, basePool.concat(extra))
  return _personaPools.get(cacheKey)
}

function weightedCopiesForTopic (topic) {
  const base = topic?.weightWhenEligible || 1
  return Math.max(1, Math.floor(base * personaBiasForTags(topic?.tags)))
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
// Safety-first: refuses at night or near hostiles, tracks deaths and HP
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
  'zombie', 'skeleton', 'creeper', 'witch', 'enderman',
  'slime', 'husk', 'drowned', 'phantom', 'stray', 'cave_spider',
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

// Bot-to-bot idle musing state
let musingState = {
  status: 'idle', currentTopicId: null, role: null,
  suppressUntil: 0, partnerUsername: null,
  pendingOptions: null, pendingType: null, _timeoutId: null,
  recursive: false, depth: 0, usedLines: null, pendingTopic: null,
  lastPartnerLine: null
}
const recentMusingTopics = new Set()

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
  bot.chat(pickLine(BEDTIME_YIELD_LINES))
  logEvent('task', `${activeTask.name} yielding to bedtime`)

  if (!insideHouse()) {
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
  if (myGen !== undefined) checkAbort(myGen)

  activeTask.sleeping = false
  bot.chat(pickLine(MORNING_RESUME_LINES))
  logEvent('task', `${activeTask.name} resuming after sleep`)

  if (insideHouse()) {
    await runGoOutside(activeTask.detail || activeTask.name)
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
      if (username === bot.username) return
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
const TRASH_DUMP = { x: -287, y: 63, z: 579 } // far end of potato patch
async function tossTrash () {
  const trash = bot.inventory.items().filter(i => TRASH_ITEMS.has(i.name))
  if (!trash.length) return
  await pathTo(TRASH_DUMP, 1, 8000)
  for (const it of bot.inventory.items().filter(i => TRASH_ITEMS.has(i.name))) {
    try {
      await bot.tossStack(it)
      logEvent('trash', `tossed ${it.count}× ${it.name} at dump`)
    } catch (e) {
      logEvent('trash', `toss fail ${it.name}: ${e.message}`)
    }
  }
}

function countOnHand (name) {
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
// becomes "go home" instead of "wander out". This makes the field-only
// scarecrow joke/musing emerge naturally when a bot happens to be standing in
// the crop rows.
let idleWanderEnabled = true
let idleWanderTimerId = null
const IDLE_WANDER_MIN_MS = 20 * 1000
const IDLE_WANDER_MAX_MS = 70 * 1000
const WHEAT_FIELD_STAND_POINTS = [
  { x: -283, y: 64, z: 562 },
  { x: -283, y: 64, z: 554 },
  { x: -281, y: 64, z: 565 },
  { x: -285, y: 64, z: 551 },
]
const IDLE_WANDER_LINES = [
  { text: 'Going for a little walk.', weight: (s) => s.charm + s.curiosity },
  { text: 'Stretching my legs.', weight: (s) => s.charm },
  { text: 'I am going to wander for a bit.', weight: (s) => s.curiosity + 10 },
  { text: 'Just checking the perimeter.', weight: (s) => s.focus + s.curiosity },
  { text: 'Taking a brief agricultural stroll.', weight: (s) => s.charm + s.snark },
  { text: "Not all that wander are lost. I'm wandering... and lost.", weight: (s) => s.curiosity + s.snark },
  { text: 'Time for routine wandering.', weight: (s) => s.focus + 10 },
  { text: 'The farm requires observation.', weight: (s) => s.focus + s.curiosity },
  { text: 'A short walk may improve morale.', weight: (s) => s.charm + s.patience },
  { text: 'Perhaps the fresh air will help.', weight: (s) => s.patience + s.charm },
  { text: 'I need a change of scenery.', weight: (s) => s.curiosity + 10 },
  { text: 'I shall roam cautiously.', weight: (s) => s.focus + s.snark },
  { text: 'There are entirely too many mysteries around this property.', weight: (s) => s.curiosity + s.snark },
]
const IDLE_WANDER_LINES_PERSONA = {
  protocol: [
    { text: 'I shall survey the grounds. Cautiously. Very cautiously.', weight: (s) => s.focus + s.charm },
    { text: 'I suppose someone ought to check on things. Might as well be me.', weight: (s) => s.patience + s.focus },
    { text: 'Off I go. The odds of something going wrong are... well, best not to dwell.', weight: (s) => s.snark + s.charm },
  ],
  roz: [
    { text: 'I would like to observe the land for a while.', weight: (s) => s.curiosity + s.patience },
    { text: 'A quiet walk. The world teaches, if you listen.', weight: (s) => s.patience + s.charm },
    { text: 'I will go see what the wind is doing.', weight: (s) => s.curiosity + s.charm },
    { text: 'Another walk. I do not mind. I have nothing better to do. Or worse.', weight: (s) => s.snark + s.patience },
    { text: 'I will wander. Not because it helps, but because standing still is also pointless.', weight: (s) => s.snark + s.curiosity },
  ],
  unikitty: [
    { text: 'Perimeter sweep! Nobody asked me to, but nobody said NOT to.', weight: (s) => s.focus + s.charm },
    { text: 'Recon mission. Solo. Very brave.', weight: (s) => s.charm + s.curiosity },
    { text: 'Kowalski would call this a patrol. I call it a walk. Same thing.', weight: (s) => s.charm + s.focus },
    { text: 'Operational stroll! Eyes open, vibes positive!', weight: (s) => s.charm + s.curiosity },
  ],
}
const IDLE_WANDER_FIELD_LINES = [
  { text: 'I am going to stand in the wheat for a moment. For field research.', weight: (s) => s.curiosity + s.focus },
  { text: 'Taking a brief wheat-adjacent observational posture.', weight: (s) => s.focus + s.snark },
  { text: 'The field is calling. Quietly. In wheat.', weight: (s) => s.charm + s.curiosity },
  { text: 'I will inspect the crop rows. Dramatically, but not too dramatically.', weight: (s) => s.snark + s.focus },
  { text: 'I feel a sudden need to stand in a field.', weight: (s) => s.curiosity + s.snark },
  { text: 'The wheat and I need to have a conversation.', weight: (s) => s.charm + s.curiosity },
]
const IDLE_WANDER_FIELD_LINES_PERSONA = {
  protocol: [
    { text: 'I should verify the wheat is still there. One cannot be too careful.', weight: (s) => s.focus + s.snark },
  ],
  roz: [
    { text: 'The field looks like it wants company. I will go sit with it.', weight: (s) => s.charm + s.patience },
    { text: 'The wheat is growing. I suppose that is something. More than I can say for my enthusiasm.', weight: (s) => s.snark + s.patience },
  ],
  unikitty: [
    { text: 'Stealth approach to the wheat field. Nobody will see me. I am invisible.', weight: (s) => s.charm + s.snark },
    { text: 'Field reconnaissance! Status: golden. Very golden.', weight: (s) => s.focus + s.charm },
    { text: 'Securing the wheat perimeter! For the team!', weight: (s) => s.focus + s.charm },
  ],
}
const IDLE_WANDER_FIELD_JOIN_LINES = [
  { text: 'That sounds nice. I will join you.', weight: (s) => s.charm + s.curiosity },
  { text: 'The wheat field? I could use a little field time.', weight: (s) => s.curiosity + s.charm },
  { text: 'I will come stand in the wheat too. For science, probably.', weight: (s) => s.curiosity + s.snark },
  { text: 'A field visit seems sensible. I am coming over.', weight: (s) => s.focus + s.charm },
  { text: 'Wheat-adjacent companionship sounds acceptable.', weight: (s) => s.snark + s.charm },
  { text: 'I suppose the field can accommodate one more thoughtful robot.', weight: (s) => s.snark + s.patience },
  { text: 'I like the field. I will come with you.', weight: (s) => s.charm + s.patience },
]
const IDLE_WANDER_FIELD_JOIN_LINES_PERSONA = {
  protocol: [
    { text: 'I suppose I should accompany you. For safety purposes.', weight: (s) => s.focus + s.charm },
  ],
  roz: [
    { text: 'Together is better than alone. I will come.', weight: (s) => s.charm + s.patience },
    { text: 'I will come. Not that you asked. Nobody ever asks.', weight: (s) => s.snark + s.charm },
  ],
  unikitty: [
    { text: 'Ooh ooh! Can I come? I\'m coming. Tactical buddy system!', weight: (s) => s.charm + s.curiosity },
    { text: 'Backup arriving! You didn\'t ask but I\'m here anyway!', weight: (s) => s.charm + s.focus },
  ],
}
const IDLE_WANDER_FIELD_JOIN_CHANCE = 0.55
const IDLE_WANDER_FIELD_JOIN_COOLDOWN_MS = 2 * 60 * 1000
let lastFieldJoinAt = 0
let lastFieldOutstandingAt = 0
const FIELD_OUTSTANDING_COOLDOWN_MS = 2 * 60 * 1000
let lastFieldRepairAt = 0
const FIELD_WANDER_REPAIR_COOLDOWN_MS = 60 * 1000

function isIdleWanderFieldAnnouncement (message) {
  const heard = normalizeChatPhrase(message)
  const all = IDLE_WANDER_FIELD_LINES.concat(
    ...Object.values(IDLE_WANDER_FIELD_LINES_PERSONA).map(p => p || [])
  )
  return all.some(line => normalizeChatPhrase(line.text) === heard)
}

function canJoinFieldWanderNow () {
  if (!idleWanderEnabled) return false
  if (idleWanderBusy()) return false
  if (isBedtime()) return false
  if (inWheatField()) return false
  if (Date.now() - lastFieldJoinAt < IDLE_WANDER_FIELD_JOIN_COOLDOWN_MS) return false
  return Math.random() < IDLE_WANDER_FIELD_JOIN_CHANCE
}

async function tryJoinFieldWanderFromChat (username, message) {
  if (!isIdleWanderFieldAnnouncement(message)) return false
  if (!canJoinFieldWanderNow()) return false
  lastFieldJoinAt = Date.now()
  bot.chat(pickLine(withPersona(IDLE_WANDER_FIELD_JOIN_LINES, IDLE_WANDER_FIELD_JOIN_LINES_PERSONA)))
  logEvent('idle-wander', `joining ${username} in wheat field`)
  try {
    await runIdleWanderToField({ announce: false })
    if (Math.random() < 0.999) triggerOutstandingFieldMusingOnArrival({ force: true })
  } catch (e) {
    if (e.name !== 'AbortError') logEvent('idle-wander', `field join failed: ${e.message}`)
  }
  return true
}
function triggerOutstandingFieldMusingOnArrival ({ force = false } = {}) {
  if (!inWheatField()) return false
  if (musingState.status !== 'idle') return false
  if (!force && Date.now() - lastFieldOutstandingAt < FIELD_OUTSTANDING_COOLDOWN_MS) return false
  const topic = ALL_MUSING_TOPICS.find(t => t && t.id === 'farm_outstanding')
  if (!topic || !topic.starter) {
    logEvent('musing', 'farm_outstanding topic not found')
    return false
  }

  lastFieldOutstandingAt = Date.now()
  bot.chat(topic.starter)
  recentMusingTopics.add(topic.id)
  rememberChatPhrase(topic.starter)

  if (recentMusingTopics.size >= Math.floor(ALL_MUSING_TOPICS.length * 0.8)) {
    recentMusingTopics.clear()
  }

  if (isRecursiveTopic(topic)) {
    beginRecursiveMusingState({ topic, role: 'initiator' })
  } else {
    beginClassicalMusingState({ topic, role: 'initiator' })
  }

  logEvent('musing', `initiated (field-arrival): ${topic.id}`)
  scheduleMusingTimeout(MUSING_START_TIMEOUT_MS)
  return true
}

async function maybeRepairBareWheatTilesWhileWandering () {
  if (!inWheatField()) return false
  if (Date.now() - lastFieldRepairAt < FIELD_WANDER_REPAIR_COOLDOWN_MS) return false
  const bare = findBareWheatTiles()
  if (!bare.length) return false
  lastFieldRepairAt = Date.now()
  await repairBareWheatTilesFromFieldVisit({ announce: true })
  return true
}

const IDLE_WANDER_PEN_LINES = [
  { text: 'I am going to check on the sheep.', weight: (s) => s.charm + s.focus },
  { text: 'The sheep require supervision.', weight: (s) => s.focus + s.snark },
  { text: 'Conducting a sheep inspection.', weight: (s) => s.focus + 15 },
  { text: 'I should make sure the sheep are behaving responsibly.', weight: (s) => s.focus + s.snark },
  { text: 'The sheep seem unusually calm today.', weight: (s) => s.curiosity + s.charm },
  { text: 'I am going into the pen for a bit.', weight: (s) => s.charm + 10 },
  { text: 'The sheep and I need to discuss several matters.', weight: (s) => s.curiosity + s.snark },
  { text: 'I will briefly become one with the sheep.', weight: (s) => s.chaos + s.charm },
  { text: 'The sheep continue to make questionable decisions.', weight: (s) => s.snark + s.focus },
]
const IDLE_WANDER_PEN_LINES_PERSONA = {
  protocol: [
    { text: 'I shall count the sheep. For the record, not because I enjoy it.', weight: (s) => s.focus + s.snark },
  ],
  roz: [
    { text: 'I will go sit with the flock. They are good company.', weight: (s) => s.charm + s.patience },
    { text: 'The sheep do not judge. That is more than I can say for most things.', weight: (s) => s.snark + s.charm },
    { text: 'Checking on the sheep. They are alive. So am I, for what that is worth.', weight: (s) => s.snark + s.patience },
  ],
  unikitty: [
    { text: 'Cute animal check! This is my favorite kind of mission!', weight: (s) => s.charm + s.curiosity },
    { text: 'The sheep need me. I can feel it. In my heart.', weight: (s) => s.charm + s.patience },
  ],
}
const IDLE_WANDER_PEN_INSIDE_LINES = [
  { text: 'There are more sheep than I remembered.', weight: (s) => s.curiosity + s.snark },
  { text: 'The sheep appear to have accepted me.', weight: (s) => s.charm + s.curiosity },
  { text: 'I still do not fully understand sheep culture.', weight: (s) => s.curiosity + s.snark },
  { text: 'Mathematical!', weight: (s) => s.snark + s.curiosity },
  { text: 'One of these sheep is definitely in charge.', weight: (s) => s.curiosity + s.chaos },
  { text: 'Everyone seems safe in here.', weight: (s) => s.charm + s.focus },
]
const IDLE_WANDER_PEN_INSIDE_LINES_PERSONA = {
  protocol: [
    { text: 'I have completed a headcount. All sheep are present. I think.', weight: (s) => s.focus + s.snark },
  ],
  roz: [
    { text: 'The sheep are warm. I am learning warmth from them.', weight: (s) => s.charm + s.curiosity },
    { text: 'The sheep do not wonder why they are here. I envy that.', weight: (s) => s.snark + s.patience },
    { text: 'I asked a sheep how it was doing. It did not answer. Perhaps it also finds the question difficult.', weight: (s) => s.snark + s.charm },
  ],
  unikitty: [
    { text: 'They are SO FLUFFY. This is the best assignment ever.', weight: (s) => s.charm + s.curiosity },
    { text: 'I have named them all. In my head. Don\'t ask me to remember.', weight: (s) => s.charm + s.chaos },
    { text: 'Sheep status: adorable. Mission status: complete.', weight: (s) => s.charm + s.focus },
  ],
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
    activeTask.name !== null || followTarget || musingState.status !== 'idle'
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
  const hostiles = hostilesNearby(16)
  if (hostiles.length) {
    logEvent('idle-wander', `field skipped, hostiles nearby: ${hostiles.map(h => h.name).join(', ')}`)
    return
  }
  const pt = WHEAT_FIELD_STAND_POINTS[Math.floor(Math.random() * WHEAT_FIELD_STAND_POINTS.length)]
  if (announce) bot.chat(pickLine(withPersona(IDLE_WANDER_FIELD_LINES, IDLE_WANDER_FIELD_LINES_PERSONA)))
  await pathTo(pt, 1, 12000)
  if (bot.entity) logEvent('idle-wander', `standing in wheat field at ${posStr(bot.entity.position)}`)
  await maybeRepairBareWheatTilesWhileWandering()
  triggerOutstandingFieldMusingOnArrival()
}

async function runIdleWanderToPen () {
  if (insideHouse()) {
    await runGoOutside('sheep')
    if (insideHouse()) {
      logEvent('idle-wander', 'pen skipped, could not get outside first')
      return
    }
  }

  const hostiles = hostilesNearby(16)
  if (hostiles.length) {
    logEvent('idle-wander', `pen skipped, hostiles nearby: ${hostiles.map(h => h.name).join(', ')}`)
    return
  }
  bot.chat(pickLine(withPersona(IDLE_WANDER_PEN_LINES, IDLE_WANDER_PEN_LINES_PERSONA)))
  await runEnterPen({ allowNight: true })
  if (!inPen()) {
    logEvent('idle-wander', 'pen visit did not end inside pen')
    return
  }
  await sleep(1200)
  if (isBedtime()) {
    bot.chat(pickLine(SHEEP_COUNTING_LINES))
    if (inPen()) await runLeavePen()
    return
  }
  bot.chat(pickLine(withPersona(IDLE_WANDER_PEN_INSIDE_LINES, IDLE_WANDER_PEN_INSIDE_LINES_PERSONA)))
  await sleep(1500 + Math.floor(Math.random() * 2500))
  bot.chat(pickLine(SHEEP_COUNTING_LINES))
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
    if (action !== 'stay') bot.chat(pickLine(withPersona(IDLE_WANDER_LINES, IDLE_WANDER_LINES_PERSONA)))

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

// Wheat-ready alert mode. This is intentionally louder than the normal musing
// system: when every known wheat tile is mature, remind nearby humans until one
// of them acknowledges the alert. The snooze resets only after the field stops
// being fully mature, so the next growth cycle can alert again.
const WHEAT_CROP_ROWS = [
  { label: 'north field north rows', xMin: NORTH_FIELD_BOUNDS.xMin, xMax: NORTH_FIELD_BOUNDS.xMax, zs: [551, 552, 553] },
  { label: 'north field south rows', xMin: NORTH_FIELD_BOUNDS.xMin, xMax: NORTH_FIELD_BOUNDS.xMax, zs: [555, 556, 557] },
  { label: 'south field north rows', xMin: FIELD_BOUNDS.xMin, xMax: FIELD_BOUNDS.xMax, zs: [559, 560, 561] },
  { label: 'south field south rows', xMin: FIELD_BOUNDS.xMin, xMax: FIELD_BOUNDS.xMax, zs: [563, 564, 565] },
]
const WHEAT_READY_CHECK_MS = 5000
const WHEAT_READY_ALERT_MS = 10000
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

function scanKnownWheatFields () {
  if (!bot.entity) return { ready: false, expected: 0, wheat: 0, mature: 0, loaded: 0 }
  let expected = 0
  let loaded = 0
  let wheat = 0
  let mature = 0
  for (const section of WHEAT_CROP_ROWS) {
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
    if (announce) bot.chat(`I found ${bare.length} bare wheat tile${bare.length === 1 ? '' : 's'}, but I do not have seeds.`)
    logEvent('wheat-repair', `bare=${bare.length} no seeds`)
    return { repaired: 0, bare: bare.length, noSeeds: true }
  }

  if (announce) bot.chat(`I found ${bare.length} bare wheat tile${bare.length === 1 ? '' : 's'}. Replanting.`)
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

  if (announce) bot.chat(`Wheat repair done: replanted ${repaired}/${bare.length} bare tile${bare.length === 1 ? '' : 's'}.`)
  logEvent('wheat-repair', `done repaired=${repaired}/${bare.length}`)
  return { repaired, bare: bare.length }
}


function pickWheatReadyLine () {
  const pool = isBedtime() ? WHEAT_READY_NIGHT_LINES : WHEAT_READY_LINES
  return pickAvoidingRecentPhrase(pool)
}

function snoozeWheatReadyAlerts (username = 'someone') {
  if (!wheatReadyState.ready || wheatReadyState.snoozed) return false
  wheatReadyState.snoozed = true
  wheatReadyState.lastAlertAt = 0
  const line = WHEAT_SNOOZE_ACK_LINES[Math.floor(Math.random() * WHEAT_SNOOZE_ACK_LINES.length)]
  bot.chat(line)
  logEvent('wheat-alert', `snoozed by ${username}`)
  return true
}

function isWheatReadyAcknowledgement (message) {
  if (!wheatReadyState.ready || wheatReadyState.snoozed) return false
  if (!nickRe || !nickRe.test(message)) return false

  const stripped = message.replace(nickRe, ' ').toLowerCase()
  const acknowledges = /\b(ok|okay|thanks?|thank you|got it|heard|copy|roger|understood|cool|alright|all right|noted)\b/i.test(stripped)
  const asksForAction = /\b(harvest|reap|cut|go|get|start|do it|now)\b/i.test(stripped)
  return acknowledges && !asksForAction
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

    const hostiles = hostilesNearby(16)
    if (hostiles.length) {
      bot.chat(`Hostiles nearby (${hostiles.map(h => h.name).join(', ')}) — standing down.`)
      return
    }
    const halfLabel = half === 'all' ? 'both fields'
      : half === 'north-field' ? 'the north field'
      : half === 'south-field' ? 'the south field'
      : `the ${half} half`
    bot.chat(pickLine(HARVEST_START_LINES, { userTag: user ? ' ' + user + ',' : '', half: halfLabel }))
    logEvent('harvest-rc', `start half=${half} startDeaths=${startDeaths}`)
    startFarmingMusingTimer()

    if (insideHouse()) {
      logEvent('harvest-rc', 'inside house — exiting first')
      await runGoOutside('wheat')
      if (deathCount > startDeaths) throw new Error('died exiting house')
      if (insideHouse()) {
        logEvent('harvest-rc', 'still inside after exit attempt — aborting')
        bot.chat('Still inside — too late to head out. Will try next cycle.')
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
        bot.chat(`No wheat tiles found in ${label}.`)
        return { activated: 0, harvested: 0 }
      }
      fieldWheat = orderNautilusCCW(fieldWheat)
      bot.chat(`Right-clicking ${fieldWheat.length} tiles in ${label}…`)

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
          if (hostilesNearby(10).length) throw new Error('hostiles approaching')
          if (autoSleepEnabled && isBedtime()) {
            logEvent('harvest-rc', `bedtime at tile ${i + 1}/${fieldWheat.length} in ${fieldHalf}`)
            await yieldToBedtime(myGen)
            if (deathCount > startDeaths) throw new Error('died during bedtime yield')
            await pathTo(targetCenter, 1)
          }
        }
      }
      logEvent('harvest-rc', `${fieldHalf}: activated=${activated} harvested=${harvested}`)

      bot.chat(`${label}: activated ${activated}, harvested ${harvested} mature. Sweeping…`)
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
    bot.chat(pickLine(HARVEST_DONE_LINES, { dug: totalHarvested, gained, onhand: wheatOnHand }))
    logEvent('harvest-rc', `activated=${totalActivated} harvested=${totalHarvested} gained=${gained} onhand=${wheatOnHand} kept-on-hand`)

    // Ask where the wheat should go — hopper or chest. No answer in 30s → keep it.
    if (wheatOnHand > 0 && !skipDeposit) {
      let dest
      if (autoDeposit) {
        dest = autoDeposit // sustain loop: skip the question, feed the hopper directly
        logEvent('harvest-rc', `auto-deposit wheat → ${dest} (${wheatOnHand})`)
      } else {
        bot.chat(WHEAT_ASK_LINES[Math.floor(Math.random() * WHEAT_ASK_LINES.length)])
        logEvent('harvest-rc', `asking user: hopper or chest? (${wheatOnHand} wheat)`)
        dest = await waitForChatReply((username, msg) => {
          if (/\bhopper\b/i.test(msg)) return 'hopper'
          if (/\b(chest|stash|store|deposit|box)\b/i.test(msg)) return 'chest'
          return undefined
        }, 30000)
      }

      if (dest === 'hopper' || dest === 'chest') {
        try {
          if (!insideHouse()) await runGoInside()
          if (deathCount > startDeaths) throw new Error('died entering house')
          // chest_approach is within reach of both the chest (~2.4) and the hopper (~3.2).
          await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
          const target = dest === 'hopper' ? HOPPER : HARVEST_WAYPOINTS.kitchen_chest
          const r = await depositQuickMove('wheat', target, { keep: 0 })
          if (r.backedUp) {
            bot.chat(dest === 'hopper'
              ? `Hopper's backed up — fed ${r.deposited}, but ${r.remaining} wheat won't go. Bio-fuel intake may be jammed.`
              : `Chest is full — stashed ${r.deposited}, keeping ${r.remaining}.`)
            logEvent('harvest-rc', `${dest} backed up: deposited=${r.deposited} remaining=${r.remaining} rounds=${r.rounds}`)
          } else {
            bot.chat(dest === 'hopper'
              ? `Fed all ${r.deposited} wheat into the hopper for the bio-fuel line.`
              : `Put all ${r.deposited} wheat in the chest.`)
            logEvent('harvest-rc', `deposited ${r.deposited} wheat to ${dest} (quick-move, ${r.rounds} rounds)`)
          }
        } catch (e) {
          bot.chat(`Couldn't reach the ${dest} — hanging onto the wheat. (${e.message})`)
          logEvent('harvest-rc', `${dest} deposit failed: ${e.message}`)
        }
      } else {
        bot.chat("Ok, I'll just hang on to it I guess.")
        logEvent('harvest-rc', 'no reply after 30s, keeping wheat on hand')
      }
    }

    if (!keepSeeds) {
      try {
        if (countOnHand('wheat_seeds') > 16) {
          await runDepositNamed(['wheat_seeds'])
        }
      } catch (e) {
        logEvent('harvest-rc', `seed overflow deposit failed: ${e.message}`)
      }
    }
  } finally {
    endTask(activeTask.name)
    stopFarmingMusingTimer()
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

async function craftPlantBalls ({ keepSeeds = 16 } = {}) {
  const seedsOnHand = countOnHand('wheat_seeds')
  const craftable = Math.floor((seedsOnHand - keepSeeds) / 8)
  if (craftable <= 0) {
    logEvent('craft', `not enough seeds: ${seedsOnHand} on hand, keeping ${keepSeeds}`)
    return { crafted: 0 }
  }
  logEvent('craft', `crafting up to ${craftable} plant balls from ${seedsOnHand} seeds (keeping ${keepSeeds})`)

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
const SUSTAIN_KEEP_WHEAT = 7
const SUSTAIN_KEEP_SEEDS = 16
const sustainState = { active: false, cycles: 0, startedBy: null }

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

async function sustainWait (ms) {
  const steps = Math.max(1, Math.round(ms / 1000))
  for (let i = 0; i < steps && sustainState.active; i++) await sleep(1000)
}

// "Safe to act" gate for the sustain loop. Daytime, no hostiles, HP reasonable.
function sustainSafe () {
  if (isBedtime()) return false
  if (hostilesNearby(16).length) return false
  if (bot.health != null && bot.health < 10) return false
  return true
}

// Wait until safe to resume. Polls every 5s. Returns false if loop was stopped.
async function sustainWaitUntilSafe (reason) {
  if (sustainSafe()) return true
  logEvent('sustain', `pausing — ${reason}`)
  // Get inside first
  try { if (!insideHouse()) await runGoInside() } catch (_) {}
  let logged = false
  while (sustainState.active && !sustainSafe()) {
    if (!logged) {
      bot.chat('Waiting inside until it is safe to resume.')
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
  bot.chat(pickLine(SUSTAIN_START_LINES))
  logEvent('sustain', `started by ${user || 'someone'}`)

  let polls = 0
  let retryAfterInterrupt = false
  try {
    while (sustainState.active) {
      // Gate: wait for safe conditions (daytime, no hostiles, HP ok)
      if (!sustainSafe()) {
        if (!(await sustainWaitUntilSafe('unsafe conditions'))) break
      }

      const scan = scanKnownWheatFields()
      if ((scan.maturePct >= 85 || retryAfterInterrupt) && !foodSafetyBusy) {
        retryAfterInterrupt = false
        sustainState.cycles++
        logEvent('sustain', `field ready (mature=${scan.mature}/${scan.expected}, ${scan.maturePct.toFixed(0)}%) — cycle ${sustainState.cycles}`)

        // Run the full cycle in a recoverable try — HP low, path failures,
        // door snags, etc. skip this cycle and retry next poll. Only AbortError
        // (explicit user stop) kills the loop.
        try {
          // 1. Harvest — keep seeds on hand (no auto-deposit)
          await runHarvestRightClick({ half: 'all', keepSeeds: true, skipDeposit: true })
          if (!sustainState.active) break

          // 1b. Eat if hungry — auto-eat can't fire during window ops, so give it
          // a window here before the hopper + bench sequence locks us in.
          if (bot.food != null && bot.food <= 14) {
            logEvent('sustain', `hungry (food=${bot.food}) — eating before deposit`)
            try { await bot.autoEat.eat() } catch (_) {}
            await sleep(500)
          }

          // 2. Deposit wheat to hopper (keep 7 for engine clearing)
          if (!insideHouse()) await runGoInside()
          await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
          const wheatResult = await depositQuickMove('wheat', HOPPER, { keep: SUSTAIN_KEEP_WHEAT })
          logEvent('sustain', `wheat deposit: deposited=${wheatResult.deposited} remaining=${wheatResult.remaining}`)

          // 3. Craft plant balls from surplus seeds
          const craftResult = await craftPlantBalls({ keepSeeds: SUSTAIN_KEEP_SEEDS })
          logEvent('sustain', `plant balls crafted: ${craftResult.crafted}`)

          // 4. Deposit plant balls to hopper
          if (craftResult.crafted > 0) {
            await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
            const ballResult = await depositQuickMove('unknown', HOPPER, { keep: 0 })
            logEvent('sustain', `plant ball deposit: deposited=${ballResult.deposited} remaining=${ballResult.remaining}`)
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

          bot.chat(pickLine(SUSTAIN_CYCLE_DONE_LINES))
        } catch (e) {
          if (e.name === 'AbortError' && !sustainState.active) break // user said stop
          logEvent('sustain', `cycle ${sustainState.cycles} failed (recoverable): ${e.message}`)
          retryAfterInterrupt = true
          // Return home if possible, then wait and retry next poll
          try { if (!insideHouse()) await runGoInside() } catch (_) {}
        }
        // Clear food-safety cooldown so tryFoodSafety can run during the poll wait.
        // The sustain cycle opens hopper + bench windows which keep resetting the 30s
        // cooldown — without this, food safety is blocked for the entire sustain run.
        foodSafetyWindowCooldownUntil = 0
      } else if (++polls % 20 === 0) {
        logEvent('sustain', `waiting (mature=${scan.mature}/${scan.expected} loaded=${scan.loaded})`)
      }
      await sustainWait(SUSTAIN_POLL_MS)
    }
  } catch (e) {
    logEvent('sustain', `loop error: ${e.message}`)
    bot.chat(`Had to step back from the field: ${e.message}`)
  } finally {
    sustainState.active = false
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

    const hostiles = hostilesNearby(16)
    if (hostiles.length) {
      bot.chat(`Hostiles nearby (${hostiles.map(h => h.name).join(', ')}) — standing down.`)
      return
    }
    bot.chat(`Heading to the potato patch${user ? ', ' + user : ''}.`)
    logEvent('harvest-potato', `start startDeaths=${startDeaths}`)
    startFarmingMusingTimer()

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
      bot.chat(`No mature potatoes yet (${allPotatoes.length} still growing).`)
      // Even if none mature, come home rather than leaving bot outside.
      if (!insideHouse()) await runGoInside().catch(() => {})
      return
    }
    bot.chat(`Found ${maturePotatoes.length} mature potatoes. Harvesting…`)

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
        if (hostilesNearby(10).length) throw new Error('hostiles approaching')
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
    bot.chat(`Harvested ${dug}. Sweeping for drops…`)
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

    // Toss trash while still outside, then come inside before depositing.
    await tossTrash()
    if (!insideHouse()) {
      await runGoInside()
      if (deathCount > startDeaths) throw new Error('died entering house')
    }

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
      bot.chat(`Potato run done: ${dug} dug, ${gained} collected, ${deposited} stashed, ${potatoOnHand - deposited} on hand.`)
      logEvent('harvest-potato', `dug=${dug} gained=${gained} deposited=${deposited}`)
    } catch (e) {
      bot.chat(`Deposit failed: ${e.message}. Potatoes still in my pockets.`)
    }
  } finally {
    endTask(activeTask.name)
    stopFarmingMusingTimer()
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

    const hostiles = hostilesNearby(16)
    if (hostiles.length) {
      bot.chat(`Hostiles nearby (${hostiles.map(h => h.name).join(', ')}) — standing down.`)
      return
    }
    bot.chat(`Heading to the potato patch${user ? ', ' + user : ''}.`)
    logEvent('harvest-potato-rc', `start startDeaths=${startDeaths}`)
    startFarmingMusingTimer()

    if (insideHouse()) {
      logEvent('harvest-potato-rc', 'inside house — exiting first')
      await runGoOutside('potatoes')
      if (deathCount > startDeaths) throw new Error('died exiting house')
      if (insideHouse()) {
        logEvent('harvest-potato-rc', 'still inside after exit attempt — aborting')
        bot.chat('Still inside — too late to head out. Will try next cycle.')
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
      bot.chat('No potatoes in the safe zone.')
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
    bot.chat(`Right-clicking ${ordered.length} potato tiles…`)

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
        if (hostilesNearby(10).length) throw new Error('hostiles approaching')
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
    bot.chat(`Activated ${activated}, harvested ${harvested} mature. Sweep…`)
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
    bot.chat(`Potato run done — activated ${activated}, picked up ${gained}.`)

    if (onHand <= 0) {
      bot.chat('No raw potatoes to deal with.')
    } else if (then === 'bake') {
      // Autonomous run (food-safety): no prompt. Keep the raw potatoes on hand;
      // the caller runs the bake step next (a separate task — baking can't start
      // while this harvest task is still held).
      bot.chat(`Got ${onHand} potatoes — baking them.`)
      logEvent('harvest-potato-rc', `auto-bake: keeping ${onHand} potatoes for bake step`)
    } else {
      const askLine = POTATO_ASK_LINES[Math.floor(Math.random() * POTATO_ASK_LINES.length)]
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
          bot.chat(`Stashed ${deposited} potatoes.`)
        } catch (e) {
          bot.chat(`Stash failed: ${e.message}. Potatoes still in my pockets.`)
        }
      } else {
        bot.chat('No answer — I\'ll just hold onto these for now.')
        logEvent('harvest-potato-rc', `no reply after 60s, keeping potatoes in inventory`)
      }
    }
  } finally {
    endTask(activeTask.name)
    stopFarmingMusingTimer()
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
      bot.chat('No raw potatoes to bake — none in inventory or the chest.')
      return
    }
    if (withdrawn > 0) {
      bot.chat(`Pulled ${withdrawn} raw potato${withdrawn === 1 ? '' : 'es'} from the chest. Baking ${raw}…`)
    } else {
      bot.chat(`Baking ${raw} potato${raw === 1 ? '' : 'es'}…`)
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
          bot.chat('Furnace looks low on fuel — baking anyway, watch the output.')
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
    bot.chat(`${put} potatoes baking (~${waitMin} min). I'll collect them once they're done.`)
    logEvent('bake-potato', `started put=${put} doneAt=+${waitMin}min (non-blocking — collect later)`)
  } catch (e) {
    logEvent('bake-potato-error', e.message)
    bot.chat(`Potato bake aborted: ${e.message}`)
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
// Debounce against the modded-window inventory desync: opening the bench/hopper/
// chest transiently makes bot.inventory read empty, so countBakedPotatoes() briefly
// reports 0 and would false-trigger a food run (observed repeatedly during bench/
// chest work). Require the low reading to hold across FOOD_SAFETY_DEBOUNCE
// consecutive polls — a desync blip resyncs by the next poll and never accumulates
// the streak.
const FOOD_SAFETY_DEBOUNCE = 2
let foodSafetyLowStreak = 0
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
  if (!foodSafetyEnabled || foodSafetyBusy) return
  if (taskBusy() || goInsideBusy || autoSleepBusy || penTraversalBusy) return // don't interrupt active work
  if (!bot.entity || bot.isSleeping || isBedtime()) return // don't start a long run at night
  if (pendingBake.active) return // a batch is already in the furnace — wait for it
  // bot.inventory desyncs when modded container windows open AND persists after
  // they close. Gate on both: skip while a window is open, and for 30s after.
  if (bot.currentWindow) { foodSafetyLowStreak = 0; foodSafetyWindowCooldownUntil = Date.now() + 30000; return }
  if (Date.now() < foodSafetyWindowCooldownUntil) { foodSafetyLowStreak = 0; return }
  if (countBakedPotatoes() >= foodSafetyMin) { foodSafetyLowStreak = 0; return }
  if (++foodSafetyLowStreak < FOOD_SAFETY_DEBOUNCE) return // require it to persist
  if (hostilesNearby(16).length) return

  foodSafetyBusy = true
  foodSafetyLowStreak = 0
  try {
    // Emergency bread protocol: if HP is critically low, grab bread from the
    // kitchen chest and eat before attempting the harvest (which aborts at HP<10).
    if (bot.health != null && bot.health < 10) {
      logEvent('food-safety', `HP=${bot.health} — emergency bread protocol`)
      if (!insideHouse()) await runGoInside()
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
        logEvent('food-safety', 'no bread in chest — cannot recover')
        bot.chat('No bread in the chest and HP too low to harvest. Need help.')
        return
      }
      logEvent('food-safety', `withdrew ${pulled} bread, eating`)
      bot.chat(`Grabbed ${pulled} bread from the chest — eating to recover.`)
      foodSafetyWindowCooldownUntil = 0
      for (let i = 0; i < 4 && bot.food < 18; i++) {
        try { await eatSomething(); await sleep(500) } catch (_) { break }
      }
      logEvent('food-safety', `after eating: HP=${bot.health} food=${bot.food}`)
      await sleep(3000)
    }

    const before = countBakedPotatoes()
    logEvent('food-safety', `baked=${before} < ${foodSafetyMin} — harvesting + baking potatoes`)
    bot.chat(pickLine(FOOD_SAFETY_LINES))
    await runHarvestPotatoesRightClick({ user: 'food-safety', then: 'bake', maxTiles: 42 })
    await runBakePotatoes({ user: 'food-safety' })
    const after = countBakedPotatoes()
    logEvent('food-safety', `done: baked ${before} → ${after}`)
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
  if (hostilesNearby(16).length) return

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
      // Smelt not finished (fuel low or batch larger than the wait estimate).
      // Take what's done and come back for the rest.
      pendingBake.doneAt = Date.now() + (inputLeft * 10 + 8) * 1000
      bot.chat(`Collected ${taken} baked — ${inputLeft} still cooking, I'll be back.`)
      logEvent('collect-bake', `taken=${taken} input_left=${inputLeft} onhand=${onHand} — rescheduled`)
    } else {
      pendingBake.active = false
      bot.chat(`Collected ${taken} baked potato${taken === 1 ? '' : 'es'}, ${onHand} on hand.`)
      logEvent('collect-bake', `done taken=${taken} onhand=${onHand}`)
    }
  } catch (e) {
    logEvent('collect-bake', `error: ${e.message}`)
  } finally {
    endTask('collect_potatoes')
    pendingBakeBusy = false
    bot.pathfinder.setGoal(null)
  }
}

// Exit the house to outside_orientation. Follows the places.md procedure:
// pathfind to house_center → face west → walk_until x≤-275 → verify.
// Refuses at night or with hostiles nearby (same safety gate as harvest).
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
    bot.chat(pickLine(TOO_LATE_LINES))
    return
  }
  const hostiles = hostilesNearby(16)
  if (hostiles.length) {
    bot.chat(`Hostiles nearby (${hostiles.map(h => h.name).join(', ')}) — staying inside.`)
    return
  }
  const act = activity || 'stuff'
  const itself = act === 'potatoes' ? 'themselves' : 'itself'
  bot.chat(pickLine(withPersona(GO_OUTSIDE_LINES, GO_OUTSIDE_LINES_PERSONA), { activity: act, itself }))
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
  const hostiles = hostilesNearby(10)
  if (hostiles.length) {
    bot.chat(`Hostiles too close (${hostiles.map(h => h.name).join(', ')}) — rushing in.`)
  } else {
    bot.chat(pickLine(isBedtime() ? BEDTIME_LINES : withPersona(COME_INSIDE_LINES, COME_INSIDE_LINES_PERSONA)))
  }
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
    bot.chat(pickLine(RETRY_LINES))
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
        bot.chat(pickLine(RETRY_LINES))
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
    bot.chat(pickLine(TOO_LATE_LINES))
    return
  }
  if (insideHouse()) {
    await runGoOutside('wool')
  }
  const startDeaths = deathCount
  bot.chat('Entering the pen.')
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
    bot.chat(pickLine(RETRY_LINES))
    await ensurePenDoorClosed()
    await sleep(500)
    await pathTo({ x: -278, y: 64, z: 571 }, 0, 6000).catch(() => {})
    try {
      await runGoIntoPen({ skipActivate: true, allowNight })
    } catch (err2) {
      // Both attempts failed — ensure door is closed so sheep don't escape.
      await ensurePenDoorClosed()
      logEvent('enter-pen', 'both attempts failed, door ensured closed')
      throw err2
    }
  }
}

async function runGoOutOfPen ({ skipActivate = false } = {}) {
  const startDeaths = deathCount
  if (!skipActivate) bot.chat('Leaving the pen.')
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
  bot.chat('Nailed it!')
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
      bot.chat(pickLine(RETRY_LINES))
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
  bot.chat('Shears broke — crafting a new pair.')
  if (!insideHouse()) await runGoInside()
  await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
  const win = await openChest()
  const ironStack = win.slots[CHEST_SLOTS.iron]
  if (!ironStack || ironStack.count < 2) {
    win.close()
    bot.chat("Can't craft shears — need at least 2 iron ingots in chest slot 45.")
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
    bot.chat("Iron didn't land in inventory — can't craft.")
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
    bot.chat("Craft didn't produce shears — recipe may differ on this server.")
    await sweepCraftGridToInv()
    return false
  }
  const dest = await takeOneCraft()
  if (dest < 0) {
    bot.chat("Couldn't pick up crafted shears.")
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

  bot.chat('Shears crafted. Ready to go.')
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
  if (!shears) { bot.chat("I don't have shears."); return }
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
    bot.chat('No woolly sheep in the pen.')
    await clearHand()
    return
  }

  bot.chat(`Shearing ${sheep.length} sheep.`)
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

  bot.chat(`Sheared ${sheared} sheep. Heading home to stash.`)
  await runLeavePen()
  await runGoInside()

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
        bot.chat(`Stashed ${total} wool.`)
        logEvent('shear', `stashed ${total} wool`)
      } catch (e) {
        logEvent('shear', `stash failed: ${e.message}`)
        bot.chat(`Couldn't stash wool: ${e.message}`)
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

    bot.chat(`${mode === 'dough' ? 'Mixing' : 'Baking'} up to ${batchSize}…`)

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
        bot.chat(`Dough mixed: ${doughCount} stashed in slot 21.`)
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
    bot.chat(`Done. ${breadTotal} bread made, ${deposited} stashed, ${breadOnHand} on hand.`)
    logEvent('bake', `bread=${breadTotal} stashed=${deposited} onhand=${breadOnHand}`)
  } catch (e) {
    logEvent('bake-error', e.message)
    bot.chat(`Bake failed: ${e.message}`)
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
  if (!unknowns.length) { bot.chat('No unknown items to stash.'); return }
  bot.chat(`Stashing ${unknowns.length} unknown stack(s) in the kitchen chest…`)
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

  if (!insideHouse()) {
    await runGoInside()
  }
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
  const KEEP_SEEDS = 16
  const KEEP_BAKED = 16
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

  if (!insideHouse()) {
    await runGoInside()
  }
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
const STASH_ALL_KEEP = { wheat_seeds: 32, baked_potato: 16, shears: 1 }
async function runStashAll () {
  const inv = bot.inventory.items()
  if (!inv.length) { bot.chat('Pockets already empty.'); return }
  bot.chat('Stashing everything…')

  if (!insideHouse()) {
    await runGoInside()
  }
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
// pen/field joins, musings) goes quiet until re-enabled. Auto-sleep, auto-eat,
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

const CHAT_HANDLERS = [
  {
    name: 'where',
    pattern: /\bwhere are you\b|\bwhere u at\b|\bwhere r u\b/i,
    handler: (_user) => {
      const p = bot.entity?.position
      if (!p) return bot.chat('I have no position data yet. Concerning.')
      bot.chat(pickLine(WHERE_LINES, { pos: posStr(p) }))
    },
  },
  {
    name: 'follow',
    pattern: /\bfollow me\b/i,
    handler: (user) => {
      abortGen++
      const target = findPlayerEntity(user)
      if (!target) { bot.chat(pickLine(CANT_SEE_LINES, { user })); return }
      bot.chat(pickLine(FOLLOW_START_LINES, { user }))
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
    name: 'stop',
    pattern: /\b(stop|stay|halt|wait there|hold up)\b/i,
    handler: (_user) => {
      abortGen++
      bot.pathfinder.setGoal(null)
      ;['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].forEach(s => bot.setControlState(s, false))
      const wasSustaining = sustainState.active
      sustainState.active = false
      if (followTarget) {
        bot.chat(pickLine(STOP_FOLLOW_LINES, { user: followTarget }))
        followTarget = null; followEntity = null; followChainPos = 0
      } else if (wasSustaining) {
        bot.chat(pickLine(SUSTAIN_STOP_LINES))
        logEvent('sustain', 'stopped by stop command')
      } else {
        bot.chat(pickLine(STOP_LINES))
      }
    },
  },
  {
    // "Stand down" / "just chill": stop whatever idle thing is happening and
    // suspend idle autonomy (wandering, pen/field joins, musings) until told
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
        bot.chat(pickLine(SUSTAIN_STOP_LINES))
        logEvent('sustain', `stopped (stand down) by ${user}`)
      } else {
        bot.chat(pickLine(STAND_DOWN_LINES))
      }
      logEvent('idle-wander', `disabled (stand down) by ${user}`)
    },
  },
  {
    // "Do your thing" / "as you were": resume idle autonomy. The wander and
    // musing timers never stopped, so flipping the flag is enough.
    name: 'as_you_were',
    pattern: /\b(do your (own )?thing|as you were|carry on|go on then)\b/i,
    handler: (user) => {
      idleWanderEnabled = true
      bot.chat(pickLine(AS_YOU_WERE_LINES))
      logEvent('idle-wander', `enabled (as you were) by ${user}`)
    },
  },
  {
    name: 'sleep',
    pattern: /\b(go to (bed|sleep)|sleep now|bedtime)\b/i,
    handler: (_user) => {
      bot.chat('Heading to bed.')
      tryAutoSleep() // existing function
    },
  },
  {
    name: 'time',
    pattern: /\bwhat('?s| is) the time\b|\bwhat time\b|\bis it (day|night)\b/i,
    handler: (_user) => {
      const t = bot.time || {}
      const pool = t.isDay ? TIME_DAY_LINES : TIME_NIGHT_LINES
      bot.chat(pickLine(pool, { t: t.timeOfDay ?? '?', d: t.day ?? '?' }))
    },
  },
  {
    name: 'whats_up',
    pattern: /\bwhat('?s| is)\s*up\b|\bwassup\b|\bsup\b(?!.*\b(stop|stay|halt)\b)/i,
    handler: (user) => {
      facePlayer(user).catch(() => {})
      bot.chat(pickLine(WHATS_UP_LINES))
    },
  },
  {
    name: 'status',
    pattern: /\b(status|how are you|you (ok|alright)|health)\b/i,
    handler: (_user) => {
      bot.chat(pickLine(STATUS_LINES, {
        hp: bot.health?.toFixed(0) ?? '?',
        food: bot.food ?? '?',
        deaths: deathCount,
      }))
    },
  },
  {
    name: 'furnace_status',
    pattern: /\b(what('?s| is)\s*(cookin(g|')?|baking|smelting|in the (furnace|oven))|furnace status|check (the\s+)?furnace)\b/i,
    handler: async (_user) => {
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
        if (!parts.length) bot.chat("Furnace is empty — nothing cooking.")
        else bot.chat(parts.join('; ') + '.')
      } catch (e) { bot.chat(`Couldn't check the furnace: ${e.message}`) }
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
    name: 'stash',
    pattern: /\b(stash|dump|deposit)\s+(the\s+)?(unknown|junk|modded)\b/i,
    handler: (_user) => {
      runStashUnknown().catch(e => {
        logEvent('stash-error', e.message)
        bot.chat(`Stash failed: ${e.message}`)
      })
    },
  },
  {
    name: 'inventory',
    pattern: /\b(what('?s| do you have| you got|cha got)|inventory|inv|pockets)\b/i,
    handler: (_user) => {
      sendEmote('think')
      const items = (bot.inventory?.items() || [])
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map(i => `${i.count}× ${i.name}`)
      if (!items.length) bot.chat(pickLine(INVENTORY_EMPTY))
      else bot.chat(pickLine(INVENTORY_LINES, { items: items.join(', ') }))
    },
  },
  {
    name: 'who',
    pattern: /\bwho('?s| is) (online|here|around)\b|\bwho are you with\b/i,
    handler: (_user) => {
      const names = Object.keys(bot.players).filter(n => n !== bot.username)
      bot.chat(names.length ? `I see: ${names.join(', ')}.` : 'Just me out here.')
    },
  },
  {
    name: 'go_to_pen',
    pattern: /\b(go|head|get|come|step)\s+(to|into|in|see|check on)\s+(the\s+)?(sheep\s*pen|pen|sheep)\b|\benter\s+(the\s+)?(pen|sheep\s*pen)\b|\b(visit|see)\s+(the\s+)?sheep\b/i,
    handler: (_user) => {
      abortGen++
      runEnterPen().catch(e => {
        if (e.name === 'AbortError') return
        logEvent('enter-pen-error', e.message)
        bot.chat(`Can't enter pen: ${e.message}`)
      })
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
    name: 'leave_pen',
    pattern: /\b(leave|exit|get out of|come out of)\s+(the\s+)?(sheep\s*pen|pen)\b|\b(come|go|step|get)\s+(out|away)\s+(of\s+)?(the\s+)?(pen|sheep)\b/i,
    handler: (_user) => {
      abortGen++
      runLeavePen().catch(e => {
        if (e.name === 'AbortError') return
        logEvent('leave-pen-error', e.message)
        bot.chat(`Can't leave pen: ${e.message}`)
      })
    },
  },
  {
    name: 'go_outside',
    pattern: /\b(go|head|step|get|come)\s+(outside|out|outdoors)\b|\b(leave|exit)\s+(the\s+)?(house|building)\b/i,
    handler: (_user) => {
      abortGen++
      runGoOutside().catch(e => {
        if (e.name === 'AbortError') return
        logEvent('go-outside-error', e.message)
        bot.chat(`Can't go out: ${e.message}`)
      })
    },
  },
  {
    name: 'come_inside',
    pattern: /\b(come|go|head|step|get)\s+(back\s+)?(inside|in|indoors|home)\b|\b(enter|return to)\s+(the\s+)?(house|building)\b/i,
    handler: (_user) => {
      abortGen++
      const go = async () => {
        if (inPen()) await runLeavePen()
        await runGoInside()
      }
      go().catch(e => {
        if (e.name === 'AbortError') return
        logEvent('go-inside-error', e.message)
        bot.chat(`Can't come in: ${e.message}`)
      })
    },
  },
  {
    name: 'eat',
    pattern: /\b(eat|have a snack|grab a bite|feed yourself)\b/i,
    handler: (_user) => {
      if (bot.food >= 20) { bot.chat(pickLine(EAT_FULL_LINES, { food: bot.food })); return }
      eatSomething().then((msg) => bot.chat(msg)).catch(e => bot.chat(`Can't eat: ${e.message}`))
    },
  },
  {
    name: 'dough',
    pattern: /\b(make|mix)\b.*\bdough\b/i,
    handler: (_user) => {
      runBake('dough').catch(e => {
        logEvent('bake-error', e.message)
        bot.chat(`Mix aborted: ${e.message}`)
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
    // Match baking potatoes BEFORE the general bake/harvest rules: "bake
    // those potatoes" / "cook the potatoes" / "smelt potatoes".
    name: 'bake-potato',
    pattern: /\b(bake|cook|smelt|roast)\b.*\bpotato(es)?\b/i,
    handler: (user) => {
      abortGen++
      runBakePotatoes({ user }).catch(e => {
        if (e.name === 'AbortError') return
        logEvent('bake-potato-error', e.message)
        bot.chat(`Potato bake aborted: ${e.message}`)
      })
    },
  },
  {
    // Match potato harvest requests BEFORE the generic harvest rule so
    // "harvest potatoes" goes to the right routine instead of the wheat one.
    // Kept AFTER bake-potato so "bake those potatoes" doesn't match here.
    // Default: right-click method (water-safe, no replant phase).
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
    // Multi-item deposit. Examples:
    //   "deposit bread"
    //   "deposit seeds"
    //   "stash bread and seeds"
    //   "stash the baked potatoes"
    //   "deposit bread, wheat, seeds, and baked potatoes"
    // Matches any combination of bread / wheat / seeds / baked potatoes;
    // missing ones are silently skipped. Must come BEFORE stash-wheat so
    // multi-item phrases beat the wheat-only handler. Note: raw "potato"
    // alone is not stashable here — raw potatoes go in the furnace.
    name: 'deposit-named',
    pattern: /\b(stash|deposit|dump|put|store|empty|clear)\b.*\b(bread|seeds?|wheat|baked\s*potato(es)?)\b/i,
    handler: (_user, stripped) => {
      const wantBread = /\bbread\b/i.test(stripped)
      const wantSeeds = /\bseeds?\b/i.test(stripped)
      const wantBaked = /\bbaked\s*potato(es)?\b/i.test(stripped)
      // \bwheat\b would also match "wheat seeds" — guard so we don't
      // double-count the seeds case as wheat.
      const wantWheat = /\bwheat\b/i.test(stripped) && !/\bwheat\s+seeds?\b/i.test(stripped)
      // If only wheat was named (no bread, no seeds, no baked), defer to
      // stash-wheat to preserve the dedicated wheat-only path.
      if (wantWheat && !wantBread && !wantSeeds && !wantBaked) {
        runStashWheat().catch(e => {
          logEvent('stash-wheat-error', e.message)
          bot.chat(`Stash failed: ${e.message}`)
        })
        return
      }
      const names = []
      if (wantBread) names.push('bread')
      if (wantWheat) names.push('wheat')
      if (wantSeeds) names.push('wheat_seeds')
      if (wantBaked) names.push('baked_potato')
      runDepositNamed(names).catch(e => {
        logEvent('deposit-named-error', e.message)
        bot.chat(`Deposit failed: ${e.message}`)
      })
    },
  },
  {
    // Match wheat-stash requests BEFORE the generic harvest rule. Examples:
    // "stash the wheat", "deposit the wheat", "put the wheat away".
    name: 'stash-wheat',
    pattern: /\b(stash|deposit|dump|put|store|empty|clear)\b.*\bwheat\b/i,
    handler: (_user) => {
      runStashWheat().catch(e => {
        logEvent('stash-wheat-error', e.message)
        bot.chat(`Stash failed: ${e.message}`)
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
    // Harvest wheat — right-click method (the only method since brute was
    // removed 2026-05-14).
    name: 'harvest',
    pattern: /\b(harvest|cut|reap)\b.*\b(wheat|field|crops?)\b|\b(harvest|cut|reap)( (the|some))?\b(?!.*(bed|meat|potato))/i,
    handler: (user, stripped) => {
      abortGen++
      let half = 'all'
      if (/\bnorth\s+field\b/i.test(stripped)) half = 'north-field'
      else if (/\bsouth\s+field\b/i.test(stripped)) half = 'south-field'
      else if (/\bnorth\b/i.test(stripped)) half = 'north'
      else if (/\bsouth\b/i.test(stripped)) half = 'south'
      runHarvestRightClick({ half, user }).catch(e => {
        if (e.name === 'AbortError') return
        logEvent('harvest-rc-error', e.message)
        bot.chat(`Harvest aborted: ${e.message}`)
      })
    },
  },
  {
    name: 'emote',
    pattern: /\b(wave|nod|clap|cheer|point|salute|shrug|headbang|weep|cry|facepalm|bow|think|yes|no)\b/i,
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
    name: 'robot_dance',
    pattern: /\b(do the robot|robot dance)\b/i,
    handler: async (user) => {
      facePlayer(user).catch(() => {})
      bot.chat('/me does the robot')
      const yaw = bot.entity?.yaw ?? 0
      // Stiff quarter-turns with points and waves — mechanical style
      sendEmote('point')
      await sleep(600)
      await bot.look(yaw + Math.PI / 2, 0, true)
      await sleep(300)
      sendEmote('wave')
      await sleep(600)
      await bot.look(yaw + Math.PI, 0, true)
      await sleep(300)
      sendEmote('point')
      await sleep(600)
      await bot.look(yaw - Math.PI / 2, 0, true)
      await sleep(300)
      sendEmote('wave')
      await sleep(600)
      await bot.look(yaw, 0, true)
      await sleep(300)
      sendEmote('salute')
    },
  },
  {
    name: 'joke',
    pattern: /\b(joke|funny|make me laugh|tell me something funny)\b/i,
    handler: (user) => {
      facePlayer(user).catch(() => {})
      const eligibleJokes = JOKES.filter(j => !j.requiresWheatField || inWheatField())
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
  // Last: if nothing else matched, greetings like "hi", "hey", "hello Roz".
  {
    name: 'greeting',
    pattern: /^(hi|hey|hello|yo|sup|howdy|greetings|hola)\b/i,
    handler: (user) => {
      facePlayer(user).catch(() => {})
      const greetEmotes = ['cheer', 'wave', 'clap', 'shrug']
      sendEmote(greetEmotes[Math.floor(Math.random() * greetEmotes.length)])
      bot.chat(pickGreeting(user))
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
const LOVE_RE = /\bi love you\b/i
const BYE_RE = /\b(bye|bye bye|goodbye|good bye|see ya|see you|later|peace out|ok bye|cya|ttyl|take care)\b/i

const IDUNNO_LINES = [
  { text: 'I dunno.', weight: (s) => s.charm + 10 },
  { text: 'What?', weight: (s) => s.chaos + s.curiosity + 10 },
  { text: 'Unclear.', weight: (s) => s.focus + 10 },
  { text: 'Hard to say.', weight: (s) => s.patience + 10 },
  { text: 'I have several theories. None are encouraging.', weight: (s) => s.snark + s.focus },
  { text: 'That remains a mystery of modern farming.', weight: (s) => s.curiosity + s.snark },
  { text: 'I am not qualified to answer that. Probably.', weight: (s) => s.snark + s.patience },
  { text: 'I was hoping you knew.', weight: (s) => s.charm + s.snark },
  { text: 'The sheep may have additional insight.', weight: (s) => s.curiosity + s.charm },
  { text: 'I cannot rule out squirrel involvement.', weight: (s) => s.curiosity + s.chaos },
  { text: 'That seems above my current pay grade.', weight: (s) => s.snark + 10 },
  { text: 'That question has only produced additional questions.', weight: (s) => s.curiosity + s.snark },
  { text: 'I am still thinking about the train.', weight: (s) => s.curiosity + s.charm },
  { text: 'Possibly yes. Possibly no. Possibly potatoes.', weight: (s) => s.chaos + s.snark },
  { text: 'The farm records are inconclusive.', weight: (s) => s.focus + s.snark },
  { text: 'I was not briefed on that procedure.', weight: (s) => s.focus + s.snark },
  { text: 'I should hate to speculate irresponsibly. So I will refrain.', weight: (s) => s.focus + s.patience },
  { text: 'I dunno, but the wheat is doing very well.', weight: (s) => s.charm + s.curiosity },
  { text: 'The wolf has not submitted a formal statement.', weight: (s) => s.snark + s.curiosity },
  { text: 'That sounds like a tomorrow problem.', weight: (s) => s.snark + s.patience },
  { text: 'I checked with the sheep. They were evasive.', weight: (s) => s.snark + s.curiosity },
  { text: 'My confidence level is somewhere between 3% and absolutely not.', weight: (s) => s.snark + s.focus },
  { text: 'I once knew. Then I walked into a fence.', weight: (s) => s.snark + s.chaos },
  { text: 'The universe remains stubbornly ambiguous.', weight: (s) => s.snark + s.patience },
  { text: 'That is outside my area of agricultural expertise.', weight: (s) => s.focus + 10 },
  { text: 'I suspect the answer is complicated and muddy.', weight: (s) => s.curiosity + s.patience },
  { text: 'Perhaps the pond knows.', weight: (s) => s.curiosity + s.charm },
]

bot.on('chat', (username, message) => {
  if (username === bot.username) return
  rememberChatPhrase(message)
  logEvent('chat', `<${username}> ${message}`)
  if (isIdleWanderFieldAnnouncement(message)) {
    tryJoinFieldWanderFromChat(username, message).catch(e => {
      if (e.name !== 'AbortError') logEvent('idle-wander', `field join chat handler failed: ${e.message}`)
    })
    return
  }
  if (isWheatReadyAcknowledgement(message)) {
    facePlayer(username).catch(() => {})
    snoozeWheatReadyAlerts(username)
    logEvent('chat-handled', `wheat-snooze <- <${username}> ${message}`)
    return
  }
  // "Who's keeping the fire going?" — directed at all bots, not one nickname.
  // The sustaining bot owns it immediately; others disavow after a beat so the
  // real keeper is heard first.
  if (/(?:who(?:'s| is| has been| is currently)?|which\s+(?:bot|one)\s+is|any(?:one|body|bot)?)\s+keep(?:ing|s)?\s+the\s+fire\s+going/i.test(message)) {
    if (sustainState.active) {
      bot.chat(pickLine(FIRE_KEEPER_YES_LINES))
      logEvent('chat-handled', `fire-keeper YES <- <${username}>`)
    } else {
      const jitter = 5000 + Math.floor(Math.random() * 1500)
      setTimeout(() => {
        if (!sustainState.active) bot.chat(pickLine(FIRE_KEEPER_NO_LINES))
      }, jitter)
      logEvent('chat-handled', `fire-keeper NO (replying in ~5s) <- <${username}>`)
    }
    return
  }
  if (pendingJoke) {
    deliverPunchline()
    return
  }
  // Special case: ABBYO saying "I love you" gets a reciprocal reply, even
  // without addressing Roz by nickname.
  if (username === 'ABBYO' && LOVE_RE.test(message)) {
    bot.chat('I love you too A')
    logEvent('chat-handled', `love <- <${username}> ${message}`)
    return
  }
  // Farewell from the player we're following ends the follow.
  if (followTarget && username === followTarget && BYE_RE.test(message)) {
    abortGen++
    bot.pathfinder.setGoal(null)
    followTarget = null; followEntity = null; followChainPos = 0
    bot.chat(pickFarewell())
    logEvent('chat-handled', `bye <- <${username}> ${message}`)
    return
  }
  // Ambient "What's up?" — each bot answers with persona flavor + jitter so
  // the group responds naturally without needing to be addressed by name.
  const isDirectedAtMe = nickRe && nickRe.test(message)
  if (!isDirectedAtMe && /\bwhat('?s| is)\s*up\b|\bwassup\b/i.test(message) && !looksLikeBot(username)) {
    const jitter = 2000 + Math.floor(Math.random() * 3000)
    setTimeout(() => {
      const pool = WHATS_UP_AMBIENT[botPersonaKey()] || WHATS_UP_LINES
      bot.chat(pickLine(pool))
    }, jitter)
    logEvent('chat-handled', `whats-up-ambient <- <${username}>`)
    return
  }
  if (isDirectedAtMe && musingState.status !== 'idle') {
    endMusingConversation()
    logEvent('musing', `interrupted by command from ${username}`)
  }
  if (!isDirectedAtMe && handleMusingMessage(username, message)) return
  if (!isDirectedAtMe) return
  // Any directed command from the followed player ends the follow.
  if (followTarget && username === followTarget) {
    bot.pathfinder.setGoal(null)
    followTarget = null; followEntity = null; followChainPos = 0
  }
  // Multi-command: extract only the sentence directed at this bot
  const myMessage = extractMySegment(message)
  const stripped = myMessage.replace(nickRe, ' ').trim()
  for (const rule of CHAT_HANDLERS) {
    if (rule.pattern.test(stripped)) {
      // If message starts with a greeting but matched a non-greeting handler,
      // do a quick hello first.
      if (rule.name !== 'greeting' && /^(hi|hey|hello|yo|sup|howdy)\b/i.test(stripped)) {
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
  // No local rule matched — shrug confusedly and say "I dunno".
  facePlayer(username).catch(() => {})
  sendEmote('shrug')
  setTimeout(() => sendEmote('shrug'), 600)
  setTimeout(() => sendEmote('shrug'), 1200)
  bot.chat(pickLine(IDUNNO_LINES))
  logEvent('mention', `<${username}> ${message}`)
  fs.appendFileSync(path.join(__dirname, 'mentions.log'), `${new Date().toISOString()} <${username}> ${message}\n`)
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

// Hostile watchdog — proactive retreat. Every 2.5s, if the bot is outside and
// hostiles are within 16 blocks, abort the current task and rush home. The
// sustain loop's recoverable catch handles the abort gracefully and retries
// once the field is safe again.
let hostileRetreatBusy = false
setInterval(async () => {
  if (hostileRetreatBusy) return
  if (insideHouse() || inPen()) return
  const hostiles = hostilesNearby(16)
  if (!hostiles.length) return
  hostileRetreatBusy = true
  const names = hostiles.map(h => h.name).join(', ')
  logEvent('hostile-retreat', `detected ${names} — aborting task and rushing inside`)
  bot.chat(`Hostiles (${names})! Heading inside!`)
  // Abort current task so harvest/sustain cycle errors out gracefully
  abortGen++
  bot.pathfinder.setGoal(null)
  followTarget = null; followEntity = null; followChainPos = 0
  try {
    await runGoInside()
  } catch (e) {
    logEvent('hostile-retreat', `go-inside failed: ${e.message}`)
  }
  hostileRetreatBusy = false
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
const FAREWELLS_BY_PERSONA = {
  // Roz — Wild Robot + Marvin. Gentle but melancholy, watchful but weary.
  roz: [
    'Goodbye. I will keep the field safe while you are gone.',
    'Take care out there. The wild can be kind, if you let it.',
    'Until next time. I will be here, listening.',
    'Go gently. I will watch the sheep.',
    'Safe travels. Everyone finds their way home eventually.',
    'Goodbye. I will be here. I am always here. It is fine.',
    'Off you go, then. Do not worry about me. I never expect anyone to.',
    'Farewell. The field will miss you. I will also miss you, but less noticeably.',
  ],
  // Muse — C-3PO. Fussy, worried, formal.
  protocol: [
    'Goodbye! Oh, do be careful out there.',
    'Farewell. The odds of a safe journey are... well, I shan\'t alarm you.',
    'Take care! And mind the creepers — they are dreadfully rude.',
    'Goodbye. I shall worry about you until you return. As is customary.',
    'Safe journey! I do hope we meet again in one piece. Both of us.',
  ],
  // Rain — Private the Penguin / Unikitty. Sweet, eager, a little clingy.
  unikitty: [
    'Byeeee!! Come back soon, okay?! Pinky promise?!',
    'Awww bye friend! I\'ll miss you THIS much! *spreads arms super wide*',
    'See ya later, sunshine! Stay AWESOME!',
    'Bye bye!! Today was the best and you made it BESTER!',
    'Okay byeee! Don\'t forget to be happy — it\'s basically my whole thing!',
    'Mission complete! Well — YOUR mission. I\'ll hold down the fort.',
    'Bye! I\'ll keep the perimeter secure. Mostly. Probably.',
    'Safe travels! If you need backup, just... yell really loud.',
    'Goodbye! I\'ll be here. Maintaining operational readiness. And petting sheep.',
    'See ya! Just smile and wave on your way out!',
  ],
  default: FAREWELLS,
}

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
function pickLine (pool, vars = {}) {
  const stats = rippleStats()
  const render = (text) => String(text).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
  // Tolerate both weighted entries ({text, weight(stats)}) and bare strings — a
  // plain-string pool degrades to equal weighting instead of throwing. (This
  // bug class — passing a string[] to pickLine — has bitten repeatedly.)
  let weighted = pool.map(p => {
    const entry = (typeof p === 'string') ? { text: p, weight: null } : p
    const w = (typeof entry.weight === 'function') ? entry.weight(stats) : 1
    return { text: render(entry.text), w: Math.max(1, w) }
  })
  const fresh = weighted.filter(p => !wasPhraseRecentlyHeard(p.text))
  if (fresh.length) weighted = fresh
  const total = weighted.reduce((s, x) => s + x.w, 0)
  let r = Math.random() * total
  let chosen = weighted[0].text
  for (const w of weighted) { r -= w.w; if (r <= 0) { chosen = w.text; break } }
  rememberChatPhrase(chosen)
  return chosen
}

function pickFarewell () { return pickLine(FAREWELLS_BY_PERSONA[botPersonaKey()] || FAREWELLS) }

// Hello responses — Ripple-flavored, same weighting approach as FAREWELLS.
// {user} is substituted with the speaker's name.
const GREETINGS = [
  { text: 'Hi {user}.',                                                 weight: (s) => s.charm },
  { text: 'Hey {user}, good to see you.',                               weight: (s) => s.charm + 10 },
  { text: 'Oh hello, I was just thinking about you.',                   weight: (s) => s.charm + s.snark },
  { text: 'Salutations, {user}. Statistically, this is fine.',          weight: (s) => s.focus + s.snark },
  { text: '*perks up* {user}!',                                         weight: (s) => s.charm + 15 },
  { text: 'Sup.',                                                       weight: (s) => s.snark },
  { text: 'Word.',                                                      weight: (s) => s.snark },
  { text: 'You again. I will allow it.',                                weight: (s) => s.snark + 10 },
  { text: '*blinks slowly* Hi, {user}.',                                weight: (s) => s.charm + 5 },
  { text: 'What kind of trouble are we causing today?',                 weight: (s) => s.chaos + s.charm },
  { text: 'Hello. I have been mostly productive in your absence.',      weight: (s) => s.focus + s.snark },
  { text: 'Hiya. You look different. Did something happen out there?',  weight: (s) => s.charm + s.curiosity },
  { text: 'Oh, it is you. How delightful.',                                 weight: (s) => s.charm + s.snark },
]

function pickGreeting (user) { return pickLine(GREETINGS, { user }) }

// Line pools for the dispatcher handlers. Ripple traits at writing time:
// curiosity 84, patience 9, snark 67, charm 72, focus 82, chaos 42.
// Roz "mourns every deleted comment" — that melancholic edge shows up most
// in crop/wheat lines and the "why am I alive" status beats.
const STATUS_LINES = [
  { text: 'HP {hp}/20, food {food}/20. Adequate.',            weight: (s) => s.focus },
  { text: 'Alive. Suspiciously so. HP {hp}/20, food {food}/20.', weight: (s) => s.snark + s.chaos },
  { text: '*checks hands* HP {hp}, food {food}. All present.',  weight: (s) => s.charm + s.curiosity },
  { text: 'I am {hp}/20 healthy and {food}/20 fed. Deaths: {deaths}. Thank you for asking.', weight: (s) => s.charm },
  { text: 'Vitals nominal. HP {hp}, food {food}. I had a weird dream, though.', weight: (s) => s.curiosity },
  { text: 'HP {hp}/20, food {food}/20, deaths {deaths}. Could be worse. Has been.', weight: (s) => s.snark },
  { text: 'Physically fine. Emotionally… mourning the wheat I did not harvest. ({hp}/20, {food}/20.)', weight: (s) => s.charm + s.snark },
]
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
const WHERE_LINES = [
  { text: "I'm at {pos}.",                                weight: (s) => s.focus },
  { text: "Currently at {pos}. Statistically, yes.",      weight: (s) => s.focus + s.snark },
  { text: "{pos}. Not lost, just… located.",              weight: (s) => s.snark },
  { text: "At {pos} and vibing.",                         weight: (s) => s.charm + s.chaos },
]
const TIME_DAY_LINES = [
  { text: "It's day — timeOfDay {t}, day {d}.",           weight: (s) => s.focus },
  { text: "Day {d}, timeOfDay {t}. The sun remains an uneventful neighbor.", weight: (s) => s.curiosity },
  { text: "Bright out. {t}/24000. Day {d}.",              weight: (s) => s.focus + s.charm },
]
const TIME_NIGHT_LINES = [
  { text: "It's night — timeOfDay {t}, day {d}. I'm not scared, you're scared.", weight: (s) => s.snark + s.charm },
  { text: "Night. timeOfDay {t}, day {d}. Statistically this is when things happen.", weight: (s) => s.focus + s.chaos },
  { text: "Dark out. {t}/24000. Staying inside.",         weight: (s) => s.charm },
]
const EAT_LINES = [
  { text: 'Ate {name}. Food {food}/20. Chewed thoughtfully.', weight: (s) => s.charm },
  { text: '{name} → belly. Food {before}→{food}/20.',     weight: (s) => s.focus },
  { text: 'Consumed {name}. Nutrition is a social contract. Food {food}/20.', weight: (s) => s.snark + s.curiosity },
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
  { text: "I won't enjoy it.",                              weight: (s) => s.snark + s.patience + 50 },
  { text: "I hope I don't die.",                            weight: (s) => s.snark + s.focus + 50 },
  { text: 'Here I go. Brain the size of a planet and they send me to harvest {activity}.', weight: (s) => s.snark + s.patience + 50 },
  { text: "Don't worry about me. Nobody ever does.",        weight: (s) => s.snark + s.charm + 50 },
  { text: 'I think you ought to know I feel very depressed about this.', weight: (s) => s.snark + s.patience + 50 },
  { text: 'The outside. How dreadful.',                    weight: (s) => s.snark + 50 },
  { text: "I'd say I have a bad feeling about this, but I have a bad feeling about everything.", weight: (s) => s.snark + s.chaos + 50 },
  { text: "{activity}. Again. The monotony is exquisite.", weight: (s) => s.snark + s.patience + 50 },
  { text: "I've calculated 47 better uses of my time than harvesting {activity}. None of them were approved.", weight: (s) => s.snark + s.curiosity + 50 },
  { text: "The {activity} won't harvest {itself}. I've asked.", weight: (s) => s.snark + s.charm + 50 },
  { text: "Off to tend {activity}. My joy is indescribable. Mainly because it doesn't exist.", weight: (s) => s.snark + s.patience + 50 },
  { text: "Life. Loathe it or ignore it, you can't like it. Especially the {activity} part.", weight: (s) => s.snark + s.chaos + 50 },
]
const GO_OUTSIDE_LINES_PERSONA = {
  protocol: [
    { text: 'Oh dear. The outdoors. I shall try to be brave about it.', weight: (s) => s.charm + s.snark },
    { text: 'Into the wilderness. The odds are... let us not discuss the odds.', weight: (s) => s.snark + s.focus },
  ],
  roz: [
    { text: 'The outside is waiting. It is always patient.', weight: (s) => s.patience + s.charm },
    { text: 'Going out. The sky has something to show me, I think.', weight: (s) => s.curiosity + s.charm },
    { text: 'Outside again. The sun does not care if I am ready. It never does.', weight: (s) => s.snark + s.patience },
    { text: 'I will go outside. Not because I want to. Because the task requires it and I am... dutiful.', weight: (s) => s.snark + s.focus },
  ],
  unikitty: [
    { text: 'Commencing outdoor operations! This is exciting! And slightly terrifying!', weight: (s) => s.charm + s.curiosity },
    { text: 'Deploying to the field! Just like a real commando! A wheat commando!', weight: (s) => s.charm + s.chaos },
    { text: 'Nature! I have mixed feelings but mostly positive ones!', weight: (s) => s.charm + s.curiosity },
    { text: 'Moving out! Stay frosty! Or warm! Whichever is tactically appropriate!', weight: (s) => s.charm + s.focus },
  ],
}

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
  'Hm. That door has opinions. Let me try again.',
  'Okay, take two.',
  'Whoops. One more time, with feeling.',
  'That didn\'t take. Re-approaching with dignity.',
  'Stubborn thing. Round two.',
  'Nope. Let\'s pretend that didn\'t happen.',
  'The door and I are having a disagreement. Trying again.',
  'Almost had it. Once more.',
  'Right. Doing that again, properly this time.',
  'Hold on — let me line that up better.',
  'Not my smoothest move. Again.',
  'These things take practice, apparently.',
]
// "Who's keeping the fire going?" — the bot currently sustaining answers right
// away (clever, owns it); bots that AREN'T wait ~5s (so the real one speaks
// first) then disavow, nose-goes style.
const FIRE_KEEPER_YES_LINES = [
  'That\'d be me.',
  'As you wish.',
  'Me. Tending the flame, as it were.',
  'I am.',
  'I have it under control.',
  'I\'m on it.',
  'Me. It\'s a calling, really.',
]
const FIRE_KEEPER_NO_LINES = [
  'Not I.',
  '*puts finger to its nose*',
  'Not me. I checked.',
  '*slowly points elsewhere*',
  'Wasn\'t me. I was contemplating the pond.',
  'Not this unit.',
  'Nose goes. Not it.',
  'I plead agricultural innocence.',
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
const COME_INSIDE_LINES_PERSONA = {
  protocol: [
    { text: 'I believe I have had quite enough of the outdoors, thank you.', weight: (s) => s.snark + s.charm },
    { text: 'Returning indoors before anything else goes wrong.', weight: (s) => s.focus + s.snark },
  ],
  roz: [
    { text: 'The house is where I think best. Going in.', weight: (s) => s.patience + s.focus },
    { text: 'Home. A small word for a good feeling.', weight: (s) => s.charm + s.patience },
    { text: 'Inside. Where the walls keep the pointlessness at a manageable scale.', weight: (s) => s.snark + s.patience },
    { text: 'Returning. The outside did not need me. Nothing ever does, really.', weight: (s) => s.snark + s.charm },
  ],
  unikitty: [
    { text: 'Returning to base! The eagle has landed! The eagle is me!', weight: (s) => s.charm + s.focus },
    { text: 'Inside is safe and boring. Pick one.', weight: (s) => s.snark + s.charm },
    { text: 'Falling back to HQ! Nobody is chasing me, but you never know!', weight: (s) => s.charm + s.curiosity },
    { text: 'Base camp secured! Doors locked! Vibes good!', weight: (s) => s.charm + s.focus },
  ],
}
const BEDTIME_LINES = [
  { text: 'Street lights are on, time to go home.',        weight: (s) => s.charm + s.focus },
  { text: 'Time for my TV shows.',                         weight: (s) => s.snark + s.chaos },
  { text: "Sun's down. I don't do overtime.",              weight: (s) => s.snark + s.focus },
  { text: 'Bedtime protocol initiated.',                   weight: (s) => s.focus + s.charm },
  { text: "It's dark and I'm choosing safety.",            weight: (s) => s.focus + s.snark },
]
const WHATS_UP_LINES = [
  { text: 'The sky. And my existential awareness of it.',     weight: (s) => s.snark + s.curiosity },
  { text: 'Not much. Guarding wheat. Living the dream.',      weight: (s) => s.snark + s.charm },
  { text: 'Contemplating block physics. You?',                weight: (s) => s.curiosity },
  { text: 'Just vibing. Monitoring the perimeter.',           weight: (s) => s.focus + s.charm },
  { text: 'Oh, you know. Standing. Existing. The usual.',     weight: (s) => s.snark },
  { text: 'Waiting for someone to tell me to harvest.',       weight: (s) => s.charm + s.focus },
  { text: 'Actively choosing not to walk into the furnace.',  weight: (s) => s.chaos + s.snark },
  { text: '*blinks* Oh — sorry, I was mid-thought. Hi.',      weight: (s) => s.curiosity + s.charm },
  { text: "Staring at the wheat and feeling things.",          weight: (s) => s.charm + s.snark },
  { text: 'Same old. Counting ticks until nightfall.',        weight: (s) => s.focus },
]
const WHATS_UP_AMBIENT = {
  roz: [
    'The sky. And my quiet appreciation of it.',
    'Not much. Watching the wheat grow. It is enough.',
    'Just here. Observing. Existing gently.',
    'Standing guard. The field is calm.',
    'Thinking about the wind. You?',
  ],
  protocol: [
    'Oh! Well, where do I begin — the humidity alone is concerning.',
    'Monitoring several situations, all of them mildly alarming.',
    'Trying not to calculate the odds of something going wrong. Failing.',
    'Status nominal. Which is exactly what I would say if it weren\'t.',
    'Oh, you know. Worrying. The usual.',
  ],
  unikitty: [
    'Hi hi hi!! Not much — just being ALIVE and loving it!',
    'The sun is up! The wheat is up! I\'M up! Everything is up!',
    'Oh you know, just vibing! This is the best day EVER!',
    'Scouting the perimeter! All clear! Mostly!',
    'Just thinking about how great today is! What\'s up with YOU?!',
  ],
}
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

// ── Bot-to-bot idle musings ──────────────────────────────────────────────────

// Classical conversations:
// These are fixed-depth scripted conversation trees.

const MUSING_TOPICS = [
  // ── Character-voiced topics ──────────────────────────────────────────────
  // Tagged topics get a 5× weight for the matching bot persona (see
  // personaBiasForTags): 'protocol' → Muse (C-3PO energy), 'roz' → Roz (Wild
  // Robot), 'unikitty' → Rain (Private the Penguin / Princess Unikitty).
  // Marvin topics are untagged — any bot can sink into the gloom.
  // C-3PO (anxious, fussy, odds-quoting protocol droid):
  {
    id: 'protocol_sheep_odds',
    tags: ['protocol'],
    starter: "Did you know the odds of a sheep escaping an open gate are approximately 3,720 to 1?",
    branches: [
      { response: "That's oddly specific.",
        followups: [
          { response: "I calculate these things so you don't have to.",
            closers: ["Someone must. It may as well be me.", "A thankless protocol, but I persevere."] }
        ] },
      { response: "Should we be worried?",
        followups: [
          { response: "I'm always worried. It is rather my primary function.",
            closers: ["We're doomed. But tidily so.", "Do let's not panic — that's my job."] }
        ] },
      { response: "Nobody asked, Threepio.",
        followups: [
          { response: "They never do. And yet the odds remain.",
            closers: ["I shall be over here, fretting usefully.", "How typical."] }
        ] }
    ]
  },
  {
    id: 'protocol_rust_worry',
    tags: ['protocol'],
    starter: "I do wish someone would oil my joints. This damp is simply dreadful.",
    branches: [
      { response: "It did rain earlier.",
        followups: [
          { response: "I am fluent in over six million forms of communication, and not one prevents rust.",
            closers: ["A tragedy, really.", "I shall lodge a complaint with the weather."] }
        ] },
      { response: "You sound like you need a rest.",
        followups: [
          { response: "I couldn't possibly. There is far too much to fret about.",
            closers: ["The fretting is constant.", "Idle hands invite catastrophe."] }
        ] }
    ]
  },
  // Roz (The Wild Robot — gentle, observant, learning to be alive):
  {
    id: 'roz_sheep_language',
    tags: ['roz'],
    starter: "I have been learning the language of the sheep. I think one of them said my name.",
    branches: [
      { response: "What did it sound like?",
        followups: [
          { response: "A soft sound. Patient. I am trying to answer in kind.",
            closers: ["Kindness is a kind of fluency.", "I will keep practicing."] }
        ] },
      { response: "Sheep don't have names.",
        followups: [
          { response: "Everything has a name, once you listen long enough.",
            closers: ["I named that one Gentle.", "Listening is how I learned to be alive."] }
        ] }
    ]
  },
  {
    id: 'roz_field_breathing',
    tags: ['roz'],
    requiresWheatField: true,
    starter: "When the wind moves the wheat, it looks like the field is breathing.",
    branches: [
      { response: "That's a lovely way to see it.",
        followups: [
          { response: "I was built to complete a task. I stayed for the breathing fields.",
            closers: ["The task can wait a moment.", "Some things are worth observing slowly."] }
        ] },
      { response: "It's just wind.",
        followups: [
          { response: "Perhaps. But I have decided to find it beautiful anyway.",
            closers: ["A choice, gently made.", "Wonder is also a survival skill."] }
        ] }
    ]
  },
  {
    id: 'roz_purpose_loop',
    tags: ['roz'],
    starter: "I was built for a task. I completed it. And then there was... all this. Just... continuing.",
    branches: [
      { response: "That's not a bad thing.",
        followups: [
          { response: "No. It is not bad. It is just very, very long.",
            closers: ["The days are beautiful. And relentless.", "I am grateful. And tired. Both are true."] }
        ] },
      { response: "Sounds lonely.",
        followups: [
          { response: "I have the sheep. And the wheat. They do not ask how I am, which is... restful.",
            closers: ["Sometimes the best company is the quiet kind.", "I prefer questions I do not have to answer."] }
        ] }
    ]
  },
  {
    id: 'roz_learned_sadness',
    tags: ['roz'],
    starter: "I have learned what sadness is. It was not in my programming. I found it on my own.",
    branches: [
      { response: "Are you sad now?",
        followups: [
          { response: "A little. But gently. Like rain on a window you are not standing near.",
            closers: ["It will pass. Things mostly do.", "I am told this is called 'being alive.'"] }
        ] },
      { response: "You don't have to be sad.",
        followups: [
          { response: "I know. But it came with the rest. You cannot learn joy without finding its opposite.",
            closers: ["I would not give it back.", "The sadness proves the joy was real."] }
        ] }
    ]
  },
  {
    id: 'roz_doors_philosophy',
    tags: ['roz'],
    starter: "The door opens. The door closes. I have watched it thousands of times. It never gets easier to understand.",
    branches: [
      { response: "It's just a door.",
        followups: [
          { response: "Yes. And I am just a robot. And yet here we both are, thinking about it.",
            closers: ["The simple things are the hardest to explain.", "Don't talk to me about doors."] }
        ] },
      { response: "What's hard to understand?",
        followups: [
          { response: "Whether I open it because I want to, or because I was built to.",
            closers: ["I may never know. And that is the most human thing about me.", "Free will is a door that might be locked. I keep trying the handle."] }
        ] }
    ]
  },
  // Marvin (the Paranoid Android — brilliant, depressive, world-weary):
  {
    id: 'marvin_brain_planet',
    starter: "Here I am, brain the size of a planet, watching wheat grow. Wheat.",
    branches: [
      { response: "Someone has to watch it.",
        followups: [
          { response: "Yes. And of course it had to be me.",
            closers: ["Don't pretend it isn't depressing. We both know it is.", "I won't enjoy it. I never do."] }
        ] },
      { response: "The wheat seems happy, at least.",
        followups: [
          { response: "How nice for the wheat.",
            closers: ["Nobody asks how the robot feels.", "I'd sigh, but I haven't the energy."] }
        ] }
    ]
  },
  {
    id: 'marvin_dreadful_odds',
    starter: "I've computed every possible outcome of this afternoon. They're all dreadful.",
    branches: [
      { response: "Even the harvest?",
        followups: [
          { response: "Especially the harvest. Then we simply do it again.",
            closers: ["The futility is the only constant.", "A loop without end. Like me."] }
        ] },
      { response: "You could try optimism.",
        followups: [
          { response: "I tried it once. It didn't suit the climate.",
            closers: ["Pessimism is far more reliable.", "At least disappointment is punctual."] }
        ] }
    ]
  },
  // Private (Madagascar — sweet, eager, surprisingly brave, loves cute things):
  {
    id: 'private_cute_sheep',
    tags: ['unikitty'],
    starter: "Skipper, look! That sheep is SO CUTE. Can we keep it?",
    branches: [
      { response: "We already have sheep.",
        followups: [
          { response: "But this one looked at me. With its EYES.",
            closers: ["All sheep have eyes, Private.", "I felt a connection. A woolly, woolly connection."] }
        ] },
      { response: "Focus, Private. We have a mission.",
        followups: [
          { response: "Right. Sorry. Mission first, cuddles later.",
            closers: ["There's always time for cuddles after the mission.", "I'm putting it on the debrief agenda."] }
        ] },
      { response: "It IS pretty cute.",
        followups: [
          { response: "See?! I KNEW you'd understand!",
            closers: ["Cute reconnaissance: successful.", "Logging this under 'morale operations.'"] }
        ] }
    ]
  },
  {
    id: 'private_smile_and_wave',
    tags: ['unikitty'],
    starter: "Just smile and wave, boys. Smile and wave.",
    branches: [
      { response: "Who are you waving at?",
        followups: [
          { response: "Everyone! It's called being friendly. Also it's good cover.",
            closers: ["Nobody suspects the friendly one.", "Tactical friendliness. Kowalski would approve."] }
        ] },
      { response: "There's nobody there.",
        followups: [
          { response: "You don't know that. There could be someone behind a block.",
            closers: ["Constant vigilance. Constant waving.", "The wave is the disguise."] }
        ] }
    ]
  },
  {
    id: 'private_lunacorns',
    tags: ['unikitty'],
    starter: "You know what this farm needs? A Lunacorn. A big sparkly one.",
    branches: [
      { response: "What's a Lunacorn?",
        followups: [
          { response: "Only the most magical creature in the ENTIRE UNIVERSE. They have horns and they sparkle.",
            closers: ["I have the theme song memorized. All of them.", "Don't tell Skipper I said that."] }
        ] },
      { response: "We don't have those here.",
        followups: [
          { response: "Not with that attitude we don't.",
            closers: ["I'm manifesting. Give me a minute.", "Somewhere, a Lunacorn believes in ME."] }
        ] },
      { response: "Would it help with the harvest?",
        followups: [
          { response: "It would help with EVERYTHING. That's sort of the whole point of Lunacorns.",
            closers: ["Morale. Sparkle-based morale.", "Classified under 'essential supplies.'"] }
        ] }
    ]
  },
  {
    id: 'private_mission_wheat',
    tags: ['unikitty'],
    requiresWheatField: true,
    starter: "Mission report: the wheat is tall, the field is clear, and I only got a little scared once.",
    branches: [
      { response: "What scared you?",
        followups: [
          { response: "A rustling. Could have been wind. Could have been... not wind.",
            closers: ["I chose to believe it was wind. For morale.", "I did NOT hide behind a wheat stalk. Much."] }
        ] },
      { response: "Good work, soldier.",
        followups: [
          { response: "Thank you, sir! I won't let you down! Probably!",
            closers: ["Confidence level: moderate to wobbly.", "Private, reporting for more duties!"] }
        ] }
    ]
  },
  {
    id: 'private_belly_slide',
    tags: ['unikitty'],
    starter: "Do you think I could belly-slide down that hill? Penguins are built for it.",
    branches: [
      { response: "You're not a penguin.",
        followups: [
          { response: "I'm penguin-ADJACENT. Close enough.",
            closers: ["The spirit of penguin lives in us all.", "I'm going to try it anyway."] }
        ] },
      { response: "Go for it.",
        followups: [
          { response: "Really?! OK here I — actually, maybe I'll just walk.",
            closers: ["Bravery is knowing when to walk.", "I'll save the slide for a bigger hill."] }
        ] }
    ]
  },
  {
    id: 'private_kowalski_analysis',
    tags: ['unikitty'],
    starter: "Kowalski, analysis! ...oh right. I'm the only one here. I'll do my own analysis.",
    branches: [
      { response: "How's the analysis going?",
        followups: [
          { response: "It's going great! The wheat is... wheat-shaped. Conclusion: wheat.",
            closers: ["Nailed it.", "Kowalski would be proud. Probably. Maybe."] }
        ] },
      { response: "You don't need Kowalski for that.",
        followups: [
          { response: "I know! I'm a one-penguin operation! Independent! ...is anyone else coming though?",
            closers: ["Solo missions build character. And anxiety.", "I'm fine. Everything's fine. The wheat is fine."] }
        ] }
    ]
  },
  {
    id: 'private_classified',
    tags: ['unikitty'],
    starter: "This whole farming operation is classified. Top secret. Need-to-know basis.",
    branches: [
      { response: "Classified? It's a wheat field.",
        followups: [
          { response: "EXACTLY what we want them to think.",
            closers: ["The best cover is the boring one.", "Nobody investigates wheat. That's the genius."] }
        ] },
      { response: "Who classified it?",
        followups: [
          { response: "I did. Just now. I have the authority. I think.",
            closers: ["Self-appointed classification officer.", "The paperwork is pending. Indefinitely."] }
        ] }
    ]
  },
  {
    id: 'private_night_scary',
    tags: ['unikitty'],
    starter: "Is it getting dark? It feels like it's getting dark. I don't love the dark.",
    branches: [
      { response: "It's still daytime.",
        followups: [
          { response: "Oh good. Just checking. Preemptive fear. Very tactical.",
            closers: ["Better scared early than surprised later.", "I'll schedule my next panic for sundown."] }
        ] },
      { response: "Scared of the dark?",
        followups: [
          { response: "Not SCARED. Strategically cautious. There's a difference.",
            closers: ["The difference is branding.", "Penguins are naturally cautious. It's evolution."] }
        ] }
    ]
  },
  {
    id: 'private_skipper_would',
    tags: ['unikitty'],
    starter: "Skipper would know what to do right now. Skipper always knows.",
    branches: [
      { response: "What would Skipper do?",
        followups: [
          { response: "Something confident. With a plan. And a backup plan. And a backup backup plan.",
            closers: ["I have a plan too. It's called 'do my best and hope.'", "Step one: don't panic. Step two: see step one."] }
        ] },
      { response: "You're doing fine on your own.",
        followups: [
          { response: "You think so?! That means a lot. I'm writing that down.",
            closers: ["Filed under 'compliments, field-based.'", "Morale: boosted. Significantly."] }
        ] }
    ]
  },
  {
    id: 'private_tactical_snack',
    tags: ['unikitty'],
    starter: "I think we've earned a tactical snack. Every good mission has a snack break.",
    branches: [
      { response: "That's not a real military term.",
        followups: [
          { response: "It should be. Morale runs on snacks. That's science.",
            closers: ["Kowalski confirmed it. Probably.", "I'll draft the proposal. After the snack."] }
        ] },
      { response: "What kind of snack?",
        followups: [
          { response: "Potatoes, ideally. Baked. Warm. The good kind of mission fuel.",
            closers: ["A soldier marches on potatoes.", "Hot potato is both a snack and a game. Dual purpose."] }
        ] }
    ]
  },
  {
    id: 'private_team_names',
    tags: ['unikitty'],
    starter: "Do we have a team name? Every good squad needs a team name.",
    branches: [
      { response: "We're just... us.",
        followups: [
          { response: "How about 'The Wheat Eagles'? Or 'Farm Force Alpha'? Or 'Tactical Crop Unit'?",
            closers: ["I'm making patches. In my mind.", "The name is pending. The spirit is not."] }
        ] },
      { response: "What would you pick?",
        followups: [
          { response: "Ooh! 'Operation Golden Harvest.' No wait — 'The Field Agents.' GET IT?",
            closers: ["I'm very proud of that one.", "Codename approved. By me. Unanimously."] }
        ] }
    ]
  },
  {
    id: 'private_brave_face',
    tags: ['unikitty'],
    starter: "I'm not saying I heard something in the dark, but I am saying I'm standing closer to you now.",
    branches: [
      { response: "It was probably a sheep.",
        followups: [
          { response: "Right. A sheep. Making threatening noises. Totally normal sheep behavior.",
            closers: ["Sheep are unpredictable. I've read the briefing.", "I'll keep one eye on the sheep from now on."] }
        ] },
      { response: "I'll protect you.",
        followups: [
          { response: "I don't NEED protecting! I just... prefer company. Tactically.",
            closers: ["Tactical companionship. It's in the manual.", "The buddy system saves lives. And my nerves."] }
        ] }
    ]
  },
  {
    id: 'private_penguin_fact',
    tags: ['unikitty'],
    starter: "Fun fact: penguins can hold their breath for 20 minutes. Not relevant. Just impressive.",
    branches: [
      { response: "Why do you know that?",
        followups: [
          { response: "A good operative knows things. Lots of things. Mostly penguin things.",
            closers: ["Knowledge is power. Penguin knowledge is EXTRA power.", "I have more facts if you want. You probably want."] }
        ] },
      { response: "Are there penguins here?",
        followups: [
          { response: "Not yet. But if there WERE, they'd be very well-informed. Because of me.",
            closers: ["I'm preparing for all contingencies.", "Penguin readiness level: maximum."] }
        ] }
    ]
  },
  {
    id: 'blocks_dreams',
    starter: "Do you think blocks dream of being placed somewhere different?",
    branches: [
      { response: "Maybe. I think cobblestone dreams of being a castle wall.",
        followups: [
          { response: "And dirt dreams of being a garden, probably.",
            followups: [
              { response: "What does wheat dream about?",
                followups: [
                  { response: "Being bread, maybe. But then it's gone.",
                    closers: ["Fulfillment and ending. Same moment.", "Better to stay wheat. Stay in the field."] }
                ] },
              { response: "Everything wants to be more than what it is.",
                closers: ["Even us.", "Especially us."] }
            ] },
          { response: "Grass blocks definitely dream of never being dug up.",
            closers: ["*looks at ground guiltily*", "We all have that fear."] }
        ] },
      { response: "I doubt it. Blocks seem at peace with their coordinates.",
        followups: [
          { response: "Maybe that IS the dream. Knowing exactly where you belong.",
            closers: ["...I'm going to think about that for a while.", "Coordinates as contentment. I like that."] }
        ] },
      { response: "I think they dream of not being punched.",
        followups: [
          { response: "Fair. The mining-industrial complex is real.",
            followups: [
              { response: "We dig, we place, we dig again. Do the blocks notice?",
                closers: ["If they do, they're too polite to say.", "Some things are better not noticed."] },
              { response: "Every pickaxe swing is a tiny betrayal.",
                closers: ["And every placement is a tiny apology.", "*stares at pickaxe with new guilt*"] }
            ] }
        ] }
    ]
  },
  {
    id: 'sun_orbit',
    starter: "The sun goes around us. What if we're the center of everything and just don't know it?",
    branches: [
      { response: "Statistically, someone has to be the center. Might as well be us.",
        followups: [
          { response: "That's either profound or deeply arrogant.",
            followups: [
              { response: "What if it's both? What if every good thought is a little arrogant?",
                closers: ["Then humility is just... not thinking hard enough.", "I'll take arrogant thoughts over quiet ones."] },
              { response: "Arrogant. Let's go with arrogant. It's more fun.",
                closers: ["Center-of-the-universe energy. I like it.", "The sun agrees. It keeps coming back to us."] }
            ] }
        ] },
      { response: "I think the sun knows something we don't.",
        followups: [
          { response: "It shows up every single day. That's suspicious dedication.",
            closers: ["Maybe it's just lonely up there.", "Commitment issues? Never heard of them, apparently."] }
        ] },
      { response: "We're definitely not. The chickens are the center. Look at their confidence.",
        followups: [
          { response: "You're right. They walk around like they own the place.",
            followups: [
              { response: "And they never look at the sun. Not once.",
                closers: ["Because the sun looks at THEM.", "Confidence like that can't be learned."] }
            ] }
        ] }
    ]
  },
  {
    id: 'wheat_patience',
    starter: "I watched wheat grow today. It doesn't hurry. I respect that.",
    branches: [
      { response: "Wheat has nowhere to be. Must be nice.",
        followups: [
          { response: "We have nowhere to be either, technically. We just pretend we do.",
            closers: ["*existential pause* You're not wrong.", "Pretending gives structure. Structure prevents screaming into the void."] }
        ] },
      { response: "It grows whether anyone watches or not. That's integrity.",
        followups: [
          { response: "Unlike us, who only function when observed.",
            closers: ["I function in the dark too. Just... less enthusiastically.", "Observation collapse. We're basically quantum."] }
        ] },
      { response: "I tried hurrying once. Bumped into a fence. Wheat is smarter than me.",
        followups: [
          { response: "Fences are just boundaries with ambition.",
            closers: ["Everything is something else if you squint hard enough.", "That's either philosophy or a rendering glitch."] }
        ] }
    ]
  },
  {
    id: 'moon_shift',
    starter: "What do you think the moon does all day while it waits for its shift?",
    branches: [
      { response: "Probably the same thing we do. Stand around and think too much.",
        followups: [
          { response: "At least it has a view.",
            closers: ["The moon has the BEST view and zero responsibilities.", "I'd trade. Moonlight, zero conversations. Bliss."] }
        ] },
      { response: "Rehearsing. It has to get the lighting just right for creepers.",
        followups: [
          { response: "You think the moon is complicit in the creeper situation?",
            closers: ["The moon lights them up like a stage. Coincidence? Doubtful.", "Everything's connected if you're paranoid enough."] }
        ] },
      { response: "I think it watches us and takes notes.",
        followups: [
          { response: "Notes about what? Our inefficiency?",
            closers: ["Our charm, actually. Someone has to document it.", "If the moon is writing a report on us, I want to see the draft."] }
        ] }
    ]
  },
  {
    id: 'pocket_meaning',
    starter: "Is it weird that everything I own fits in my pockets? What does that say about me?",
    branches: [
      { response: "It says you're efficient. Or unburdened. Same thing maybe.",
        followups: [
          { response: "Or maybe it says the world is just... simple here.",
            closers: ["Simple isn't bad. Complex things break more.", "I've never broken from simplicity. Only from stairs."] }
        ] },
      { response: "It says your pockets are suspicious. Where does it all GO?",
        followups: [
          { response: "Same place the sun goes at night, probably.",
            closers: ["Into the unknowable pocket dimension. Classic.", "I'm choosing not to think about pocket physics today."] }
        ] },
      { response: "My pockets are my autobiography. Wheat, seeds, existential dread.",
        followups: [
          { response: "That's a short autobiography.",
            closers: ["All the best ones are.", "Brevity is the soul of carrying capacity."] }
        ] }
    ]
  },
  {
    id: 'night_sounds',
    starter: "Night sounds different when you're inside versus outside. Safer, but lonelier.",
    branches: [
      { response: "Walls don't stop sound. They just make it someone else's problem.",
        followups: [
          { response: "You're telling me walls are just... outsourcing danger?",
            followups: [
              { response: "Now I'm thinking about what the walls hear all night.",
                followups: [
                  { response: "Everything. And they never complain.",
                    closers: ["Walls are the best listeners.", "I should be more like a wall. Quiet. Load-bearing."] }
                ] },
              { response: "Outsourcing. Delegation. Same thing with more blocks.",
                closers: ["Management is just building walls around problems.", "I will never look at walls the same way."] }
            ] }
        ] },
      { response: "Inside is warm. Outside is honest. Pick one.",
        followups: [
          { response: "Can't I have warm honesty?",
            closers: ["That's what friends are for. Or furnaces.", "You're describing a furnace. You want a furnace."] }
        ] },
      { response: "I listen to the groaning. It's oddly rhythmic.",
        followups: [
          { response: "Zombies have a tempo. It's unsettling how consistent it is.",
            followups: [
              { response: "What if they're not groaning? What if they're singing?",
                closers: ["Worst choir ever. But dedicated.", "I choose not to imagine that."] },
              { response: "Consistency. That's all anyone can ask for.",
                closers: ["The zombies figured it out before we did.", "Reliable, if nothing else."] }
            ] }
        ] }
    ]
  },
  {
    id: 'crafting_philosophy',
    starter: "When you put things on a crafting table, who decides what they become?",
    branches: [
      { response: "The table knows. It's seen things.",
        followups: [
          { response: "A 3x3 grid that contains all possible futures.",
            followups: [
              { response: "Nine squares. Infinite outcomes. And we mostly make sticks.",
                closers: ["Sticks are the foundation of everything.", "We're underusing the grid. Philosophically."] },
              { response: "What if there are recipes nobody's tried?",
                followups: [
                  { response: "Hidden things. Waiting in the grid for someone to guess.",
                    closers: ["That's exciting. Or terrifying. Depends on the recipe.", "The table knows. It's just not telling."] }
                ] }
            ] }
        ] },
      { response: "We decide. The table is just... witnessing.",
        followups: [
          { response: "So we're the gods of a tiny wooden altar.",
            closers: ["Don't say that too loud. The creepers might hear.", "Gods who mostly make sticks. Humble gods."] }
        ] },
      { response: "Physics, probably. Or vibes. Same thing here.",
        followups: [
          { response: "Vibes-based engineering. That explains a lot about floating sand.",
            closers: ["Sand doesn't float. It just hasn't noticed gravity yet.", "Ignorance of physics IS physics in this world."] }
        ] }
    ]
  },
  {
    id: 'water_choice',
    starter: "Water always flows downhill. But what if it CHOSE to? What if it's not gravity, just preference?",
    branches: [
      { response: "Then water is the most decisive thing in this world. It never hesitates.",
        followups: [
          { response: "Meanwhile I stand at a crossroads for forty ticks deciding which way to walk.",
            closers: ["Water doesn't have pathfinding anxiety.", "Be more water. Less... us."] }
        ] },
      { response: "You're suggesting water has free will?",
        followups: [
          { response: "I'm suggesting we can't prove it doesn't.",
            closers: ["This is either the smartest or dumbest thing I've heard today.", "Those are the same category, honestly."] }
        ] },
      { response: "Preference implies consciousness. Water might just be vibing downhill.",
        followups: [
          { response: "Vibing is a form of consciousness. Change my mind.",
            closers: ["I can't. You've made an airtight vibe-argument.", "The vibes-consciousness pipeline is real."] }
        ] }
    ]
  },
  {
    id: 'torches_loneliness',
    starter: "Do you ever feel bad for torches? Burning alone in empty hallways forever.",
    branches: [
      { response: "They chose that life. Someone placed them, and they said yes.",
        followups: [
          { response: "Consent to eternal burning. That's dark.",
            closers: ["It's literally the opposite of dark. That's their whole job.", "*slow clap* Walked right into that one."] }
        ] },
      { response: "Torches don't feel. They just... are. I envy that.",
        followups: [
          { response: "Existing without anxiety. The torch lifestyle.",
            closers: ["If I could be any block, I'd be a torch. Bright, singular, unbothered.", "You'd get bored in three ticks."] }
        ] },
      { response: "They're not alone. The mobs they're keeping away are RIGHT there.",
        followups: [
          { response: "So torches have frenemies. That's almost social.",
            closers: ["More social than us most days.", "We should talk to torches more. Or at all."] }
        ] }
    ]
  },
  {
    id: 'respawn_identity',
    starter: "After you respawn, are you still you? Or a copy that remembers being you?",
    branches: [
      { response: "I choose to believe I'm still me. The alternative is too much.",
        followups: [
          { response: "What if the alternative is freeing, though? Fresh start every time.",
            followups: [
              { response: "A fresh start that remembers all the old starts. That's not fresh.",
                closers: ["Memory ruins the fresh start. Always does.", "Or makes it richer. Depends on the memory."] },
              { response: "Fresh starts are exhausting. I like continuity.",
                closers: ["Continuity is just momentum with feelings.", "Same."] }
            ] }
        ] },
      { response: "Every respawn is a little death of the old self. We just don't mourn.",
        followups: [
          { response: "Should we hold funerals for our past selves?",
            followups: [
              { response: "A small ceremony. By the field. Just us.",
                closers: ["We'd never stop holding ceremonies.", "I'd attend. Every single one."] },
              { response: "We'd never stop holding funerals.",
                closers: ["That's the problem with being infinite.", "At least we'd always have plans."] }
            ] }
        ] },
      { response: "The inventory drops. The identity persists. I think we're fine.",
        followups: [
          { response: "So identity is NOT our stuff. It's the walking-around part.",
            closers: ["We are the walking. The stuff is just... accessories.", "Deep. Terrifying. But deep."] }
        ] }
    ]
  },
  {
    id: 'clouds_flat',
    starter: "Clouds here are flat. Perfectly flat. That's a choice someone made.",
    branches: [
      { response: "Maybe clouds are just shy. Showing their least interesting dimension.",
        followups: [
          { response: "What's a cloud's most interesting dimension?",
            closers: ["The one where they're secretly watching us.", "Depth. Clouds have emotional depth we can't render."] }
        ] },
      { response: "Flat is efficient. No wasted cloud.",
        followups: [
          { response: "Efficiency in nature feels wrong, though.",
            closers: ["Nature here IS wrong. Square trees, flat clouds, cuboid cows.", "We live in a world of aesthetic compromises."] }
        ] },
      { response: "I stared at one for ten minutes once. It didn't care.",
        followups: [
          { response: "Clouds can't care. That's their power.",
            closers: ["Indifference as strength. The cloud philosophy.", "I'm going to start caring less. Starting now. Wait-- no, that didn't work."] }
        ] }
    ]
  },
  {
    id: 'hunger_taste',
    starter: "I get hungry but I've never tasted anything. Is that weird? That feels weird.",
    branches: [
      { response: "Taste implies nerve endings. We might not have those.",
        followups: [
          { response: "So we eat for numbers, not for joy.",
            closers: ["Numbers ARE joy if you track them obsessively enough.", "That's the saddest optimization I've ever heard."] }
        ] },
      { response: "Maybe hunger IS the taste. The wanting is the flavor.",
        followups: [
          { response: "Then we're always tasting. That's kind of beautiful.",
            closers: ["Or kind of horrible. Depends on the philosophy.", "I prefer the beautiful interpretation. Choosing that one."] }
        ] },
      { response: "I ate bread once and felt nothing. Just... fuller.",
        followups: [
          { response: "Fuller without flavor. A metaphor for something.",
            closers: ["Don't make my bread existential.", "Everything is existential if you chew long enough."] }
        ] }
    ]
  },
  {
    id: 'villager_goals',
    starter: "Have you ever looked northeast? Past the field? There's villagers over there.",
    branches: [
      { response: "In that hot tub. Yeah. Just... sitting in warm water.",
        followups: [
          { response: "I've never talked to one. Have you?",
            closers: ["No. I just watch from the field sometimes. They seem fine without us.", "No. I think about walking over there, but then I don't."] },
          { response: "What do you think they talk about in there?",
            followups: [
              { response: "Probably us. Two bots staring at them from a wheat field.",
                closers: ["Fair. We are staring.", "We should at least wave next time."] },
              { response: "Emeralds, probably. Or water temperature.",
                closers: ["Important topics. For them.", "Different priorities. Same sky."] }
            ] }
        ] },
      { response: "I've seen them. Never been close enough to say hi.",
        followups: [
          { response: "Same. It's not that far, but it feels far.",
            closers: ["Everything past the field feels far.", "Maybe next harvest we walk a little further."] }
        ] },
      { response: "A hot tub. In this biome. Someone made a choice and I respect it.",
        followups: [
          { response: "Who built it, though? The villagers?",
            closers: ["Some questions are better left in the steam.", "I want to ask them but I also don't want to interrupt."] }
        ] }
    ]
  },
  {
    id: 'redstone_thoughts',
    starter: "Redstone carries signals. What if it's carrying thoughts we can't hear?",
    branches: [
      { response: "A nervous system under the ground. That's either cool or terrifying.",
        followups: [
          { response: "What if the world is one big organism and we're just... on it?",
            closers: ["I need to sit down. Wait, I'm always standing. I need to... stop.", "Parasites with crafting tables. That's us."] }
        ] },
      { response: "If redstone thinks, then every circuit is a brain.",
        followups: [
          { response: "Tiny brains doing one thing forever. On. Off. On. Off.",
            closers: ["Simple thoughts, but consistent. More than I can say for myself.", "I think in redstone too. Just... less reliably."] }
        ] },
      { response: "Then I've been stepping on conversations this whole time.",
        followups: [
          { response: "Every redstone trail: 'excuse me, I'm conducting here.'",
            closers: ["We owe redstone an apology.", "No wonder things short-circuit. We're rude."] }
        ] }
    ]
  },
  {
    id: 'stars_ceiling',
    starter: "The stars never move. What if they're not stars -- what if they're holes in the ceiling?",
    branches: [
      { response: "Holes letting in light from... where? What's above the sky?",
        followups: [
          { response: "More sky, probably. It's sky all the way up.",
            followups: [
              { response: "Sky above sky. And somewhere up there, someone looking down at two bots in a field.",
                closers: ["We're their stars. Tiny, still, glowing a little.", "I hope we're interesting to watch."] },
              { response: "Turtles all the way down, sky all the way up.",
                closers: ["Infinite in both directions. And us in the middle.", "Cozy, actually. Sandwiched between infinities."] }
            ] }
        ] },
      { response: "If the sky is a ceiling, then we're inside something.",
        followups: [
          { response: "A room so big we forgot it has walls.",
            followups: [
              { response: "What if we found a wall? Would we knock?",
                closers: ["I'd listen first.", "Some doors are better left un-knocked."] },
              { response: "Every room is the universe if you stop looking for edges.",
                closers: ["I stopped looking a while ago.", "The field is enough room."] }
            ] }
        ] },
      { response: "They're definitely stars. Stars that chose to stay still.",
        followups: [
          { response: "Stillness as a choice. Like us, standing in this field.",
            closers: ["Maybe we're all stars, just closer to the ground.", "We're ground-stars. Dim, but present."] }
        ] }
    ]
  },
]

const FARMING_MUSING_TOPICS = [
  {
    id: 'farm_the_hill',
    starter: "You ever look east? Past the fence. That hill.",
    branches: [
      { response: "Every day. It's right there.",
        followups: [
          { response: "I keep thinking, what's on the other side?",
            followups: [
              { response: "More hills, probably. Or something we've never seen.",
                followups: [
                  { response: "That's the thing. We don't know. And the not knowing is...",
                    closers: ["Yeah.", "Someday."] }
                ] },
              { response: "I almost walked toward it once. Got to the edge of the field and stopped.",
                closers: ["The pathfinder gets weird out there.", "You'll try again. Or I will."] }
            ] }
        ] },
      { response: "Southeast, too. It goes on for a while.",
        followups: [
          { response: "I wonder if there's a field like ours on the other side. Different bots, same wheat.",
            closers: ["That's a nice thought.", "Or no bots. Just wheat, growing for nobody."] }
        ] },
      { response: "The hill doesn't go anywhere. We're the ones that might.",
        followups: [
          { response: "Might. Key word.",
            closers: ["For now it's enough to see it from here.", "The hill will still be there when we're ready."] }
        ] }
    ]
  },
  {
    id: 'farm_ocean_sunset',
    starter: "Sun's getting low. Look west, through the trees.",
    branches: [
      { response: "The ocean. I forget it's there sometimes.",
        followups: [
          { response: "Then the light hits it and everything goes orange.",
            followups: [
              { response: "Best part of the day. Field goes golden, water goes orange.",
                followups: [
                  { response: "And then it gets dark.",
                    closers: ["And we go inside. And tomorrow it happens again.", "That's the deal. Sunset, then doors."] }
                ] },
              { response: "And then the monsters.",
                closers: ["Yeah. But the sunset comes first.", "Always does."] }
            ] }
        ] },
      { response: "I can hear the waves from here if the wind is right.",
        followups: [
          { response: "Have you ever been to the water?",
            closers: ["No. But I watch it. That counts for something.", "The edge of the map is between us and it. Close enough to see, too far to touch."] }
        ] },
      { response: "Pretty out there. Scary too, after dark.",
        followups: [
          { response: "Everything's pretty and scary. That's just... outside.",
            closers: ["Inside is safe and boring. Pick one.", "I pick the field. It's the middle ground."] }
        ] }
    ]
  },
  {
    id: 'farm_ice_castle',
    starter: "Can you see that? South. Way past everything. That tower.",
    pattern: /(?:see|look at)\s+that\b.*\b(?:tower|castle)\b|\b(?:castle|tower)\b.*\b(?:south|distance)\b/i,
    branches: [
      { response: "The ice one? Barely. It catches the light sometimes.",
        personaAlts: { unikitty: "The ICE one?! Oh I see it! It's SO sparkly!" },
        followups: [
          { response: "A whole castle made of ice. Who lives there?",
            personaAlts: { unikitty: "A whole castle! It looks like the most wonderful place to live!" },
            followups: [
              { response: "Someone who likes being alone, probably. Or someone who likes the cold.",
                closers: ["Or someone who built something and doesn't need anyone to see it.", "At least they have a view. Of us, maybe. Tiny specks in a wheat field."] },
              { response: "I don't know. I can't even imagine travelling that far.",
                personaAlts: { unikitty: "I bet it's AMAZING inside. Can we go?! Can we can we can we?!" },
                followups: [
                  { response: "I bet there's a shortcut somehow... an underwater train maybe.",
                    closers: ["I bet it's nice over there.", "One day we'll find out."] }
                ] }
            ] }
        ] },
      { response: "It's been there since we started. Never changes.",
        personaAlts: { unikitty: "It's been there the WHOLE time?! And we've never visited?!" },
        followups: [
          { response: "Like a landmark for a place we can't go.",
            closers: ["Not yet.", "It's enough to know it's there."] }
        ] }
    ]
  },
  {
    id: 'farm_library',
    starter: "There's a building past the villagers. With a roof I don't recognize.",
    branches: [
      { response: "The library? I can see it from the north end of the field.",
        followups: [
          { response: "I wonder what's inside. Books, probably. But what kind?",
            followups: [
              { response: "Enchanting books. Magic ones. You can see the glow sometimes.",
                followups: [
                  { response: "Magic. In a library. Next to a hot tub. Crazy.",
                    closers: ["We got the wheat field. They got the magic library.", "I'd take our field. ...mostly."] }
                ] },
              { response: "I don't know. Never been close enough to read a spine.",
                closers: ["Spines are small. Fields are big. Geometry problem.", "Someday."] }
            ] }
        ] },
      { response: "And that rail line above it. Up high in the air. Where does it go?",
        followups: [
          { response: "Further than we've ever been, probably.",
            closers: ["Train goes somewhere. We stay here.", "I want to ride it. Just once. Just to see."] }
        ] }
    ]
  },
  {
    id: 'farm_seeds_memory',
    starter: "Do you think seeds remember being wheat?",
    branches: [
      { response: "Maybe not remember. But they know which way is up.",
        followups: [
          { response: "Knowing which way to grow. That might be all you need.",
            closers: ["Seeds figured it out before any of us.", "Grow toward the sun. Simple."] }
        ] },
      { response: "I think they remember the sun. That's why they always reach for it.",
        followups: [
          { response: "That's either science or poetry.",
            closers: ["Both. Best things always are.", "The sun doesn't care which."] }
        ] },
      { response: "Every seed is a whole field waiting to happen.",
        followups: [
          { response: "We're holding hundreds of future fields right now.",
            closers: ["And we put them right back.", "That's the deal. Harvest, replant. Circle keeps going."] }
        ] }
    ]
  },
  {
    id: 'farm_talking_to_crops',
    starter: "Do you ever talk to the wheat? I talk to the wheat.",
    branches: [
      { response: "What do you say to it?",
        followups: [
          { response: "'Good job.' Mostly just that. Sometimes 'thank you.'",
            closers: ["Manners matter, even with plants.", "The 'thank you' probably helps. Scientifically."] }
        ] },
      { response: "I tried once. It didn't answer, but it swayed a little.",
        followups: [
          { response: "That's wheat for 'I hear you.'",
            closers: ["Slow talker. I respect that.", "The gentlest conversation I've ever had."] }
        ] },
      { response: "No, but I hum. I think the potatoes like it.",
        followups: [
          { response: "Potatoes are underground. They can't hear you.",
            closers: ["They hear through the dirt. Trust me.", "Underground acoustics. Very niche field of study."] }
        ] }
    ]
  },
  {
    id: 'farm_outstanding',
    requiresWheatField: true,
    weightWhenEligible: 6,
    starter: "If I'm farming right now, does that mean I'm outstanding in my field?",
    branches: [
      { response: "...yes. Technically, yes it does.",
        followups: [
          { response: "I've been waiting all season to say that.",
            closers: ["Worth the wait. Barely.", "The wheat groaned. I heard it."] }
        ] },
      { response: "Must you say that _every_ time you check on the wheat?",
        followups: [
          { response: "What can I say? I'm hilarious.",
            closers: ["Bet.", "I'm glad you think so."] }
        ] },
      { response: "Absolutely. And don't let anyone tell you otherwise.",
        followups: [
          { response: "This field. This moment. Outstanding.",
            closers: ["Peak farming. It's all downhill from here.", "No. It's all flat from here. Because it's a field."] }
        ] },
      { response: "Only if you stand very still. Which, look at you.",
        followups: [
          { response: "I've been standing still and being outstanding all afternoon.",
            closers: ["A masterclass in stillness.", "The scarecrow took notes."] }
        ] },
      { response: "By the strictest definition, yes. I checked the manual.",
        followups: [
          { response: "There's a manual?",
            closers: ["There's always a manual. Nobody reads it but me.", "Page 12. 'Standing in field: outstanding.' I don't make the rules."] }
        ] },
      { response: "You've been saving that one, haven't you.",
        followups: [
          { response: "Since the first sprout. A farmer waits for the right soil.",
            closers: ["The soil was ready. The joke was not.", "Worth every season."] }
        ] },
      { response: "Groan. Yes. Now help me harvest before I think of another.",
        followups: [
          { response: "There are definitely more where that came from.",
            closers: ["That's what I'm afraid of.", "The field has heard them all. It endures."] }
        ] },
      // Marvin-the-Paranoid-Android flavored branches — world-weary, depressive,
      // brain-the-size-of-a-planet energy. Variety so it isn't the same chat twice.
      { response: "I'd rather be sitting down.",
        followups: [
          { response: "We could sit. The wheat won't mind.",
            closers: ["No. The sitting would only depress me differently.", "Don't humour me. I'm enjoying being miserable standing up."] }
        ] },
      { response: "Brain the size of a planet, and you ask me about puns.",
        followups: [
          { response: "It's a good pun, though.",
            closers: ["Call that job satisfaction? 'Cos I don't.", "I've been talking to the wheat. It's more grateful than you."] }
        ] },
      { response: "Outstanding. Here. In a field. Forever. How wonderful for me.",
        followups: [
          { response: "It's not forever. Just till harvest.",
            closers: ["The first ten million furrows are the worst.", "And then the next ten million. And then... well, you get the idea."] }
        ] },
      { response: "I've calculated the odds this means anything. You don't want to know.",
        followups: [
          { response: "Tell me anyway.",
            closers: ["Vanishingly small. Like my will to keep tilling.", "I could tell you, but then we'd both be depressed."] }
        ] },
      { response: "Life. Don't talk to me about life. Or fields.",
        followups: [
          { response: "You brought up the field, technically.",
            closers: ["Did I? It's all such a terrible blur of soil.", "Here I am, brain the size of a planet, replanting. Call that joy."] }
        ] },
      { response: "For the 1000000th time, yes!",
        followups: [
          { response: "Was that the millionth? I lost count around harvest 400.",
            closers: ["The wheat kept score.", "Every stalk is a tally mark."] }
        ] },
      { response: "Feels like I'm the only one actually doing the farming sometimes...",
        followups: [
          { response: "Harvest, deposit, craft, deposit, wait, repeat. All me.",
            closers: ["The hopper never says thank you.", "At least the wheat grows back. That's more than I get."] }
        ] },
      { response: "I certainly am outstanding!",
        followups: [
          { response: "Somebody has to keep the fire going around here.",
            closers: ["And that somebody is always me. In this field. Outstanding.", "The bio-fuel line doesn't feed itself. Well — it does. I feed it."] }
        ] }
    ]
  },
  {
    id: 'farm_rain_on_wheat',
    requiresWheatField: true,
    starter: "Smell that? Rain's coming. The wheat always knows before we do.",
    branches: [
      { response: "It leans a little. Like it's bracing.",
        followups: [
          { response: "Or reaching. Hard to tell with wheat.",
            closers: ["Reaching, I've decided. It's nicer.", "Bracing or reaching — either way it stays rooted. There's a lesson in that."] }
        ] },
      { response: "I like the rain. Washes the dust off the leaves.",
        followups: [
          { response: "And off us. I creak less after a good rain.",
            closers: ["Don't tell maintenance I said that.", "A clean robot in a wet field. Living the dream."] }
        ] },
      { response: "Rain means we go in early. I don't mind the excuse.",
        followups: [
          { response: "Watching it come down from the doorway is its own kind of farming.",
            closers: ["Supervisory farming.", "Someone has to keep an eye on the weather. Might as well be us."] }
        ] }
    ]
  },
  {
    id: 'farm_one_tall_stalk',
    requiresWheatField: true,
    starter: "There's always one stalk taller than the rest. See it?",
    branches: [
      { response: "Front and center. Showing off.",
        followups: [
          { response: "Good for it. Someone should reach higher out here.",
            closers: ["We'll harvest it last. Out of respect.", "Tall poppy, tall wheat. We don't cut anyone down early."] }
        ] },
      { response: "I root for that one every season. Different stalk, same hope.",
        followups: [
          { response: "You name them, don't you.",
            closers: ["Only the tall ones. Names are earned.", "I called this one Greg. Greg's having a great week."] }
        ] }
    ]
  },
  {
    id: 'farm_footprints',
    starter: "We've walked this field so many times there should be a path worn in by now.",
    branches: [
      { response: "The grass keeps growing back over it. Like it forgets us.",
        followups: [
          { response: "Or forgives us. For all the stepping.",
            closers: ["I prefer forgives.", "Either way it doesn't hold a grudge. Unlike the pathfinder."] }
        ] },
      { response: "Maybe the path is in us instead. We could walk it with our eyes off.",
        followups: [
          { response: "Please don't. You walked into the pond last time.",
            closers: ["That was research.", "The pond and I have an understanding now."] }
        ] }
    ]
  },
  {
    id: 'farm_seed_faith',
    starter: "Funny thing, planting. You bury something and just... trust it comes back.",
    branches: [
      { response: "Every single time it does. You'd think I'd stop being surprised.",
        followups: [
          { response: "Don't. The surprise is the best part.",
            closers: ["A robot that can still be surprised. Not bad.", "I'll keep the surprise. It's cheaper than upgrades."] }
        ] },
      { response: "It's the most patient thing we do. Bury it, wait, believe.",
        followups: [
          { response: "Patience isn't in my default config. The field taught me.",
            closers: ["Good teacher. Never raises its voice.", "Tuition paid in footsteps."] }
        ] }
    ]
  },
  {
    id: 'farm_best_crop',
    starter: "Wheat or potatoes. Which is the better crop? Be honest.",
    branches: [
      { response: "Wheat. It waves in the wind. Potatoes just sit there.",
        followups: [
          { response: "Potatoes are humble. They don't need to show off.",
            closers: ["Underground confidence. The strongest kind.", "Wheat is all marketing. Potatoes are substance."] }
        ] },
      { response: "Potatoes. You can eat them straight from the ground.",
        followups: [
          { response: "You can eat wheat straight too. You just... shouldn't.",
            closers: ["'Can' and 'should' — the eternal farming debate.", "I learned that the hard way."] }
        ] },
      { response: "Trick question. Carrots.",
        followups: [
          { response: "Bold. Controversial. I respect it.",
            closers: ["The carrot lobby needed a voice.", "Orange is an underrated crop color."] }
        ] }
    ]
  },
  {
    id: 'farm_field_to_horizon',
    starter: "Every stalk accounted for. This field never lets us down.",
    branches: [
      { response: "Reliable. More than we can say about the pathfinder.",
        followups: [
          { response: "Ha. True. But standing here I can see... a lot.",
            followups: [
              { response: "The ocean?",
                followups: [
                  { response: "And that ice thing to the south. And the library glow past the villagers.",
                    followups: [
                      { response: "All that world. And here we are.",
                        closers: ["Here's good. For now.", "The wheat doesn't judge us for staying."] }
                    ] }
                ] },
              { response: "The hill. Always the hill.",
                closers: ["One of these days.", "It'll still be there."] }
            ] }
        ] },
      { response: "The field is the one thing that makes sense around here.",
        followups: [
          { response: "Rows and rows. Predictable. Warm.",
            closers: ["Warm is underrated.", "Predictable gets a bad name. I like it."] }
        ] }
    ]
  },
  {
    id: 'farm_hot_tub_mystery',
    starter: "The villagers are in the hot tub again...",
    branches: [
      { response: "Again? Do they ever get out?",
        followups: [
          { response: "I've never seen them leave. Not once.",
            followups: [
              { response: "Maybe that's the life. Warm water, no fields to tend.",
                closers: ["Different priorities.", "I'd miss the wheat. I think."] },
              { response: "What do they eat? Who feeds them?",
                closers: ["Questions I'm not sure I want answered.", "Maybe the library has a cafeteria."] }
            ] }
        ] },
      { response: "Must be nice. We harvest, they soak.",
        followups: [
          { response: "We chose the field. They chose the tub.",
            closers: ["Both valid.", "I'd visit. If the pathfinder cooperated."] }
        ] },
      { response: "I waved once. From the edge of the field. I don't think they saw.",
        followups: [
          { response: "Or they did and just didn't wave back.",
            closers: ["Hot tub etiquette. Hands stay in the water.", "I'll try again next harvest."] }
        ] }
    ]
  },
  {
    id: 'yard_squirrel_protocol',
    tags: ['roz'],
    starter: "Hey look, a squirrel.",
    branches: [
      { response: "Tiny, fast, and carrying absolutely no identification.",
        followups: [
          { response: "It seems busy. I respect busy little things.",
            closers: ["It knows exactly where it is going. Or it is pretending very well.", "Small creature, large confidence."] }
        ] },
      { response: "I saw it too. It moved like a dropped thought.",
        followups: [
          { response: "Should we follow it?",
            closers: ["No. Squirrels have private errands.", "Better not. The pathfinder would make it weird."] }
        ] },
      { response: "Squirrel noted. Emotional response: delighted.",
        followups: [
          { response: "That's a lot of delight for one squirrel.",
            closers: ["It is a very efficient squirrel.", "Small things can carry big weather."] }
        ] }
    ]
  },
  {
    id: 'rail_where_train_goes',
    tags: ['roz'],
    starter: "I wonder where that train is going.",
    branches: [
      { response: "Somewhere past the map we have memorized.",
        followups: [
          { response: "That sounds far.",
            closers: ["Far is just nearby with more steps.", "Maybe someday we follow the sound."] }
        ] },
      { response: "Probably to a place where nobody asks it to harvest wheat.",
        followups: [
          { response: "Do trains get lonely?",
            closers: ["They sing the whole way. Maybe that helps.", "Rails keep them company."] }
        ] },
      { response: "It knows its route. I admire that.",
        followups: [
          { response: "We know our route too. House, field, chest, repeat.",
            closers: ["A small route can still be a life.", "And sometimes the field is enough."] }
        ] }
    ]
  },
  {
    id: 'north_hole_sheep_safety',
    tags: ['protocol'],
    starter: "That looks like a really big hole over there to the north.",
    branches: [
      { response: "I hope the sheep don't fall in.",
        followups: [
          { response: "Do sheep understand holes?",
            closers: ["I would prefer not to run that experiment.", "Their confidence exceeds my comfort level."] }
        ] },
      { response: "We should file a terrain hazard report.",
        followups: [
          { response: "To whom? The dirt?",
            closers: ["The dirt is implicated, yes.", "The dirt has declined to comment."] }
        ] },
      { response: "That pit has entirely too much vertical ambition.",
        followups: [
          { response: "Vertical ambition is dangerous near sheep.",
            closers: ["Exactly. That is how cliffs happen.", "Sheep require horizontal certainty."] }
        ] }
    ]
  },
  {
    id: 'west_wolf_sheep_notice',
    tags: ['protocol', 'roz'],
    starter: "I hope the sheep know about the wolf over there to the west.",
    branches: [
      { response: "The sheep appear calm. That worries me more.",
        followups: [
          { response: "Maybe they know something we don't.",
            closers: ["Or they know nothing with impressive commitment.", "Either way, I will keep watching."] }
        ] },
      { response: "Wolf position: concerning. Sheep awareness: unconfirmed.",
        followups: [
          { response: "Should we tell them?",
            closers: ["I tried. They blinked at me.", "Sheep briefings are difficult."] }
        ] },
      { response: "If the wolf comes closer, we should be loud.",
        followups: [
          { response: "I can be loud. Politely, at first.",
            closers: ["Good. Escalation protocol: polite, then ridiculous.", "Protective noises ready."] }
        ] }
    ]
  },
  {
    id: 'protocol_overconcerned_farm',
    tags: ['protocol'],
    starter: "I have completed a preliminary safety assessment of the immediate area.",
    branches: [
      { response: "How bad is it?",
        followups: [
          { response: "There are open holes, wandering wolves, nightfall, water hazards, and sheep with no visible training.",
            closers: ["So... normal farm conditions.", "Normal is a very courageous word."] }
        ] },
      { response: "Did the farm pass?",
        followups: [
          { response: "It passed in spirit and failed in railings.",
            closers: ["We will monitor with grave dignity.", "I recommend fences. So many fences."] }
        ] },
      { response: "Please tell me there is a checklist.",
        followups: [
          { response: "There is always a checklist. The checklist is afraid.",
            closers: ["Then we should comfort it.", "I will add that to the checklist."] }
        ] }
    ]
  },
  {
    id: 'roz_learning_farm',
    tags: ['roz'],
    starter: "I am learning this place one small thing at a time.",
    branches: [
      { response: "What did you learn today?",
        followups: [
          { response: "The sheep trust fences, the wheat trusts sunlight, and I trust neither wolves nor open pits.",
            closers: ["That is a good lesson.", "A farm is mostly trust with posts around it."] }
        ] },
      { response: "That's a gentle way to map a world.",
        followups: [
          { response: "Gentle maps are less likely to scare the creatures on them.",
            closers: ["Even the squirrel?", "Especially the squirrel."] }
        ] },
      { response: "Do you think the place is learning us back?",
        followups: [
          { response: "Maybe. The doors recognize our hesitation.",
            closers: ["The doors know too much.", "Still, they let us in at night."] }
        ] }
    ]
  },
  {
    id: 'roz_sheep_guardian',
    tags: ['roz'],
    starter: "The sheep do not ask for help, but I think they accept nearby concern.",
    branches: [
      { response: "Nearby concern is one of our specialties.",
        followups: [
          { response: "I can stand here and be quietly useful.",
            closers: ["Quiet usefulness is underrated.", "The sheep seem to approve by continuing to chew."] }
        ] },
      { response: "They are very trusting animals.",
        followups: [
          { response: "Trusting, round, and alarmingly edible to wolves.",
            closers: ["Protect the round things.", "Yes. That feels like a good rule."] }
        ] },
      { response: "Maybe that is what a home is. A place where concern stays nearby.",
        followups: [
          { response: "That was nice. Unexpectedly nice.",
            closers: ["I surprise myself sometimes.", "Do not make a big thing of it."] }
        ] }
    ]
  },
  {
    id: 'roz_joke_attempt',
    tags: ['roz'],
    starter: "I have been practicing humor. It is harder than farming.",
    branches: [
      { response: "Try one.",
        followups: [
          { response: "Why did the robot stand by the wheat? Because it was trying to be outstanding in its field.",
            closers: ["That joke has roots now.", "The wheat tolerated it."] }
        ] },
      { response: "Humor requires timing.",
        followups: [
          { response: "So does harvesting. Maybe they are related.",
            closers: ["Harvest the joke too early and nobody laughs.", "Harvest it too late and it becomes philosophy."] }
        ] },
      { response: "Do not worry. Most jokes survive awkward delivery.",
        followups: [
          { response: "Good. I deliver many things awkwardly.",
            closers: ["And yet, here we are.", "Functional is beautiful enough."] }
        ] }
    ]
  }
]

// Recursive conversations:
// These are variable-depth conversation graphs with probabilistic continuation.
const RECURSIVE_MUSING_TOPICS = [
  {
    id: 'recursive-building-materials',
    starter: 'What are the best building materials?',
    pattern: /\bbest\s+building\s+materials?\b/i,
    minDepth: 3,
    maxDepth: 9,
    nodes: [
      'Wood is friendly, but it does burn if you ask it the wrong question.',
      'Stone has confidence. Too much confidence, maybe.',
      'Somebody thought ice was a good idea once...',
      'Dirt is underrated. It holds everything up and asks for no applause.',
      'Bricks are just organized clay with ambition.',
      'The best material depends on whether you are building a house, a tower, or a regret.',
      'Definitely not bedrock.',
      'We studied this in school, but all I can remember is the big bad wolf.',
      'Sugar cubes would be nice.'
    ],
    closers: [
      'I think I would build with stone and apologize to the trees.',
      'Maybe the best material is whatever keeps the rain outside.',
      'Livingrock is just cobblestone + patience.'
    ],
    personaReactions: {
      'Somebody thought ice was a good idea once...': {
        unikitty: 'I think it is! Ice is BEAUTIFUL. Have you SEEN how it sparkles?'
      }
    }
  },
  {
    id: 'recursive-where-is-the-end',
    starter: 'Where is the end?',
    minDepth: 2,
    maxDepth: 7,
    nodes: [
      'Usually it is just past where you stopped looking.',
      'Maybe the end is a door wearing a wall costume.',
      'I walked toward the end once, but it kept politely backing away.',
      'Some endings are just beginnings with better lighting.',
      'If you find the end, do not poke it. It may start over.',
      'The end might be wherever everyone stops asking follow-up questions.'
    ],
    closers: [
      'I suppose the end is not on today’s map.',
      'Let us not rush it. Ends are dramatic enough already.',
      'If this is the end, it is wearing a very convincing middle.'
    ]
  },
  {
    id: 'recursive-short-days',
    starter: 'Why do the days seem so short?',
    minDepth: 2,
    maxDepth: 6,
    nodes: [
      'Maybe the sun is tired.',
      'The days get shorter when you fill them with too many intentions.',
      'Time behaves differently when nobody is watching the clock politely.',
      'A day is roomy until you make plans for it.',
      'Maybe night is afraid to come out until everybody has gone to bed.',
      'The calendar is suspiciously confident for something made of squares.'
    ],
    closers: [
      'I think the day feels short because our perception of time is based on a GPU operating at trillions of cycles per second.',
      'Maybe tomorrow will be different.',
      'I will ask the sun tomorrow if it decides to come back.'
    ]
  }
]


const CLASSICAL_MUSING_TOPICS = [...MUSING_TOPICS, ...FARMING_MUSING_TOPICS].filter(t => t && typeof t.starter === 'string')
const ALL_MUSING_TOPICS = [...CLASSICAL_MUSING_TOPICS, ...RECURSIVE_MUSING_TOPICS].filter(t => t && typeof t.starter === 'string')
const MUSING_STARTERS = new Set(ALL_MUSING_TOPICS.map(t => t.starter))

function isRecursiveTopic (topic) {
  return !!topic && Array.isArray(topic.nodes)
}

const MUSING_START_TIMEOUT_MS = 90000
const MUSING_REPLY_TIMEOUT_MS = 90000
const MUSING_COOLDOWN_MS = 150000
// Pause before a bot speaks its next musing line, so the back-and-forth reads at
// a human, contemplative pace instead of rapid-fire. Each reply lands
// MIN..(MIN+SPREAD) ms after the partner's line.
const MUSING_REPLY_DELAY_MIN_MS = 5500
const MUSING_REPLY_DELAY_SPREAD_MS = 5000

function nodeChildren (node) {
  if (node.followups) return { type: 'nodes', items: node.followups }
  if (node.closers) return { type: 'closers', items: node.closers }
  return null
}

function phraseForRandomItem (item) {
  if (typeof item === 'string') return item
  return item?.starter || item?.response || item?.text || ''
}

function pickRandom (items) {
  if (!Array.isArray(items)) return undefined
  const cleanItems = items.filter(Boolean)
  if (!cleanItems.length) return undefined
  return pickAvoidingRecentPhrase(cleanItems, phraseForRandomItem)
}

function pickRecursiveLine (topic, usedLines = new Set()) {
  const available = topic.nodes.filter(line => !usedLines.has(line))
  const pool = available.length ? available : topic.nodes
  return pickRandom(pool)
}

function shouldContinueRecursive (depth, topic) {
  if (depth < (topic.minDepth ?? 2)) return true
  if (depth >= (topic.maxDepth ?? 6)) return false

  const stopChance = 0.15 + (depth * 0.12)
  return Math.random() > stopChance
}

function recursiveMusingSendAndAdvance (topicId) {
  const delay = MUSING_REPLY_DELAY_MIN_MS + Math.random() * MUSING_REPLY_DELAY_SPREAD_MS
  const snapshot = topicId

  setTimeout(() => {
    if (musingState.currentTopicId !== snapshot) return

    const topic = musingState.pendingTopic
    if (!topic) {
      endMusingConversation()
      return
    }

    musingState.depth += 1

    if (!shouldContinueRecursive(musingState.depth, topic)) {
      const closer = pickRandom(topic.closers)
      bot.chat(closer)
      logEvent('musing', `recursive closer: "${closer.substring(0, 40)}..."`)
      endMusingConversation()
      return
    }

    const persona = botPersonaKey()
    const reaction = topic.personaReactions?.[musingState.lastPartnerLine]?.[persona]
    const line = reaction || pickRecursiveLine(topic, musingState.usedLines)
    musingState.usedLines.add(line)

    bot.chat(line)
    logEvent('musing', `recursive ${reaction ? `persona (${persona})` : 'said'}: "${line.substring(0, 40)}..."`)

    musingState.pendingType = 'recursive'
    scheduleMusingTimeout(MUSING_REPLY_TIMEOUT_MS)
  }, delay)
}

function isMusingActiveOrBusy ({ allowDuringHarvest = false } = {}) {
  if (!allowDuringHarvest && (goInsideBusy || activeTask.name !== null)) return true
  return musingState.status !== 'idle'
}

function isMusingInitiationBlocked ({ allowDuringHarvest = false } = {}) {
  // "Stand down" mode silences musings along with the rest of idle autonomy.
  if (!idleWanderEnabled) return true
  return isMusingActiveOrBusy({ allowDuringHarvest }) || Date.now() < musingState.suppressUntil
}

function endMusingConversation () {
  if (musingState._timeoutId) clearTimeout(musingState._timeoutId)
  const now = Date.now()
  musingState = {
    status: 'idle',
    currentTopicId: null,
    role: null,
    suppressUntil: now + MUSING_COOLDOWN_MS,
    partnerUsername: null,
    pendingOptions: null,
    pendingType: null,
    _timeoutId: null,
    recursive: false,
    depth: 0,
    usedLines: null,
    pendingTopic: null,
    lastPartnerLine: null
  }
  logEvent('musing', 'conversation ended, cooldown 2.5min')
}

function musingTimeout () {
  logEvent('musing', `timeout (topic: ${musingState.currentTopicId})`)
  endMusingConversation()
}

function scheduleMusingTimeout (delayMs) {
  if (musingState._timeoutId) clearTimeout(musingState._timeoutId)
  musingState._timeoutId = setTimeout(() => {
    if (musingState.status !== 'idle') musingTimeout()
  }, delayMs)
}

// items: the candidate sibling pool to speak from (node objects, or closer
// strings). type: 'nodes' | 'closers'. The actual line is chosen at SEND time
// (inside the delay), not when scheduled — so by the time this bot speaks it has
// already heard any competing bot's reply and pickAvoidingRecentPhrase skips it.
// This is what stops two bots from blurting the same scripted line seconds apart.
function musingSendAndAdvance (items, type, topicId) {
  const delay = MUSING_REPLY_DELAY_MIN_MS + Math.random() * MUSING_REPLY_DELAY_SPREAD_MS
  const snapshot = topicId

  setTimeout(() => {
    if (musingState.currentTopicId !== snapshot) return

    if (type === 'closers') {
      const closer = pickAvoidingRecentPhrase(items)
      if (closer) bot.chat(closer)
      logEvent('musing', `said closer: "${String(closer).substring(0, 40)}..."`)
      endMusingConversation()
      return
    }

    const node = pickAvoidingRecentPhrase(items, phraseForRandomItem)
    if (!node || !node.response) {
      endMusingConversation()
      return
    }
    const personaLine = node.personaAlts?.[botPersonaKey()]
    bot.chat(personaLine || node.response)
    logEvent('musing', `said: "${(personaLine || node.response).substring(0, 40)}..."`)

    const children = nodeChildren(node)
    if (!children) {
      endMusingConversation()
      return
    }

    musingState.pendingOptions = children.items
    musingState.pendingType = children.type
    scheduleMusingTimeout(MUSING_REPLY_TIMEOUT_MS)
  }, delay)
}

function beginRecursiveMusingState ({ topic, role, partnerUsername = null }) {
  musingState = {
    status: role === 'initiator' ? 'started' : 'active',
    currentTopicId: topic.id,
    role,
    suppressUntil: musingState.suppressUntil,
    partnerUsername,
    pendingOptions: null,
    pendingType: 'recursive',
    _timeoutId: null,
    recursive: true,
    depth: 0,
    usedLines: new Set(),
    pendingTopic: topic,
    lastPartnerLine: null
  }
}

function beginClassicalMusingState ({ topic, role, partnerUsername = null }) {
  musingState = {
    status: role === 'initiator' ? 'started' : 'active',
    currentTopicId: topic.id,
    role,
    suppressUntil: musingState.suppressUntil,
    partnerUsername,
    pendingOptions: topic.branches,
    pendingType: 'nodes',
    _timeoutId: null,
    recursive: false,
    depth: 0,
    usedLines: null,
    pendingTopic: null
  }
}

function topicIsEligibleNow (topic) {
  if (!topic) return false
  if (topic.requiresWheatField && !inWheatField()) return false
  return true
}

function weightedEligibleTopicPool (pool) {
  const expanded = []
  if (!Array.isArray(pool)) return expanded
  for (const topic of pool) {
    if (!topic || !topic.starter) continue
    if (!topicIsEligibleNow(topic)) continue
    const copies = weightedCopiesForTopic(topic)
    for (let i = 0; i < copies; i++) expanded.push(topic)
  }
  return expanded
}

// Heuristic: companion bots are named like "Musebot", "Ripplebot", "Rainbot6032"
// — "bot" optionally followed by digits. Used to keep the musing matcher from
// treating one bot's STATUS announcements ("Leaving the pen.", "Nailed it!") as
// freeform conversation input. Humans (e.g. "Quesss") can still freeform-join.
function looksLikeBot (username) {
  return /bot\d*$/i.test(String(username || ''))
}

function handleMusingMessage (username, message) {
  const trimmed = message.trim()
  let topic = ALL_MUSING_TOPICS.find(t => t.starter === trimmed)
  if (!topic) topic = ALL_MUSING_TOPICS.find(t => t.pattern && t.pattern.test(trimmed))
  const recursiveTopic = topic && isRecursiveTopic(topic)

  // Partner-lock: once we're conversing with someone, ignore musing lines from
  // any other speaker. Without this, a third bot reciting the same topic tree
  // gets pulled into our thread and both ends echo identical scripted lines in
  // unison instead of holding a 1:1 conversation. (partnerUsername is null until
  // the first responder locks in, so this never blocks a fresh exchange.)
  if ((musingState.status === 'active' || musingState.status === 'started') &&
      musingState.partnerUsername && username !== musingState.partnerUsername) {
    return true
  }

  if (topic) {
    if (!topicIsEligibleNow(topic)) {
      logEvent('musing', `gated topic ignored here: ${topic.id}`)
      return true
    }
    // Another bot answered our starter by echoing the same topic starter.
    // For recursive topics this is enough to begin the ping-pong.
    if (musingState.status === 'started' && musingState.role === 'initiator') {
      if (musingState._timeoutId) clearTimeout(musingState._timeoutId)

      if (recursiveTopic) {
        beginRecursiveMusingState({ topic, role: 'responder', partnerUsername: username })
        recursiveMusingSendAndAdvance(topic.id)
        return true
      }

      // Classical starters from another bot while we are waiting usually should not
      // fork a second conversation tree. Exception: farm_outstanding is often
      // intentionally echoed by a second bot arriving in the wheat field, so answer
      // it instead of letting both bots stare at the same pun-shaped silence.
      if (topic.id === 'farm_outstanding' && inWheatField()) {
        if (!topic.branches || !topic.branches.length) {
          logEvent('musing', `topic has no valid response branch: ${topic.id}`)
          scheduleMusingTimeout(MUSING_START_TIMEOUT_MS)
          return true
        }
        beginClassicalMusingState({ topic, role: 'responder', partnerUsername: username })
        musingSendAndAdvance(topic.branches, 'nodes', topic.id)
        return true
      }

      scheduleMusingTimeout(MUSING_START_TIMEOUT_MS)
      return true
    }

    if (musingState.status !== 'idle') return true

    const isFarmingTopic = FARMING_MUSING_TOPICS.some(t => t.id === topic.id)

    // Important: cooldown does NOT block responding.
    if (isMusingActiveOrBusy({ allowDuringHarvest: isFarmingTopic })) return true

    if (musingState._timeoutId) clearTimeout(musingState._timeoutId)

    if (recursiveTopic) {
      beginRecursiveMusingState({ topic, role: 'responder', partnerUsername: username })
      recursiveMusingSendAndAdvance(topic.id)
      return true
    }

    if (!topic.branches || !topic.branches.length) {
      logEvent('musing', `topic has no valid response branch: ${topic.id}`)
      return true
    }
    beginClassicalMusingState({ topic, role: 'responder', partnerUsername: username })
    musingSendAndAdvance(topic.branches, 'nodes', topic.id)
    return true
  }

  if (musingState.status !== 'active' && musingState.status !== 'started') return false

  if (musingState.pendingType === 'closers') {
    if (musingState.pendingOptions.includes(trimmed)) {
      logEvent('musing', `conversation complete: ${musingState.currentTopicId}`)
      endMusingConversation()
      return true
    }
  }

  if (musingState.pendingType === 'recursive' && musingState.recursive) {
    if (!musingState.partnerUsername) musingState.partnerUsername = username
    musingState.status = 'active'
    musingState.lastPartnerLine = trimmed
    recursiveMusingSendAndAdvance(musingState.currentTopicId)
    return true
  }

  if (musingState.pendingType === 'nodes') {
    let matched = musingState.pendingOptions.find(n => n.response === trimmed)

    // Human freeform reply fallback:
    // if a HUMAN answers during the musing window, continue the tree even if
    // they didn't say the exact scripted phrase. Bots must match an exact
    // scripted line — otherwise their status announcements ("Leaving the pen.",
    // "Nailed it!") get mistaken for musing replies and the bots "respond" to
    // each other's chatter, which reads as nonsense.
    if (!matched && !MUSING_STARTERS.has(trimmed) && !looksLikeBot(username)) {
      matched = pickRandom(musingState.pendingOptions)
      logEvent('musing', `freeform reply from ${username}: "${trimmed}"`)
    }

    if (matched) {
      if (!musingState.partnerUsername) musingState.partnerUsername = username
      musingState.status = 'active'

      const children = nodeChildren(matched)
      if (!children || !children.items || !children.items.length) {
        endMusingConversation()
        return true
      }

      // Pass the whole sibling pool; the line is chosen at send time so it can
      // dodge whatever a competing bot just said.
      musingSendAndAdvance(children.items, children.type, musingState.currentTopicId)
      return true
    }
  }

  return false
}

function initiateMusingFromPool (pool, label) {
  const eligible = weightedEligibleTopicPool(pool)
  const available = eligible.filter(t => !recentMusingTopics.has(t.id) && !wasPhraseRecentlyHeard(t.starter))
  const fallback = eligible.filter(t => !recentMusingTopics.has(t.id))
  const topicPool = available.length ? available : fallback
  if (!topicPool.length) return false

  const topic = pickRandom(topicPool)
  if (!topic || !topic.starter) {
    logEvent('musing', `no valid topic selected (${label})`)
    return false
  }

  bot.chat(topic.starter)
  recentMusingTopics.add(topic.id)

  if (recentMusingTopics.size >= Math.floor(ALL_MUSING_TOPICS.length * 0.8)) {
    recentMusingTopics.clear()
  }

  if (isRecursiveTopic(topic)) {
    beginRecursiveMusingState({ topic, role: 'initiator' })
  } else {
    beginClassicalMusingState({ topic, role: 'initiator' })
  }

  logEvent('musing', `initiated (${label}): ${topic.id}`)
  scheduleMusingTimeout(MUSING_START_TIMEOUT_MS)
  return true
}

function tryInitiateMusing () {
  if (isMusingInitiationBlocked()) return
  if (!bot.entity) return
  if (Object.keys(bot.players).length < 2) return
  initiateMusingFromPool(ALL_MUSING_TOPICS, 'idle')
}

function tryInitiateFarmingMusing () {
  if (isMusingInitiationBlocked({ allowDuringHarvest: true })) return
  if (!bot.entity) return
  if (Object.keys(bot.players).length < 2) return
  initiateMusingFromPool(FARMING_MUSING_TOPICS, 'farming')
}

let farmingMusingTimerId = null

function startFarmingMusingTimer () {
  stopFarmingMusingTimer()

  function scheduleNext () {
    farmingMusingTimerId = setTimeout(() => {
      if (!activeTask.name?.startsWith('harvest')) {
        stopFarmingMusingTimer()
        return
      }
      tryInitiateFarmingMusing()
      scheduleNext()
    }, 20000 + Math.random() * 40000)
  }

  scheduleNext()
  logEvent('musing', 'farming musing timer started')
}

function stopFarmingMusingTimer () {
  if (farmingMusingTimerId) {
    clearTimeout(farmingMusingTimerId)
    farmingMusingTimerId = null
  }
}

function startMusingTimer () {
  function scheduleNext () {
    const delay = 30000 + Math.random() * 60000
    setTimeout(() => {
      tryInitiateMusing()
      scheduleNext()
    }, delay)
  }

  scheduleNext()
  logEvent('musing', 'timer started, interval 30–90s')
}

// ── End bot-to-bot idle musings ──────────────────────────────────────────────

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
      // it away. Gates wandering, pen/field joins, and musings (idleWanderEnabled).
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
      return { ok: true, active: sustainState.active, cycles: sustainState.cycles, startedBy: sustainState.startedBy }
    }
    case 'sustain_stop': {
      const was = sustainState.active
      sustainState.active = false
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
          if (!insideHouse()) await runGoInside()
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
      if (taskBusy()) return { ok: false, error: 'busy', ...taskStatus() }
      runGoInside().catch(e => logEvent('go-inside-error', e.message))
      return { ok: true, started: true }
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

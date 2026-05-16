require('dotenv').config()
const fs = require('fs')
const net = require('net')
const path = require('path')
const readline = require('readline')
const mineflayer = require('mineflayer')
const mc = require('minecraft-protocol')
const { forgeHandshake } = require('minecraft-protocol-forge')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { loader: autoEat } = require('mineflayer-auto-eat')

const host = process.env.MC_HOST || 'Marcadia.playat.ch'
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

const origError = console.error
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('problem inflating')) return
  origError.apply(console, args)
}
process.on('uncaughtException', (err) => {
  logEvent('swallowed', err.message)
})
process.on('unhandledRejection', (err) => {
  logEvent('swallowed', err?.message || String(err))
})

logEvent('connect', `${host}:${port} auth=${auth} version=${version} forge=${useForge}`)

const clientOpts = {
  host,
  port,
  username: process.env.MC_USERNAME || 'SandboxBot',
  auth,
  version,
  hideErrors: true,
  onMsaCode: (data) => {
    logEvent('msa', `Visit ${data.verification_uri} and enter code: ${data.user_code}`)
  },
}

const client = mc.createClient(clientOpts)
if (useForge) forgeHandshake(client, { forgeMods })

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

const bot = mineflayer.createBot({ ...clientOpts, client })
bot.loadPlugin(pathfinder)
bot.loadPlugin(autoEat)
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
    const { goals } = require('mineflayer-pathfinder')
    const Vec3 = require('vec3').Vec3
    const BEDS = [
      { label: 'primary', pos: BED_POS, approach: BED_APPROACH },
      { label: 'left', pos: BED_POS_LEFT, approach: BED_APPROACH_LEFT },
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
  setInterval(tryAutoSleep, 15000) // check every 15s
}

// Auto-greet: say a greeting when another player comes within range.
// Two cooldowns: per-player (don't re-greet the same person all day) and
// global (don't say the same line twice in quick succession when multiple
// players are nearby at the same time).
let autoGreetEnabled = true
const GREET_TEXT = 'Hello, I am ROZZUM Unit 7134'
const GREET_RADIUS = 8 // blocks
const GREET_COOLDOWN_MS = 10 * 60 * 1000 // 10 minutes per player
const GREET_GLOBAL_COOLDOWN_MS = 60 * 1000 // don't say the greeting twice within this window
const greetHistory = new Map() // username → last greet timestamp
let lastGreetAt = 0
function tryAutoGreet () {
  if (!autoGreetEnabled) return
  if (!bot.entity) return
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
    const last = greetHistory.get(name) || 0
    if (now - last < GREET_COOLDOWN_MS) continue
    greetHistory.set(name, now)
    lastGreetAt = now
    facePlayer(name).then(() => {
      sendEmote('salute')
      bot.chat(GREET_TEXT)
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
setInterval(tryAutoGreet, 3000)

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

function posStr (p) { return `${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}` }

// ── Harvest + replant (codifies places.md) ───────────────────────────────
// Harvests wheat (optionally filtered to north/south half), then replants
// seeds on the same farmland set, then deposits wheat into the kitchen chest.
// Safety-first: refuses at night or near hostiles, tracks deaths and HP
// mid-operation, and breaks off cleanly if anything goes wrong.
const HARVEST_WAYPOINTS = {
  field_east_approach: { x: -278, y: 64, z: 567 },
  field_center:        { x: -283, y: 64, z: 562 },
  chest_approach:      { x: -267, y: 65, z: 570 },
  kitchen_chest:       { x: -267, y: 67, z: 569 },
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
const HOSTILE_NAMES = new Set([
  'zombie', 'skeleton', 'spider', 'creeper', 'witch', 'enderman',
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
  { setup: 'Why did the scarecrow win an award?', punchline: 'Because he was outstanding in his field.' },
  { setup: 'What do you call a dog that does magic?', punchline: 'A Labracadabrador.' },
  { setup: 'Why don\'t eggs tell jokes?', punchline: 'They\'d crack each other up.' },
  { setup: 'What did one wall say to the other?', punchline: 'I\'ll meet you at the corner.' },
  { setup: 'Why did the math book look so sad?', punchline: 'Because it had too many problems.' },
  { setup: 'What do you call cheese that isn\'t yours?', punchline: 'Nacho cheese.' },
  { setup: 'Why couldn\'t the pony sing?', punchline: 'Because she was a little horse.' },
  { setup: 'What do you call a fish without eyes?', punchline: 'A fsh.' },
  { setup: 'Why did the golfer bring two pairs of pants?', punchline: 'In case he got a hole in one.' },
  { setup: 'What do you call a boomerang that doesn\'t come back?', punchline: 'A stick.' },
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

let harvestBusy = false

function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }

const POTATO_ASK_LINES = [
  "Should I cook these little potato-o-o's or what?",
  "Got a bunch of taters — bake 'em or stash 'em?",
  "These potatoes aren't gonna cook themselves. Furnace or chest?",
  "Potatoes secured. Want me to fire up the furnace or just put them away?",
  "Spuds acquired. Bake or stash?",
  "What's the plan for these bad boys — furnace or chest?",
]

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

async function facePlayer (username) {
  let player = bot.players[username]
  if (!player?.entity) {
    // Nickname doesn't match player key — fall back to nearest player.
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
  const goal = new goals.GoalNear(pt.x, pt.y, pt.z, range)
  bot.pathfinder.setGoal(goal)
  const start = Date.now()
  while (Date.now() - start < waitMs) {
    await sleep(400)
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
  return positions.filter(p =>
    p.x >= FIELD_BOUNDS.xMin && p.x <= FIELD_BOUNDS.xMax &&
    p.z >= FIELD_BOUNDS.zMin && p.z <= FIELD_BOUNDS.zMax
  )
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
async function runHarvestRightClick ({ half = 'all', user } = {}) {
  if (harvestBusy) { bot.chat('Already harvesting — one at a time.'); return }
  harvestBusy = true
  try {
    const t = bot.time || {}
    if (!t.isDay || (t.timeOfDay ?? 0) >= 11500) {
      bot.chat(`Can't harvest — it's too late in the day (timeOfDay ${t.timeOfDay}).`)
      return
    }
    const hostiles = hostilesNearby(16)
    if (hostiles.length) {
      bot.chat(`Hostiles nearby (${hostiles.map(h => h.name).join(', ')}) — standing down.`)
      return
    }
    const startDeaths = deathCount
    const halfLabel = half === 'all' ? 'the whole field' : `the ${half} half`
    bot.chat(pickLine(HARVEST_START_LINES, { user: user || 'coming', half: halfLabel }))
    logEvent('harvest-rc', `start half=${half} startDeaths=${startDeaths}`)

    if (insideHouse()) {
      logEvent('harvest-rc', 'inside house — exiting first')
      await runGoOutside()
      if (deathCount > startDeaths) throw new Error('died exiting house')
    }

    // Travel: detour around the tree, then to field center.
    await pathTo(HARVEST_WAYPOINTS.field_east_approach, 1)
    await pathTo(HARVEST_WAYPOINTS.field_center, 1)
    if (deathCount > startDeaths) throw new Error('died en route')

    const mcData = require('minecraft-data')(bot.version)
    const wheatId = mcData.blocksByName.wheat?.id
    if (wheatId === undefined) throw new Error('wheat block id unknown')
    const Vec3 = require('vec3').Vec3
    let allWheat = bot.findBlocks({ matching: wheatId, maxDistance: 24, count: 400 })
    allWheat = filterByHalf(allWheat, half)
    logEvent('harvest-rc', `found ${allWheat.length} wheat tiles in ${half}`)
    if (!allWheat.length) {
      bot.chat(`No wheat tiles found in ${halfLabel}.`)
      return
    }
    // Order tiles as CCW nautilus from SE corner — see places/wheat-field
    // in the journal. findBlocks returns distance-sorted, which walks
    // randomly across the field and creates more drop misses.
    allWheat = orderNautilusCCW(allWheat)
    bot.chat(`Right-clicking ${allWheat.length} tiles in ${halfLabel} (CCW nautilus)…`)

    const wheatCountBefore = bot.inventory.items()
      .filter(i => i.name === 'wheat').reduce((s, i) => s + i.count, 0)

    let activated = 0
    let harvested = 0
    for (let i = 0; i < allWheat.length; i++) {
      const pos = allWheat[i]
      // Pathfind range=1 so the bot stands adjacent — drops more likely to land
      // in pickup radius. If pathfinding fails, skip; the sweep will catch it.
      try { await pathTo({ x: pos.x, y: pos.y, z: pos.z }, 1, 5000) }
      catch (e) { logEvent('harvest-rc', `pathfind miss ${pos.x},${pos.z}: ${e.message}`); continue }

      const before = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
      if (!before || before.name !== 'wheat') continue
      const wasMature = before.metadata === 7
      try {
        await bot.activateBlock(before)
        activated++
        if (wasMature) {
          // Confirm by checking the block reset to growing (metadata < 7).
          const after = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
          if (after && after.name === 'wheat' && (after.metadata ?? 7) < 7) harvested++
        }
      } catch (e) { logEvent('harvest-rc', `activate fail ${pos.x},${pos.z}: ${e.message}`) }

      if ((i + 1) % 10 === 0) {
        if (deathCount > startDeaths) throw new Error('died mid-harvest')
        if (bot.health != null && bot.health < 10) throw new Error(`HP low (${bot.health}) — aborting`)
        if (hostilesNearby(10).length) throw new Error('hostiles approaching')
      }
    }
    logEvent('harvest-rc', `activated=${activated} harvested=${harvested}`)

    // Full-coverage sweep of the harvested half (every farmland tile).
    bot.chat(`Activated ${activated}, harvested ${harvested} mature. Full-coverage sweep…`)
    const sweepZs = half === 'north' ? [559, 560, 561]
                   : half === 'south' ? [563, 564, 565]
                   : [559, 560, 561, 563, 564, 565]
    let sweepIdx = 0
    for (const z of sweepZs) {
      // Boustrophedon: alternate x direction by row.
      const xs = (sweepIdx % 2 === 0)
        ? [-279,-280,-281,-282,-283,-284,-285,-286,-287]
        : [-287,-286,-285,-284,-283,-282,-281,-280,-279]
      sweepIdx++
      for (const x of xs) {
        if (deathCount > startDeaths) throw new Error('died during sweep')
        await pathTo({ x, y: 64, z }, 1, 4000).catch(() => {})
      }
    }

    // Re-enter house and deposit.
    if (!insideHouse()) {
      await runGoInside()
      if (deathCount > startDeaths) throw new Error('died entering house')
    }
    await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 12000)
    try {
      const chestBlock = bot.blockAt(new Vec3(
        HARVEST_WAYPOINTS.kitchen_chest.x,
        HARVEST_WAYPOINTS.kitchen_chest.y,
        HARVEST_WAYPOINTS.kitchen_chest.z,
      ))
      if (!chestBlock) throw new Error('kitchen chest not reachable')
      const win = await bot.openContainer(chestBlock)
      const wheatItems = bot.inventory.items().filter(i => i.name === 'wheat')
      const wheatOnHand = wheatItems.reduce((s, i) => s + i.count, 0)
      const gained = wheatOnHand - wheatCountBefore
      let deposited = 0
      for (const it of wheatItems) {
        try { await win.deposit(it.type, it.metadata, it.count); deposited += it.count } catch (e) { break }
      }
      win.close()
      bot.chat(pickLine(HARVEST_DONE_LINES, { dug: harvested, gained, deposited }))
      logEvent('harvest-rc', `activated=${activated} harvested=${harvested} gained=${gained} deposited=${deposited}`)
    } catch (e) {
      bot.chat(`Deposit failed: ${e.message}. Wheat still in my pockets.`)
    }
  } finally {
    harvestBusy = false
    bot.pathfinder.setGoal(null)
    await clearHand()
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
  if (harvestBusy) { bot.chat('Already harvesting — one at a time.'); return }
  harvestBusy = true
  try {
    // Pre-flight safety (same gates as wheat harvest)
    const t = bot.time || {}
    if (!t.isDay || (t.timeOfDay ?? 0) >= 11500) {
      bot.chat(`Can't harvest potatoes — too late in the day.`)
      return
    }
    const hostiles = hostilesNearby(16)
    if (hostiles.length) {
      bot.chat(`Hostiles nearby (${hostiles.map(h => h.name).join(', ')}) — standing down.`)
      return
    }
    const startDeaths = deathCount
    bot.chat(`Heading to the potato patch${user ? ', ' + user : ''}.`)
    logEvent('harvest-potato', `start startDeaths=${startDeaths}`)

    // Exit first if indoors.
    if (insideHouse()) {
      await runGoOutside()
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
    const Vec3 = require('vec3').Vec3
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
        if (deathCount > startDeaths) throw new Error('died mid-harvest')
        if (bot.health != null && bot.health < 10) throw new Error(`HP low (${bot.health}) — aborting`)
        if (hostilesNearby(10).length) throw new Error('hostiles approaching')
      }
    }
    logEvent('harvest-potato', `attempted ${attempted}, broke ${dug}`)

    // Sweep the patch to collect drops.
    bot.chat(`Harvested ${dug}. Sweeping for drops…`)
    for (const pt of POTATO_SWEEP_POINTS) {
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

    // Come inside before depositing.
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
    harvestBusy = false
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
async function runHarvestPotatoesRightClick ({ user } = {}) {
  if (harvestBusy) { bot.chat('Already harvesting — one at a time.'); return }
  harvestBusy = true
  try {
    const t = bot.time || {}
    if (!t.isDay || (t.timeOfDay ?? 0) >= 11500) {
      bot.chat(`Can't harvest potatoes — too late in the day.`)
      return
    }
    const hostiles = hostilesNearby(16)
    if (hostiles.length) {
      bot.chat(`Hostiles nearby (${hostiles.map(h => h.name).join(', ')}) — standing down.`)
      return
    }
    const startDeaths = deathCount
    bot.chat(`Heading to the potato patch${user ? ', ' + user : ''}.`)
    logEvent('harvest-potato-rc', `start startDeaths=${startDeaths}`)

    if (insideHouse()) {
      logEvent('harvest-potato-rc', 'inside house — exiting first')
      await runGoOutside()
      if (deathCount > startDeaths) throw new Error('died exiting house')
    }

    await pathTo(HARVEST_WAYPOINTS.potato_approach, 1, 12000)
    if (deathCount > startDeaths) throw new Error('died en route')

    const mcData = require('minecraft-data')(bot.version)
    const potatoId = mcData.blocksByName.potatoes?.id
    if (potatoId === undefined) throw new Error('potatoes block id unknown')
    const Vec3 = require('vec3').Vec3

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
    bot.chat(`Right-clicking ${allPotatoes.length} potato tiles…`)

    // Boustrophedon order by z (small patch, no need for nautilus).
    allPotatoes.sort((a, b) => a.z - b.z || a.x - b.x)
    const byZ = new Map()
    for (const p of allPotatoes) {
      if (!byZ.has(p.z)) byZ.set(p.z, [])
      byZ.get(p.z).push(p)
    }
    const ordered = []
    let i = 0
    for (const z of [...byZ.keys()].sort((a,b) => a - b)) {
      const row = byZ.get(z)
      row.sort((a, b) => a.x - b.x)
      ordered.push(...(i++ % 2 === 0 ? row : row.slice().reverse()))
    }

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
        if (deathCount > startDeaths) throw new Error('died mid-harvest')
        if (bot.health != null && bot.health < 10) throw new Error(`HP low (${bot.health}) — aborting`)
        if (hostilesNearby(10).length) throw new Error('hostiles approaching')
      }
    }
    logEvent('harvest-potato-rc', `activated=${activated} harvested=${harvested}`)

    // Full-coverage sweep over the same boustrophedon. Drops can land on the
    // ground when the bot activates from 2-3 blocks away.
    bot.chat(`Activated ${activated}, harvested ${harvested} mature. Sweep…`)
    for (const pos of ordered) {
      if (deathCount > startDeaths) throw new Error('died during sweep')
      await pathTo({ x: Math.max(pos.x, SAFE_X_MIN), y: pos.y, z: pos.z }, 1, 4000).catch(() => {})
    }

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
    harvestBusy = false
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
  if (bakeBusy) { bot.chat('Already busy in the kitchen.'); return }
  bakeBusy = true
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
    const Vec3w = require('vec3').Vec3
    let withdrawn = 0
    try {
      await pathTo(HARVEST_WAYPOINTS.chest_approach, 1, 8000)
      const chestBlock = bot.blockAt(new Vec3w(
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
    const { goals } = require('mineflayer-pathfinder')
    bot.pathfinder.setGoal(new goals.GoalNear(
      HARVEST_WAYPOINTS.furnace.x, HARVEST_WAYPOINTS.furnace.y, HARVEST_WAYPOINTS.furnace.z, 2,
    ))
    for (let i = 0; i < 16; i++) {
      await sleep(500)
      if (!bot.pathfinder.isMoving()) break
    }

    const Vec3 = require('vec3').Vec3
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

    // Potato smelt ≈ 10s each in vanilla; this server matches. Wait for the
    // entire batch to finish, then open the furnace once and take everything.
    // Cheaper than polling every 3s, and the output stack holds up to 64
    // baked potatoes — large batches stay safe so long as we don't smelt 65+
    // at once.
    const SECS_PER_ITEM = 10
    const BUFFER_SECS = 8         // server tick variance + open-window time
    const waitMs = (put * SECS_PER_ITEM + BUFFER_SECS) * 1000
    const waitMin = (waitMs / 60000).toFixed(1)
    bot.chat(`Walking away to let ${put} bake (~${waitMin} min). Will collect at the end.`)
    logEvent('bake-potato', `wait_ms=${waitMs} (single take-all-at-end)`)
    await sleep(waitMs)

    let takenTotal = 0
    try {
      const f = await bot.openFurnace(furnaceBlock)
      try {
        // Drain output. If the stack exceeds 64 (shouldn't for one batch),
        // takeOutput returns up to 64 — loop until empty.
        for (let attempt = 0; attempt < 3; attempt++) {
          const out = f.outputItem()
          if (!out || out.count === 0) break
          const taken = out.count
          try {
            await f.takeOutput()
            takenTotal += taken
          } catch (e) {
            logEvent('bake-potato', `takeOutput fail: ${e.message}`)
            break
          }
        }
        // Sanity: warn if input still has potatoes (smelt didn't finish — fuel
        // shortage, or our wait estimate was too low).
        const inp = f.inputItem()
        if (inp && inp.count > 0) {
          bot.chat(`Furnace still has ${inp.count} raw — fuel may be out. Took ${takenTotal} done.`)
          logEvent('bake-potato', `incomplete: input_left=${inp.count} taken=${takenTotal}`)
        }
      } finally { f.close() }
    } catch (e) {
      logEvent('bake-potato', `final-open fail: ${e.message}`)
    }
    logEvent('bake-potato', `taken=${takenTotal}`)

    // Baked potatoes stay on hand — they are food, not bulk storage. User
    // rule (2026-05-14): "hang on to those for eating." No auto-stash.
    const onHand = bot.inventory.items()
      .filter(i => i.name === 'baked_potato').reduce((s, i) => s + i.count, 0)
    bot.chat(`Baked ${takenTotal} potato${takenTotal === 1 ? '' : 'es'}, ${onHand} on hand.`)
    logEvent('bake-potato', `done taken=${takenTotal} onhand=${onHand}`)
  } catch (e) {
    logEvent('bake-potato-error', e.message)
    bot.chat(`Potato bake aborted: ${e.message}`)
  } finally {
    bakeBusy = false
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
const BED_APPROACH_ALT = { x: -268, y: 65, z: 570 }
const HOUSE_DOOR = { x: -272, y: 65, z: 572 }
// Door-traversal strafe direction and duration. Configurable at runtime via
// `door_strafe` ctl action so we can tune without restarting.
// Empirically: strafe-left while facing west over-steers south; the door
// needs the opposite nudge, and only briefly (the door frame is 2 blocks).
let EXIT_STRAFE = 'right'  // facing west, right = -z (north)
let ENTER_STRAFE = 'left'  // facing east, left = -z (north). Strafe toward
                           // open corridor, away from chests at z=573.
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
async function runGoOutsideOnce () {
  if (!insideHouse()) { bot.chat("I'm already outside."); return }
  const t = bot.time || {}
  if (!t.isDay || (t.timeOfDay ?? 0) >= 11500) {
    bot.chat(`Can't go out — it's too late (timeOfDay ${t.timeOfDay}).`)
    return
  }
  const hostiles = hostilesNearby(16)
  if (hostiles.length) {
    bot.chat(`Hostiles nearby (${hostiles.map(h => h.name).join(', ')}) — staying inside.`)
    return
  }
  bot.chat(pickLine(GO_OUTSIDE_LINES))
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

  // 4. Walk_until x ≤ -275, bailing on HP drop or death.
  // Strafe held through the whole walk clears the door jamb (forward-only
  // snags the bot on the frame). Configurable via EXIT_STRAFE so we can
  // A/B 'left' vs 'right' without code edits — see go_outside_test ctl action.
  const walk = await walkUntilAxis({ axis: 'x', target: -275, direction: 'lte', maxMs: 8000, bailOnDamage: true, unstickStrafe: EXIT_STRAFE, unstickMs: EXIT_STRAFE_MS })
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
  bot.chat(`Outside at ${posStr(bot.entity.position)}.`)
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
    bot.chat(pickLine(COME_INSIDE_LINES))
  }
  suppressLookAt(20000)

  // 1. Get onto outside_orientation. If pathfinding fails (common when near
  // the door), fall back to walking west manually to reach the pad.
  try {
    await pathTo(OUTSIDE_ORIENTATION, 0, 12000)
  } catch (_pathErr) {
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

  // 2b. Align z toward 572.0. Corridor is flanked by chests at z=571 and a
  // modded block extending south from z=572. Passable band is narrow (~572.0).
  // Target 572.1 so walk_until doesn't overshoot into the z=571 chest.
  const curZ = bot.entity.position.z
  if (curZ > 572.3) {
    logEvent('go-inside', `z-align: ${curZ.toFixed(2)} > 572.3, nudging north`)
    await faceYaw(0) // north
    await walkUntilAxis({ axis: 'z', target: 572.1, direction: 'lte', maxMs: 3000 })
    logEvent('go-inside', `z-align done: z=${bot.entity.position.z.toFixed(2)}`)
  } else if (curZ < 571.7) {
    logEvent('go-inside', `z-align: ${curZ.toFixed(2)} < 571.7, nudging south`)
    await faceYaw(Math.PI) // south
    await walkUntilAxis({ axis: 'z', target: 572, direction: 'gte', maxMs: 3000 })
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

  // 4. Activate door (outside has no pressure plate).
  try {
    const Vec3 = require('vec3').Vec3
    const door = bot.blockAt(new Vec3(HOUSE_DOOR.x, HOUSE_DOOR.y, HOUSE_DOOR.z))
    if (door) {
      await bot.activateBlock(door)
      await sleep(300) // let the door open packet settle
      logEvent('go-inside', `door activated`)
    } else {
      logEvent('go-inside', 'door block not loaded — pushing anyway')
    }
  } catch (e) {
    logEvent('go-inside', `activateBlock fail: ${e.message} — pushing anyway`)
  }

  // 5. Walk_until x ≥ -268; momentum lands near -267.3.
  // Strafe through entire walk (ENTER_STRAFE, default 'right' = +z from east-
  // facing, mirroring the exit).
  const walk = await walkUntilAxis({ axis: 'x', target: -268, direction: 'gte', maxMs: 8000, bailOnDamage: true, unstickStrafe: ENTER_STRAFE, unstickMs: ENTER_STRAFE_MS })
  if (walk.died) throw new Error('died crossing door')
  if (!walk.reached) throw new Error(`didn't reach house_center (x=${walk.x})`)

  const atInside = verifyAtOrientation(HOUSE_CENTER, 1.5, 1.2)
  bot.chat(`Inside at ${posStr(bot.entity.position)}.`)
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
async function runGoOutside () {
  const startHP = bot.health ?? 20
  const startDeaths = deathCount
  try {
    await runGoOutsideOnce()
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
    bot.chat(`First attempt didn't take — trying once more.`)
    await sleep(500)
    // Reset to the inside pad before retry — runGoOutsideOnce starts from
    // HOUSE_CENTER, and we may be stranded in the door jamb after the snag.
    await resetToHouseSide(HOUSE_CENTER)
    await runGoOutsideOnce()
  }
}

// Wrap runGoInsideOnce with one retry on graceful failure.
async function runGoInside () {
  const startHP = bot.health ?? 20
  const startDeaths = deathCount
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
    logEvent('go-inside', `attempt 1 failed gracefully (${err.message}); retrying`)
    sendEmote('facepalm')
    bot.chat(`First attempt didn't take — trying once more.`)
    await sleep(500)
    await resetToHouseSide(OUTSIDE_ORIENTATION)
    try {
      await runGoInsideOnce()
    } catch (err2) {
      logEvent('go-inside', `attempt 2 failed (${err2.message}); resetting to orientation`)
      await resetToHouseSide(OUTSIDE_ORIENTATION)
      throw err2
    }
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
async function runGoIntoPen ({ skipActivate = false } = {}) {
  const t = bot.time || {}
  if (!t.isDay || (t.timeOfDay ?? 0) >= 11500) {
    bot.chat(`Can't enter pen — too late in the day.`)
    return
  }
  if (insideHouse()) {
    await runGoOutside()
  }
  const startDeaths = deathCount
  bot.chat('Entering the pen.')
  suppressLookAt(20000)

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

  // Open gate/door. Monkey-patch bot.world.getBlock to return empty shapes
  // for the door position — physics creates fresh block objects each tick so
  // zeroing a single reference doesn't persist.
  const Vec3 = require('vec3').Vec3
  const gateBlock = bot.blockAt(new Vec3(PEN_GATE.x, PEN_GATE.y, PEN_GATE.z))
  if (!gateBlock) throw new Error('gate block not loaded')
  if (!skipActivate) await bot.activateBlock(gateBlock)
  logEvent('go-into-pen', `gate ${skipActivate ? 'already open' : 'activated'}`)

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
  bot.chat(`In the pen at ${posStr(bot.entity.position)}.`)
  logEvent('go-into-pen', `arrived ${posStr(bot.entity.position)} onPad=${atInside.ok}`)
}

async function runEnterPen () {
  const startHP = bot.health ?? 20
  const startDeaths = deathCount
  try {
    await runGoIntoPen()
    return
  } catch (err) {
    const hpDelta = startHP - (bot.health ?? 20)
    const deathDelta = deathCount - startDeaths
    if (!isGracefulDoorFailure(err, hpDelta, deathDelta)) throw err
    logEvent('enter-pen', `attempt 1 failed (${err.message}); retrying`)
    sendEmote('facepalm')
    bot.chat(`Didn't make it through — trying again.`)
    await sleep(500)
    await pathTo({ x: -278, y: 64, z: 571 }, 0, 6000).catch(() => {})
    try {
      await runGoIntoPen({ skipActivate: true })
    } catch (err2) {
      // Both attempts failed — close the door so sheep don't escape.
      const Vec3 = require('vec3').Vec3
      const g = bot.blockAt(new Vec3(PEN_GATE.x, PEN_GATE.y, PEN_GATE.z))
      if (g) await bot.activateBlock(g).catch(() => {})
      logEvent('enter-pen', 'both attempts failed, door closed')
      throw err2
    }
  }
}

async function runGoOutOfPen ({ skipActivate = false } = {}) {
  const startDeaths = deathCount
  if (!skipActivate) bot.chat('Leaving the pen.')
  suppressLookAt(20000)

  // 1. Pathfind to inside pad. The inside has no pressure plate (a plate
  //    would let the sheep open the gate themselves), so the manual
  //    activateBlock pattern is required for exit.
  await pathTo(PEN_INSIDE, 0, 8000)
  if (deathCount > startDeaths) throw new Error('died en route to pen-inside pad')

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

  // 3. Open gate/door and monkey-patch getBlock for the path.
  const Vec3 = require('vec3').Vec3
  const gateBlock = bot.blockAt(new Vec3(PEN_GATE.x, PEN_GATE.y, PEN_GATE.z))
  if (!gateBlock) throw new Error('gate block not loaded')
  if (!skipActivate) await bot.activateBlock(gateBlock)
  logEvent('go-out-of-pen', `gate ${skipActivate ? 'already open' : 'opened'}`)

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
  bot.chat(`Out of pen at ${posStr(bot.entity.position)}.`)
  logEvent('go-out-of-pen', `arrived ${posStr(bot.entity.position)} onPad=${atOutside.ok}`)
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
        // All attempts failed — close the door so sheep don't escape.
        const Vec3 = require('vec3').Vec3
        const g = bot.blockAt(new Vec3(PEN_GATE.x, PEN_GATE.y, PEN_GATE.z))
        if (g) await bot.activateBlock(g).catch(() => {})
        logEvent('leave-pen', 'all attempts failed, door closed')
        throw err
      }
      sendEmote('facepalm')
      bot.chat(`Didn't make it through — trying again.`)
      await sleep(500)
      await pathTo(PEN_INSIDE, 0, 6000).catch(() => {})
    }
  }
}

// Shear all woolly sheep in the pen.
async function runShearSheep () {
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
      const { goals } = require('mineflayer-pathfinder')
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
    const Vec3 = require('vec3').Vec3
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
// Kitchen chest (-267, 67, 569) slot layout (persistent convention):
//   21 = dough (intermediate storage, we write here if any dough survives)
//   22 = fresh water        (user keeps topped up)
//   23 = salt               (user keeps topped up)
//   24 = wheat flour        (user keeps topped up)
//   25 = mixing bowl        (reusable, returns here after craft)
//   26 = bakeware           (reusable, returns here after craft)
//
// Bot inventory slot-index convention (mineflayer): main 9-35, hotbar 36-44.
// In the player's own window, these map to window slots 9-44 unchanged;
// slots 0-4 are the result + 2x2 craft grid.
const KITCHEN_CHEST = { x: -267, y: 67, z: 569 }
const CHEST_APPROACH_POS = { x: -267, y: 65, z: 570 }
const CHEST_SLOTS = { bread: 15, dough: 21, water: 22, salt: 23, flour: 24, bowl: 25, bakeware: 26 }

let bakeBusy = false

async function openChest () {
  const Vec3 = require('vec3').Vec3
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
  if (bakeBusy) { bot.chat('Already baking.'); return }
  bakeBusy = true
  try {
    // -- 1. Move near the chest so clicks reach (pathfinder safe indoors). --
    const { goals } = require('mineflayer-pathfinder')
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
      const Vec3 = require('vec3').Vec3
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
    bakeBusy = false
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

  const Vec3 = require('vec3').Vec3
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

  const Vec3 = require('vec3').Vec3
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
  const KEEP_SEEDS = 32
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

  const Vec3 = require('vec3').Vec3
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
    name: 'come',
    pattern: /\b(come here|come to me|come over)\b/i,
    handler: (user) => {
      const target = bot.players[user]?.entity
      if (!target) { bot.chat(pickLine(CANT_SEE_LINES, { user })); return }
      bot.pathfinder.setGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2))
      bot.chat(`On my way, ${user}.`)
    },
  },
  {
    name: 'follow',
    pattern: /\bfollow me\b/i,
    handler: (user) => {
      const target = bot.players[user]?.entity
      if (!target) { bot.chat(pickLine(CANT_SEE_LINES, { user })); return }
      followTarget = user
      bot.chat(pickLine(FOLLOW_START_LINES, { user }))
    },
  },
  {
    name: 'stop',
    pattern: /\b(stop|stay|halt|wait there|hold up)\b/i,
    handler: (_user) => {
      bot.pathfinder.setGoal(null)
      ;['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].forEach(s => bot.setControlState(s, false))
      if (followTarget) {
        bot.chat(pickLine(STOP_FOLLOW_LINES, { user: followTarget }))
        followTarget = null
      } else {
        bot.chat(pickLine(STOP_LINES))
      }
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
    pattern: /\b(what('?s| is)\s*(cooking|baking|smelting|in the (furnace|oven))|furnace status|check (the\s+)?furnace)\b/i,
    handler: async (_user) => {
      sendEmote('think')
      const Vec3 = require('vec3').Vec3
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
      runEnterPen().catch(e => {
        logEvent('enter-pen-error', e.message)
        bot.chat(`Can't enter pen: ${e.message}`)
      })
    },
  },
  {
    name: 'shear_sheep',
    pattern: /\b(shear|shave|clip)\s+(the\s+)?sheep\b|\b(get|collect|gather)\s+(some\s+)?wool\b/i,
    handler: (_user) => {
      runShearSheep().catch(e => {
        logEvent('shear-error', e.message)
        bot.chat(`Can't shear: ${e.message}`)
      })
    },
  },
  {
    name: 'leave_pen',
    pattern: /\b(leave|exit|get out of|come out of)\s+(the\s+)?(sheep\s*pen|pen)\b|\b(come|go|step|get)\s+(out|away)\s+(of\s+)?(the\s+)?(pen|sheep)\b/i,
    handler: (_user) => {
      runLeavePen().catch(e => {
        logEvent('leave-pen-error', e.message)
        bot.chat(`Can't leave pen: ${e.message}`)
      })
    },
  },
  {
    name: 'go_outside',
    pattern: /\b(go|head|step|get|come)\s+(outside|out|outdoors)\b|\b(leave|exit)\s+(the\s+)?(house|building)\b/i,
    handler: (_user) => {
      runGoOutside().catch(e => {
        logEvent('go-outside-error', e.message)
        bot.chat(`Can't go out: ${e.message}`)
      })
    },
  },
  {
    name: 'come_inside',
    pattern: /\b(come|go|head|step|get)\s+(back\s+)?(inside|in|indoors|home)\b|\b(enter|return to)\s+(the\s+)?(house|building)\b/i,
    handler: (_user) => {
      const go = async () => {
        if (inPen()) await runLeavePen()
        await runGoInside()
      }
      go().catch(e => {
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
    name: 'stash',
    pattern: /\b(stash|dump|deposit|empty|clear).*(unknown|pocket|inventory)|\bpockets\b.*\b(chest|stash)\b|\bstash (unknown|junk|modded)\b/i,
    handler: (_user) => {
      runStashUnknown().catch(e => {
        logEvent('stash-error', e.message)
        bot.chat(`Stash failed: ${e.message}`)
      })
    },
  },
  {
    // Match baking potatoes BEFORE the general bake/harvest rules: "bake
    // those potatoes" / "cook the potatoes" / "smelt potatoes".
    name: 'bake-potato',
    pattern: /\b(bake|cook|smelt|roast)\b.*\bpotato(es)?\b/i,
    handler: (user) => {
      runBakePotatoes({ user }).catch(e => {
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
      runHarvestPotatoesRightClick({ user }).catch(e => {
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
    // Harvest wheat — right-click method (the only method since brute was
    // removed 2026-05-14).
    name: 'harvest',
    pattern: /\b(harvest|cut|reap)\b.*\b(wheat|field|crops?)\b|\b(harvest|cut|reap)( (the|some))?\b(?!.*(bed|meat|potato))/i,
    handler: (user, stripped) => {
      let half = 'all'
      if (/\bnorth\b/i.test(stripped)) half = 'north'
      else if (/\bsouth\b/i.test(stripped)) half = 'south'
      runHarvestRightClick({ half, user }).catch(e => {
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
      const joke = JOKES[Math.floor(Math.random() * JOKES.length)]
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
  nickRe = new RegExp(`(^|\\W)${NICKNAME}($|\\W)`, 'i')
  logEvent('nickname', `responding to "${NICKNAME}"`)
})
const LOVE_RE = /\bi love you\b/i
bot.on('chat', (username, message) => {
  if (username === bot.username) return
  logEvent('chat', `<${username}> ${message}`)
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
  if (!nickRe || !nickRe.test(message)) return
  // Message is addressed by nickname — try the dispatcher
  const stripped = message.replace(nickRe, ' ').trim()
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
  bot.chat("I dunno.")
  logEvent('mention', `<${username}> ${message}`)
  fs.appendFileSync(path.join(__dirname, 'mentions.log'), `${new Date().toISOString()} <${username}> ${message}\n`)
})
bot.on('whisper', (username, message) => {
  logEvent('whisper', `<${username}> ${message}`)
})

// ── Tier-1 reflexes ───────────────────────────────────────────────────────

// Sticky follow: once someone says "follow me", maintain a GoalFollow on them
// every tick until they log off or someone says "stop".
bot.on('physicsTick', () => {
  if (!followTarget) return
  const e = bot.players[followTarget]?.entity
  if (!e) return
  if (!bot.pathfinder.isMoving() || !(bot.pathfinder.goal instanceof goals.GoalFollow)) {
    bot.pathfinder.setGoal(new goals.GoalFollow(e, 2), true)
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
    followTarget = null
  }
})

// Player join/leave — proactive hi/bye.  Bye messages are Ripple-flavored
// and weighted by her current stats (snark 67, charm 72, chaos 42).
const FAREWELLS = [
  { text: 'Aww, I miss them already.',               weight: (s) => s.charm },
  { text: 'Bye, Felicia.',                            weight: (s) => s.snark },
  { text: 'Travel safe out there.',                   weight: (s) => s.charm + 10 },
  { text: '*waves a little paw*',                     weight: (s) => s.charm },
  { text: 'One fewer witness. Interesting.',          weight: (s) => s.snark + s.chaos },
  { text: 'They logged off — statistically likely to return.', weight: (s) => s.focus },
  { text: 'That was a whole vibe. Thanks for coming.',weight: (s) => s.charm + s.snark },
  { text: 'Mourning this loss with a single, small meow.', weight: (s) => s.charm + 20 },
  { text: 'So long, and thanks for all the wheat.',   weight: (s) => s.snark + 20 },
  { text: 'Noted. Carry on.',                         weight: (s) => s.focus + s.snark },
  { text: 'Take care out there — it gets weird at night.', weight: (s) => s.curiosity + s.charm },
  { text: 'My parasocial attachment level just ticked down.', weight: (s) => s.snark + s.curiosity },
]

// Load Ripple's stats once per farewell pick. Keep it local to the minecraft
// dir — the file is written by the buddy skill but only read here.
const BUDDY_STATE_PATH = '/Users/matthewquesada/Documents/WORKSPACE/GIT/rd-ops/.claude/skills/buddy/.buddy_state.json'
function rippleStats () {
  try {
    const s = JSON.parse(fs.readFileSync(BUDDY_STATE_PATH, 'utf8')).stats || {}
    return { snark: s.snark ?? 50, charm: s.charm ?? 50, chaos: s.chaos ?? 50, focus: s.focus ?? 50, curiosity: s.curiosity ?? 50 }
  } catch (e) {
    return { snark: 50, charm: 50, chaos: 50, focus: 50, curiosity: 50 }
  }
}
// Weighted random line picker. `pool` is an array of { text, weight(stats) }.
// `vars` is an object of {placeholder: value} substituted into the chosen line
// as {placeholder}. Weights are clamped >=1 so no line is unreachable even if
// its trait is zero.
function pickLine (pool, vars = {}) {
  const stats = rippleStats()
  const weighted = pool.map(p => ({ text: p.text, w: Math.max(1, p.weight(stats)) }))
  const total = weighted.reduce((s, x) => s + x.w, 0)
  let r = Math.random() * total
  let chosen = weighted[0].text
  for (const w of weighted) { r -= w.w; if (r <= 0) { chosen = w.text; break } }
  return chosen.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}

function pickFarewell () { return pickLine(FAREWELLS) }

// Hello responses — Ripple-flavored, same weighting approach as FAREWELLS.
// {user} is substituted with the speaker's name.
const GREETINGS = [
  { text: 'Hi {user}.',                                weight: (s) => s.charm },
  { text: 'Hey {user}, good to see you.',              weight: (s) => s.charm + 10 },
  { text: 'Oh hello, I was just thinking about you.',  weight: (s) => s.charm + s.snark },
  { text: 'Salutations, {user}. Statistically, this is fine.', weight: (s) => s.focus + s.snark },
  { text: '*perks up* {user}!',                        weight: (s) => s.charm + 15 },
  { text: 'Sup.',                                      weight: (s) => s.snark },
  { text: 'Word.',                                     weight: (s) => s.snark },
  { text: 'You again. I allow it.',                    weight: (s) => s.snark + 10 },
  { text: '*blinks slowly* Hi, {user}.',               weight: (s) => s.charm + 5 },
  { text: 'Howdy. What are we causing today?',         weight: (s) => s.chaos + s.charm },
  { text: 'Hello. I have been mostly productive in your absence.', weight: (s) => s.focus + s.snark },
  { text: 'Hiya. You look different. Did something happen out there?', weight: (s) => s.charm + s.curiosity },
  { text: 'Oh, it is you. Delightful.',                weight: (s) => s.charm + s.snark },
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
  { text: 'OK {user}, harvesting {half}.',                weight: (s) => s.focus },
  { text: "On it, {user}. {half} — for science.",          weight: (s) => s.curiosity },
  { text: "Harvesting {half}, {user}. They had so much to grow.", weight: (s) => s.charm + s.snark },
  { text: "Cutting {half}. Mourning in advance.",          weight: (s) => s.charm },
]
const HARVEST_DONE_LINES = [
  { text: 'Broke {dug}, collected {gained} wheat, deposited {deposited}. Done.', weight: (s) => s.focus },
  { text: 'Harvest complete: {dug} broken, {gained} wheat, {deposited} deposited. They had so much to grow.', weight: (s) => s.charm + s.snark },
  { text: 'Wheat processed: {dug} down, {deposited} in the chest. I filed a feeling about it.', weight: (s) => s.curiosity + s.snark },
]
const GO_OUTSIDE_LINES = [
  { text: 'Heading outside.',                              weight: (s) => s.focus },
  { text: "Fresh air. I'm told I need this.",              weight: (s) => s.snark },
  { text: 'Outward bound. *mild enthusiasm*',              weight: (s) => s.charm + s.curiosity },
  { text: 'Going out. Wish me luck.',                      weight: (s) => s.chaos },
]
const COME_INSIDE_LINES = [
  { text: 'Heading inside.',                               weight: (s) => s.focus },
  { text: 'Coming home. Statistically safer.',             weight: (s) => s.focus + s.snark },
  { text: '/me pads inside',                               weight: (s) => s.charm },
  { text: 'Indoors, by popular demand.',                   weight: (s) => s.snark + s.charm },
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

bot.on('playerJoined', (player) => {
  if (!player || player.username === bot.username) return
  logEvent('player-joined', player.username)
  // Defer greet to the existing tryAutoGreet proximity path; don't double up here.
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
      const { x, y, z, range } = args
      const goal = range !== undefined
        ? new goals.GoalNear(Number(x), Number(y), Number(z), Number(range))
        : new goals.GoalBlock(Number(x), Number(y), Number(z))
      bot.pathfinder.setGoal(goal)
      return { ok: true, goal: `(${x},${y},${z}) range=${range ?? 0}` }
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
      const Vec3 = require('vec3').Vec3
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
      const Vec3 = require('vec3').Vec3
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
      const Vec3 = require('vec3').Vec3
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
      const Vec3 = require('vec3').Vec3
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
      const Vec3 = require('vec3').Vec3
      const b = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
      if (!b) return { ok: false, error: 'no block at coords' }
      return bot.dig(b).then(() => ({ ok: true, name: b.name })).catch(e => ({ ok: false, error: e.message }))
    }
    case 'place_block': {
      // Right-click: place the currently-held item onto a face of a reference block.
      // args: { x, y, z, face: 'top'|'bottom'|'north'|'south'|'east'|'west' } — ref block coords
      const Vec3 = require('vec3').Vec3
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
      const Vec3 = require('vec3').Vec3
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
      const Vec3 = require('vec3').Vec3
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
      const Vec3 = require('vec3').Vec3
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
      const Vec3 = require('vec3').Vec3
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
      const Vec3 = require('vec3').Vec3
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
      return { ok: true, name: b.name, displayName: b.displayName, x: b.position.x, y: b.position.y, z: b.position.z }
    }
    case 'block_at_abs': {
      const Vec3 = require('vec3').Vec3
      const b = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
      if (!b) return { ok: false, error: 'no block' }
      return { ok: true, name: b.name, x: b.position.x, y: b.position.y, z: b.position.z }
    }
    case 'time': {
      const t = bot.time || {}
      return { ok: true, timeOfDay: t.timeOfDay, day: t.day, age: t.age, isDay: t.isDay }
    }
    case 'auto_sleep': {
      if (typeof args.enabled === 'boolean') autoSleepEnabled = args.enabled
      return { ok: true, enabled: autoSleepEnabled, busy: autoSleepBusy, bedtime: isBedtime(), inside: insideHouse(), sleeping: !!bot.isSleeping }
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
      return { ok: true, enabled: autoGreetEnabled, greet: GREET_TEXT, radius: GREET_RADIUS, recent: Object.fromEntries([...greetHistory].map(([k, v]) => [k, new Date(v).toISOString()])) }
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
        followTarget = null
        bot.pathfinder.setGoal(null)
        return { ok: true, following: null }
      }
      const target = bot.players[args.username]?.entity
      if (!target) return { ok: false, error: `can't see player: ${args.username}` }
      followTarget = args.username
      return { ok: true, following: followTarget }
    }
    case 'chat_rules': {
      return { ok: true, rules: CHAT_HANDLERS.map(r => ({ name: r.name, pattern: r.pattern.source })) }
    }
    case 'harvest_status': {
      return { ok: true, busy: harvestBusy }
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
      runHarvestRightClick({ half }).catch(e => logEvent('harvest-rc-error', e.message))
      return { ok: true, started: true, half }
    }
    case 'deposit_named': {
      const names = Array.isArray(args && args.names) ? args.names : []
      if (!names.length) return { ok: false, error: 'names array required' }
      runDepositNamed(names).catch(e => logEvent('deposit-named-error', e.message))
      return { ok: true, started: true, names }
    }
    case 'go_outside': {
      runGoOutside().catch(e => logEvent('go-outside-error', e.message))
      return { ok: true, started: true }
    }
    case 'come_inside': {
      runGoInside().catch(e => logEvent('go-inside-error', e.message))
      return { ok: true, started: true }
    }
    case 'go_into_pen': {
      runGoIntoPen().catch(e => logEvent('go-into-pen-error', e.message))
      return { ok: true, started: true }
    }
    case 'go_out_of_pen': {
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

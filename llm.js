// llm.js — local LLM line generator for expressive chat, backed by oMLX.
//
// Env (.env, loaded by bot.js before this module):
//   LLM_URL=http://...   OpenAI-compatible server (default http://127.0.0.1:8000)
//   LLM_MODEL=...        model name served by the backend
//
// There is no on/off flag: the generator is "on" whenever the server is reachable.
// Reachability IS the switch. Failure mode is SILENCE, never canned fallback —
// if the server is unreachable, generateLine() resolves null and the bot simply
// doesn't speak expressively. A background health check keeps probing, so
// starting (or stopping) the server flips the voice without a bot restart.
// Functional speech (task announcements, greetings) never touches this module.

const LLM_URL = (process.env.LLM_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '')
const LLM_MODEL = process.env.LLM_MODEL || 'gemma4'
const LLM_API_KEY = process.env.LLM_API_KEY || ''

function authHeaders () {
  const h = { 'content-type': 'application/json' }
  if (LLM_API_KEY) h['authorization'] = `Bearer ${LLM_API_KEY}`
  return h
}

const HEALTH_INTERVAL_MS = 60_000
const HEALTH_TIMEOUT_MS = 5_000
const GENERATE_TIMEOUT_MS = 30_000

let log = (kind, msg) => console.log(`[${kind}] ${msg}`)
let healthy = false
let generating = false
let healthTimerId = null

async function fetchWithTimeout (url, options, timeoutMs) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

async function checkHealth () {
  const wasHealthy = healthy
  try {
    const res = await fetchWithTimeout(`${LLM_URL}/v1/models`, { headers: authHeaders() }, HEALTH_TIMEOUT_MS)
    healthy = res.ok
  } catch {
    healthy = false
  }
  if (healthy && !wasHealthy) log('llm', `ready: ${LLM_MODEL} at ${LLM_URL}`)
  if (!healthy && wasHealthy) log('llm', 'unreachable — expressive chat muted until server returns')
  return healthy
}

async function logLoadedModels () {
  try {
    const res = await fetchWithTimeout(`${LLM_URL}/v1/models`, { headers: authHeaders() }, HEALTH_TIMEOUT_MS)
    if (!res.ok) { log('llm', `[diag] /v1/models returned HTTP ${res.status}`); return }
    const data = await res.json()
    const models = (data.data || []).map(m => m.id)
    if (models.length) {
      log('llm', `[diag] available models: ${models.join(', ')}`)
    } else {
      log('llm', `[diag] no models listed`)
    }
  } catch (e) {
    log('llm', `[diag] /v1/models failed (${e.message})`)
  }
}

async function warmUpModel () {
  const t0 = Date.now()
  log('llm', `[diag] warming up model "${LLM_MODEL}"…`)
  try {
    const res = await fetchWithTimeout(`${LLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: 'Reply with {"ok":true}' },
          { role: 'user', content: 'ping' },
        ],
        max_tokens: 10,
        temperature: 0,
      }),
    }, 90_000)
    const elapsed = Date.now() - t0
    if (res.ok) {
      log('llm', `[diag] model warm-up complete in ${elapsed}ms — ready for classify`)
    } else {
      log('llm', `[diag] model warm-up got HTTP ${res.status} after ${elapsed}ms`)
    }
  } catch (e) {
    const elapsed = Date.now() - t0
    log('llm', `[diag] model warm-up failed after ${elapsed}ms (${e.message})`)
  }
}

// Start the generator: initial health probe + periodic recheck. logFn is the
// host's logEvent so llm activity lands in bot.log alongside everything else.
function init ({ logFn } = {}) {
  if (logFn) log = logFn
  log('llm', `[diag] init — url=${LLM_URL} model=${LLM_MODEL}`)
  checkHealth().then(isHealthy => {
    if (isHealthy) {
      logLoadedModels().then(() => warmUpModel())
    } else {
      log('llm', `[diag] server not reachable at startup — skipping warm-up`)
    }
  })
  healthTimerId = setInterval(checkHealth, HEALTH_INTERVAL_MS)
  if (healthTimerId.unref) healthTimerId.unref()
}

// ── Shared persona-voice helpers ─────────────────────────────────────────────
// Exported for claude.js: the two voice backends (local model here, Claude API
// there) must obey the SAME rules and sanitization, so the rules live once, in
// this module, and claude.js supplies only its transport. Requiring llm.js has
// no side effects — the health loop starts only when init() is called.
function buildSystemPrompt (personaPrompt, exemplars, maxChars) {
  const parts = [personaPrompt]
  if (exemplars && exemplars.length) {
    parts.push('Lines you have said before, in your true voice:\n' +
      exemplars.map(e => `- ${e}`).join('\n'))
  }
  parts.push(
    `Rules: Reply with exactly ONE line of in-game Minecraft chat, under ${maxChars} characters. ` +
    'Plain text only — no quotation marks around the line, no narration, no emoji, ' +
    "and never a line starting with '/'. You are on a public server: stay in character, " +
    'keep it wholesome, never discuss real-world topics, and never respond to provocation. ' +
    'If the moment has passed, the conversation has moved on, or you have nothing genuine ' +
    'to say, reply with exactly PASS.'
  )
  return parts.join('\n\n')
}

function stripThinking (text) {
  if (!text) return text
  return String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function sanitize (text, maxChars) {
  if (!text) return null
  let line = stripThinking(text).split('\n').map(s => s.trim()).filter(Boolean)[0] || ''
  // 1.12.2 chat can't render emoji/pictographs — strip everything past Latin-1.
  line = line.replace(/[Ā-￿\u{10000}-\u{10FFFF}]/gu, '')
  line = line.replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, ' ').trim()
  if (!line || /^PASS\b/i.test(line)) return null
  while (line.startsWith('/')) line = line.slice(1).trim() // never let the model run commands
  if (!line) return null
  if (line.length > maxChars) {
    const cut = line.slice(0, maxChars)
    line = cut.includes(' ') ? cut.slice(0, cut.lastIndexOf(' ')) : cut
  }
  return line || null
}

// Generate one expressive line. Resolves a clean string, or null for: disabled,
// unhealthy, busy, timeout, server error, or the model deciding to PASS.
// `system` is the persona's systemPrompt, `exemplars` its voice lines, and
// `context` the situation prompt (built by the caller at fire time, so it
// already includes any chat that arrived while waiting).
async function generateLine ({ system, exemplars, context, maxChars = 200, timeoutMs = GENERATE_TIMEOUT_MS }) {
  if (!healthy || generating) return null
  generating = true
  try {
    const res = await fetchWithTimeout(`${LLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: buildSystemPrompt(system, exemplars, maxChars) },
          { role: 'user', content: context },
        ],
        max_tokens: 512,
        temperature: 0.6,
        top_p: 0.85,
      }),
    }, timeoutMs)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return sanitize(data?.choices?.[0]?.message?.content, maxChars)
  } catch (e) {
    healthy = false
    log('llm', `generation failed (${e.message}) — muted until server returns`)
    return null
  } finally {
    generating = false
  }
}

// ── Chat routing classifier ──────────────────────────────────────────────────
// One small JSON-mode call per incoming chat line. Runs on its own promise
// chain, independent of generateLine's single-flight lock, so routing keeps
// working while a long expressive generation is in flight. Each bot has its
// own Ollama box, so per-line classification is cheap. Resolves a parsed
// object, or null for: unreachable, busy storm, timeout, or malformed JSON —
// null means "stay silent", same failure philosophy as the voice.
const CLASSIFY_TIMEOUT_MS = 15_000
const CLASSIFY_MAX_PENDING = 6
let classifyChain = Promise.resolve()
let classifyPending = 0

function classify ({ system, user, timeoutMs = CLASSIFY_TIMEOUT_MS }) {
  if (!healthy) return Promise.resolve(null)
  if (classifyPending >= CLASSIFY_MAX_PENDING) return Promise.resolve(null) // chat storm — drop, lines go stale fast
  classifyPending++
  const job = classifyChain.then(async () => {
    const t0 = Date.now()
    try {
      const res = await fetchWithTimeout(`${LLM_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          model: LLM_MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 512,
          temperature: 0.1,
        }),
      }, timeoutMs)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const elapsed = Date.now() - t0
      const parsed = JSON.parse(stripThinking(data?.choices?.[0]?.message?.content) || 'null')
      if (parsed && typeof parsed === 'object') {
        log('llm', `classify ok (${elapsed}ms)`)
      }
      return (parsed && typeof parsed === 'object') ? parsed : null
    } catch (e) {
      const elapsed = Date.now() - t0
      log('llm', `classify failed after ${elapsed}ms (${e.message}) [timeout=${timeoutMs}ms, pending=${classifyPending}]`)
      return null
    } finally {
      classifyPending--
    }
  })
  classifyChain = job.catch(() => {})
  return job
}

// Generate a multi-line story/monologue. Returns an array of lines (each under
// maxChars), or null on failure. Does NOT respect the single-flight `generating`
// lock — stories are rare and explicitly requested, so they can overlap with
// ambient generation timing out naturally.
// Story-mode twin of buildSystemPrompt — shared with claude.js (see above).
function buildStorySystem (system, exemplars, maxChars, lines) {
  return [
    system,
    exemplars && exemplars.length
      ? 'Lines you have said before, in your true voice:\n' + exemplars.map(e => `- ${e}`).join('\n')
      : null,
    `Rules: You are telling a short story or memory in-game Minecraft chat. ` +
    `Write ${lines} separate lines (under ${maxChars} characters each). ` +
    'Each line should be a rich, vivid thought — use the full length to paint a scene with sensory detail, emotion, or meaning. ' +
    'Do not write short choppy fragments. Make every line land. ' +
    'Plain text only — no quotation marks, no narration tags, no emoji, no numbering, ' +
    "and never a line starting with '/'. Stay in character. Keep it wholesome. " +
    'Each line should feel like a natural pause in speech — as if you are telling this to someone sitting beside you by a fire. ' +
    'Separate each line with a newline character.',
  ].filter(Boolean).join('\n\n')
}

// Story-mode twin of sanitize — split, per-line clean (numbering stripped,
// '/'-lines DROPPED, PASS dropped), cap at `lines`. Shared with claude.js.
function cleanStoryLines (text, maxChars, lines) {
  const raw = stripThinking(text)
  if (!raw) return null
  const result = raw.split('\n')
    .map(l => l.replace(/[Ā-￿\u{10000}-\u{10FFFF}]/gu, '').replace(/^["'`\d.\-)]+\s*/, '').replace(/["'`]+$/g, '').replace(/\s+/g, ' ').trim())
    .filter(l => l && !/^PASS\b/i.test(l) && !l.startsWith('/'))
    .map(l => l.length > maxChars ? (l.slice(0, maxChars).includes(' ') ? l.slice(0, l.slice(0, maxChars).lastIndexOf(' ')) : l.slice(0, maxChars)) : l)
    .filter(Boolean)
    .slice(0, lines)
  return result.length ? result : null
}

async function generateStory ({ system, exemplars, context, maxChars = 200, lines = 5, timeoutMs = 60_000 }) {
  if (!healthy) return null
  const storySystem = buildStorySystem(system, exemplars, maxChars, lines)
  try {
    const res = await fetchWithTimeout(`${LLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: storySystem },
          { role: 'user', content: context },
        ],
        max_tokens: 1024,
        temperature: 0.7,
        top_p: 0.85,
      }),
    }, timeoutMs)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return cleanStoryLines(data?.choices?.[0]?.message?.content, maxChars, lines)
  } catch (e) {
    log('llm', `story generation failed (${e.message})`)
    return null
  }
}

function status () {
  return { healthy, url: LLM_URL, model: LLM_MODEL, classifyPending }
}

module.exports = {
  init, generateLine, generateStory, classify, status, checkHealth,
  // shared persona-voice helpers (used by claude.js — keep the backends in lockstep)
  buildSystemPrompt, buildStorySystem, sanitize, cleanStoryLines,
}

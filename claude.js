'use strict'

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.BOT_API_KEY || ''
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8'
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_TIMEOUT_MS = 30_000

let log = (kind, msg) => console.log(`[${kind}] ${msg}`)
let healthy = !!CLAUDE_API_KEY

function init ({ logFn } = {}) {
  if (logFn) log = logFn
  if (!CLAUDE_API_KEY) {
    log('claude', 'no API key (CLAUDE_API_KEY / ANTHROPIC_API_KEY) — claude brain unavailable')
  } else {
    log('claude', `ready: model=${CLAUDE_MODEL}`)
  }
}

function status () {
  return { healthy, model: CLAUDE_MODEL, hasKey: !!CLAUDE_API_KEY }
}

function parseJson (text) {
  if (!text) return null
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  const brace = s.indexOf('{')
  if (brace >= 0) s = s.slice(brace)
  const last = s.lastIndexOf('}')
  if (last >= 0) s = s.slice(0, last + 1)
  try { return JSON.parse(s) } catch { return null }
}

// ── Shared request core ──────────────────────────────────────────────────────
// One API call path for both the brain (brainChat) and the voice (callVoice) —
// same headers, timeout/abort, error handling, refusal check, text extraction.
// Resolves { data, text } or null. `healthy` goes false ONLY on auth errors
// (401/403 — a bad key won't fix itself), which then gates ALL further calls so
// timer-driven impulses don't hammer a doomed endpoint; revive() re-arms after
// the operator fixes the key (called on a `brain` ctl mode switch).
async function callApi ({ system, messages, maxTokens, temperature, timeoutMs = CLAUDE_TIMEOUT_MS, tag = 'api' }) {
  if (!CLAUDE_API_KEY || !healthy) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        ...(temperature != null ? { temperature } : {}),
        system,
        messages,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 401 || res.status === 403) {
        healthy = false
        log('claude', `auth error ${res.status} — claude muted until restart or brain re-switch`)
      }
      log('claude', `${tag} API error ${res.status}: ${body.slice(0, 200)}`)
      return null
    }
    healthy = true
    const data = await res.json()
    if (data?.stop_reason === 'refusal') {
      log('claude', `${tag} response refused by model (stop_reason=refusal)`)
      return null
    }
    // Newer models can lead with a thinking block — pick the text block, not [0].
    return { data, text: data?.content?.find(b => b.type === 'text')?.text || '' }
  } catch (e) {
    clearTimeout(timer)
    log('claude', `${tag} call failed: ${e.message}`)
    return null
  }
}

// Re-arm after an auth failure (new key in env not supported — same key, fixed
// account — or simply operator judgment). Called by the `brain` ctl switch.
function revive () {
  healthy = !!CLAUDE_API_KEY
  return healthy
}

async function brainChat ({ systemPrompt, userMessage, chatHistory = [], maxTokens = 1024 }) {
  const r = await callApi({
    system: systemPrompt,
    messages: [...chatHistory, { role: 'user', content: userMessage }],
    maxTokens,
    tag: 'brainChat',
  })
  if (!r) return null
  const parsed = parseJson(r.text)
  if (!parsed) {
    log('claude', `unparseable response: ${(r.text || '').slice(0, 200)}`)
    return null
  }
  log('claude', `brainChat ok (${r.data.usage?.input_tokens || '?'}+${r.data.usage?.output_tokens || '?'} tokens)`)
  return parsed
}

// ── Persona voice ────────────────────────────────────────────────────────────
// Claude-backed twins of llm.generateLine / llm.generateStory, used when the
// bot runs with the local model off (BRAIN_MODE=claude-super/claude-private).
// Prompt rules and sanitization are IMPORTED from llm.js so the two voice
// backends cannot drift — this module supplies only the transport. Same
// contract: resolve a clean string / array of lines, or null for no-key, auth-
// muted, busy, API error, refusal, or the model deciding to PASS.
const { buildSystemPrompt, buildStorySystem, sanitize, cleanStoryLines } = require('./llm')
const VOICE_TIMEOUT_MS = 45_000
let voiceBusy = false // single-flight, like llm.generateLine's `generating` lock

async function callVoice ({ systemPrompt, context, maxTokens }) {
  if (voiceBusy) return null // concurrent impulse — drop before spending tokens
  voiceBusy = true
  try {
    const r = await callApi({
      system: systemPrompt,
      messages: [{ role: 'user', content: context }],
      maxTokens,
      temperature: 0.7,
      timeoutMs: VOICE_TIMEOUT_MS,
      tag: 'voice',
    })
    return r ? r.text : null
  } finally {
    voiceBusy = false
  }
}

async function generateLine ({ system, exemplars, context, maxChars = 200 }) {
  const raw = await callVoice({
    systemPrompt: buildSystemPrompt(system, exemplars, maxChars),
    context,
    maxTokens: 256,
  })
  return raw == null ? null : sanitize(raw, maxChars)
}

async function generateStory ({ system, exemplars, context, maxChars = 200, lines = 5 }) {
  const raw = await callVoice({
    systemPrompt: buildStorySystem(system, exemplars, maxChars, lines),
    context,
    maxTokens: 1024,
  })
  return raw == null ? null : cleanStoryLines(raw, maxChars, lines)
}

module.exports = { init, brainChat, generateLine, generateStory, status, revive }

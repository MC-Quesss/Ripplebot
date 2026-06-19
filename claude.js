'use strict'

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.BOT_API_KEY || ''
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-6'
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

async function brainChat ({ systemPrompt, userMessage, maxTokens = 1024 }) {
  if (!CLAUDE_API_KEY) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS)
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
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 401 || res.status === 403) healthy = false
      log('claude', `API error ${res.status}: ${body.slice(0, 200)}`)
      return null
    }
    healthy = true
    const data = await res.json()
    const text = data?.content?.[0]?.text
    const startMs = Date.now()
    const parsed = parseJson(text)
    if (!parsed) {
      log('claude', `unparseable response: ${(text || '').slice(0, 200)}`)
      return null
    }
    log('claude', `brainChat ok (${data.usage?.input_tokens || '?'}+${data.usage?.output_tokens || '?'} tokens)`)
    return parsed
  } catch (e) {
    clearTimeout(timer)
    log('claude', `brainChat failed: ${e.message}`)
    return null
  }
}

module.exports = { init, brainChat, status }

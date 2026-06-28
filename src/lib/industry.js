// @story STORY-006 | industry-vertical-inference
// @intent infer SAP industry vertical for a customer name via AI classification — replaces prior hardcoded keyword rules

import { config } from '../config/index.js'

// @gap 2026-06-28 hardcoded keyword rules replaced entirely by AI call per bug-fix brief — prior verticals (Pharma/Life Sciences, Healthcare/MedTech, etc.) superseded by the 23 SAP industry verticals; function signature changed to async(customerName) — productNames parameter removed

/**
 * The 23 canonical SAP industry vertical strings.
 * The AI is instructed to return exactly one of these; any other response triggers fallback.
 */
export const VALID_VERTICALS = new Set([
  'Aerospace and defense',
  'Agribusiness',
  'Automotive',
  'Chemicals',
  'Consumer products',
  'Construction and real estate',
  'Defense and security',
  'Education and research',
  'Financial services',
  'Government',
  'High tech',
  'Industrial manufacturing',
  'Life sciences and healthcare',
  'Media, sports, and entertainment',
  'Mill products',
  'Mining',
  'Oil, gas, and energy',
  'Professional services',
  'Retail',
  'Telecommunications',
  'Travel and transportation',
  'Utilities',
  'Wholesale distribution',
])

const FALLBACK_VERTICAL = 'Professional services'

// Module-level in-memory cache — persists for the lifetime of the process (one --transform run)
const _cache = new Map()

/**
 * Pluggable AI client factory — replaced by tests via _setAiClientFactory().
 * Default: build from env vars using the real AIClient.
 * @returns {Promise<object|null>} AI client instance, or null if env vars are missing
 */
let _aiClientFactory = async () => {
  if (!config.aiApiKey || !config.aiBaseUrl) return null
  const { AIClient } = await import('./aiClient.js')
  return new AIClient({
    apiKey: config.aiApiKey,
    baseURL: config.aiBaseUrl,
    defaultModel: config.aiModel,
    defaultMaxTokens: 64,
  })
}

/**
 * Override the AI client factory — for testing only.
 * @param {Function} factory — async () => aiClient | null
 */
export function _setAiClientFactory(factory) {
  _aiClientFactory = factory
}

/**
 * Emit a warn envelope to stderr.
 * @param {string} message
 */
function warnStderr(message) {
  process.stderr.write(`{"level":"warn","message":${JSON.stringify(message)}}\n`)
}

/**
 * Infer the SAP industry vertical for a customer using an AI classification call.
 *
 * - Calls are cached per unique customer name within a single process run.
 * - If the AI call fails or returns an unrecognised value, falls back to "Professional services"
 *   and emits a warn envelope to stderr.
 * - If AI client cannot be constructed (missing env vars), falls back silently.
 *
 * @param {string} customerName — display name of the customer
 * @returns {Promise<string>} one of the 23 SAP industry vertical strings
 */
// @entry inferIndustry(customerName) | classify customer into SAP industry vertical via AI
// @contract input: customerName string → output: Promise<industry string (one of 23 SAP verticals)> | errors: never throws — fallback to "Professional services" on AI failure or unrecognised value
export async function inferIndustry(customerName) {
  const name = (customerName ?? '').trim()

  // Return cached result immediately — same name, same industry, one API call per run
  if (_cache.has(name)) {
    return _cache.get(name)
  }

  // Build AI client via the factory (real or injected mock)
  let aiClient = null
  try {
    aiClient = await _aiClientFactory()
  } catch (err) {
    warnStderr(`inferIndustry: failed to construct AI client for "${name}": ${err.message}`)
    _cache.set(name, FALLBACK_VERTICAL)
    return FALLBACK_VERTICAL
  }

  if (!aiClient) {
    // No AI client available — fall back silently (AI vars not configured)
    _cache.set(name, FALLBACK_VERTICAL)
    return FALLBACK_VERTICAL
  }

  const verticalsLine = [...VALID_VERTICALS].join(', ')
  const prompt =
    `Classify the following company into exactly one SAP industry vertical.\n` +
    `Reply with the vertical name only — no explanation, no punctuation, nothing else.\n\n` +
    `Industry verticals: ${verticalsLine}\n\n` +
    `Company name: ${name}`

  let rawResult
  try {
    rawResult = await aiClient.chat(prompt)
  } catch (err) {
    warnStderr(`inferIndustry: AI call failed for "${name}": ${err.message} — falling back to "${FALLBACK_VERTICAL}"`)
    _cache.set(name, FALLBACK_VERTICAL)
    return FALLBACK_VERTICAL
  }

  // Normalise: trim whitespace and trailing punctuation
  const trimmed = (rawResult ?? '').trim().replace(/[.,;:!?]+$/, '')

  if (VALID_VERTICALS.has(trimmed)) {
    _cache.set(name, trimmed)
    return trimmed
  }

  // Unrecognised value — warn and fall back
  warnStderr(
    `inferIndustry: AI returned unrecognised vertical "${trimmed}" for "${name}" — falling back to "${FALLBACK_VERTICAL}"`,
  )
  _cache.set(name, FALLBACK_VERTICAL)
  return FALLBACK_VERTICAL
}

/**
 * Clear the in-memory cache. Exposed for testing only.
 */
export function _clearCache() {
  _cache.clear()
}

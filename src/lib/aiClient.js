// @story STORY-003 | aiClient
// @intent portable AI module — LLM messages (Anthropic-compatible) + embeddings (OpenAI-compatible)
//
// Designed to be copy-portable across Node.js projects.
// Dependencies: @anthropic-ai/sdk (LLM calls only); embeddings use native fetch (Node 18+).
//
// Quick start:
//   import { AIClient, MODELS } from './aiClient.js'
//   const ai = new AIClient({ apiKey: '...', baseURL: 'http://localhost:6655' })
//   const text = await ai.chat('Summarize this CSV: ...')
//   const vec  = await ai.embed('some text')

import Anthropic from '@anthropic-ai/sdk'

// ---------------------------------------------------------------------------
// Model constants
// ---------------------------------------------------------------------------

// Choose model tier based on task complexity:
//   haiku  → fast summarization, lightweight analysis         (~cheapest)
//   sonnet → balanced reasoning, moderate complexity          (default)
//   opus   → deep multi-step reasoning, complex analysis      (~most capable)
export const MODELS = {
  haiku:  'anthropic--claude-haiku-latest',
  sonnet: 'anthropic--claude-sonnet-latest',
  opus:   'anthropic--claude-opus-latest',
}

// ---------------------------------------------------------------------------
// AIClient class
// ---------------------------------------------------------------------------

/**
 * Portable AI client for Anthropic-compatible LLM calls and OpenAI-compatible embeddings.
 *
 * @param {object} opts
 * @param {string}  opts.apiKey             - API key (used as Bearer token for both endpoints)
 * @param {string}  opts.baseURL            - Proxy base URL, e.g. http://localhost:6655
 *                                            LLM endpoint:        {baseURL}/anthropic/v1
 *                                            Embeddings endpoint: {baseURL}/openai/v1/embeddings
 * @param {string}  [opts.defaultModel]     - Default LLM model (default: MODELS.haiku)
 * @param {number}  [opts.defaultMaxTokens] - Default max tokens for LLM calls (default: 1024)
 */
export class AIClient {
  constructor({ apiKey, baseURL, defaultModel = MODELS.haiku, defaultMaxTokens = 1024 } = {}) {
    if (!apiKey) throw new Error('AIClient: apiKey is required')
    if (!baseURL) throw new Error('AIClient: baseURL is required')

    this._apiKey = apiKey
    this._baseURL = baseURL.replace(/\/$/, '') // strip trailing slash
    this._defaultModel = defaultModel
    this._defaultMaxTokens = defaultMaxTokens

    this._llmClient = new Anthropic({
      apiKey,
      baseURL: `${this._baseURL}/anthropic`,
    })
  }

  // -------------------------------------------------------------------------
  // LLM — chat()
  // -------------------------------------------------------------------------

  /**
   * Send a single user prompt and return the response text.
   *
   * @param {string}   prompt
   * @param {object}   [opts]
   * @param {string}   [opts.model]      - Override model for this call
   * @param {number}   [opts.maxTokens]  - Override max tokens for this call
   * @param {object[]} [opts.messages]   - Full message array (overrides prompt when provided)
   * @returns {Promise<string>} Response text
   */
  async chat(prompt, { model, maxTokens, messages } = {}) {
    const payload = {
      model:      model     ?? this._defaultModel,
      max_tokens: maxTokens ?? this._defaultMaxTokens,
      messages:   messages  ?? [{ role: 'user', content: prompt }],
    }

    const MAX_RETRIES = 5
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const chunks = []
        const stream = await this._llmClient.messages.stream(payload)
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            chunks.push(event.delta.text)
          }
        }
        return chunks.join('')
      } catch (err) {
        const msg = err.message ?? String(err)
        // Parse retry-after from 429 response body: "Please retry after N seconds"
        const retryMatch = msg.match(/"seconds"\s*:\s*(\d+)/) ?? msg.match(/retry after (\d+) second/i)
        const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('rate limit')
        if (isRateLimit && attempt < MAX_RETRIES) {
          const waitSecs = retryMatch ? parseInt(retryMatch[1], 10) + 1 : Math.pow(2, attempt + 1)
          await new Promise(resolve => setTimeout(resolve, waitSecs * 1000))
          continue
        }
        throw new Error(`AI chat error: ${msg}`)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Embeddings — embed()
  // -------------------------------------------------------------------------

  /**
   * Generate embeddings for one or more texts.
   *
   * @param {string|string[]} input       - Single text or array of texts
   * @param {object}          [opts]
   * @param {string}          [opts.model] - Embedding model (default: 'text-embedding-3-small')
   * @returns {Promise<number[]|number[][]>} Single vector or array of vectors
   */
  async embed(input, { model = 'text-embedding-3-small' } = {}) {
    const url = `${this._baseURL}/openai/v1/embeddings`
    const body = JSON.stringify({ model, input })

    let res
    try {
      res = await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${this._apiKey}`,
        },
        body,
      })
    } catch (err) {
      throw new Error(`AI embed error (network): ${err.message ?? String(err)}`)
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText)
      throw new Error(`AI embed error (${res.status}): ${detail}`)
    }

    const json = await res.json()

    // Normalise: return a single vector when input was a string,
    // or an array of vectors when input was an array.
    const vectors = json.data.map(item => item.embedding)
    return Array.isArray(input) ? vectors : vectors[0]
  }

  // -------------------------------------------------------------------------
  // Utility — listModels()
  // -------------------------------------------------------------------------

  /**
   * List available LLM models from the proxy.
   * @returns {Promise<object[]>} Array of model objects {id, display_name, ...}
   */
  async listModels() {
    const url = `${this._baseURL}/anthropic/v1/models`
    const res = await fetch(url, {
      headers: {
        'x-api-key':     this._apiKey,
        'Authorization': `Bearer ${this._apiKey}`,
      },
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText)
      throw new Error(`listModels error (${res.status}): ${detail}`)
    }
    const json = await res.json()
    return json.data ?? json
  }
}

// ---------------------------------------------------------------------------
// Functional convenience wrapper (backward-compatible with previous callAI())
// ---------------------------------------------------------------------------

/**
 * One-shot LLM call — creates a temporary AIClient and calls chat().
 * Use AIClient directly when making multiple calls (avoids re-instantiating the SDK).
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} opts.model
 * @param {number} opts.maxTokens
 * @param {string} opts.apiKey
 * @param {string} opts.baseURL   - Full proxy base URL, e.g. http://localhost:6655
 * @returns {Promise<string>}
 */
export async function callAI({ prompt, model, maxTokens, apiKey, baseURL }) {
  const ai = new AIClient({ apiKey, baseURL, defaultModel: model, defaultMaxTokens: maxTokens })
  return ai.chat(prompt)
}

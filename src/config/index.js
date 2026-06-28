// @story STORY-001 STORY-003 | cli-scaffold analyze
// @intent provides a frozen, centralized config object built from env vars with safe defaults — all tool modules import from here, never from process.env directly

// @contract input: process.env (populated by dotenv before this module is imported) → output: frozen config object with all 9 env vars | errors: none (always returns defaults)

export const config = Object.freeze({
  // DATA_DIR — path to input/output data directory
  dataDir: process.env.DATA_DIR ?? './data',
  // LOG_LEVEL — logging verbosity (silent/info/debug)
  logLevel: process.env.LOG_LEVEL ?? 'info',
  // PDF_MAX_PAGES — max pages to process per PDF file (0 = all)
  pdfMaxPages: parseInt(process.env.PDF_MAX_PAGES ?? '0', 10),
  // CSV_DELIMITER — output CSV field delimiter
  csvDelimiter: process.env.CSV_DELIMITER ?? ',',
  // AI_MODEL — model ID for Steps 1–3 of --analyze (sonnet)
  aiModel: process.env.AI_MODEL ?? 'claude-sonnet-4-5',
  // AI_MODEL_SENIOR — model ID for Steps 4–5 of --analyze (opus)
  aiModelSenior: process.env.AI_MODEL_SENIOR ?? 'claude-opus-4-5',
  // AI_MAX_TOKENS — max tokens for AI response
  aiMaxTokens: parseInt(process.env.AI_MAX_TOKENS ?? '8192', 10),
  // AI_API_KEY — API key for AI service
  aiApiKey: process.env.AI_API_KEY ?? '',
  // AI_BASE_URL — custom AI API base URL (empty = Anthropic default)
  aiBaseUrl: process.env.AI_BASE_URL ?? '',
})

// @story STORY-001 | cli-scaffold
// @intent scaffold test file — ensures the test runner can locate and execute tests; verifies config module exports a frozen object with all 8 expected keys

import { test } from 'node:test'
import assert from 'node:assert/strict'

// Minimal smoke tests — no assertions on business logic required for STORY-001.
// Full integration tests for each feature flag live in their respective story test files.

test('config module exports a frozen object', async () => {
  // Dynamically import so dotenv does not need to be loaded first in test context
  const { config } = await import('../src/config/index.js')
  assert.ok(config, 'config should be truthy')
  assert.equal(typeof config, 'object', 'config should be an object')
  assert.ok(Object.isFrozen(config), 'config should be frozen')
})

test('config has all 8 expected keys with defaults', async () => {
  const { config } = await import('../src/config/index.js')
  // Core config
  assert.ok('dataDir' in config, 'config.dataDir should exist')
  assert.ok('logLevel' in config, 'config.logLevel should exist')
  assert.ok('pdfMaxPages' in config, 'config.pdfMaxPages should exist')
  assert.ok('csvDelimiter' in config, 'config.csvDelimiter should exist')
  // AI config
  assert.ok('aiModel' in config, 'config.aiModel should exist')
  assert.ok('aiMaxTokens' in config, 'config.aiMaxTokens should exist')
  assert.ok('aiApiKey' in config, 'config.aiApiKey should exist')
  assert.ok('aiBaseUrl' in config, 'config.aiBaseUrl should exist')
})

test('config default values are correct when env vars not set', async () => {
  // Re-import is cached; values reflect the environment at test startup.
  // Since no .env is set in CI/test, defaults should be used.
  const { config } = await import('../src/config/index.js')
  assert.equal(config.dataDir, process.env.DATA_DIR ?? './data')
  assert.equal(config.logLevel, process.env.LOG_LEVEL ?? 'info')
  assert.equal(config.pdfMaxPages, parseInt(process.env.PDF_MAX_PAGES ?? '0', 10))
  assert.equal(config.csvDelimiter, process.env.CSV_DELIMITER ?? ',')
  assert.equal(config.aiModel, process.env.AI_MODEL ?? 'anthropic--claude-sonnet-latest')
  assert.equal(config.aiMaxTokens, parseInt(process.env.AI_MAX_TOKENS ?? '8192', 10))
})

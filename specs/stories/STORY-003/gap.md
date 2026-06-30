# Gap: STORY-003

## Changes
- [2026-06-30] Steps 1–3 used Promise.allSettled() with no concurrency bound, firing 500+ simultaneous AI API calls and causing sustained 429 rate-limit failures (198/531 tasks exhausted retries). Fixed by introducing a lightweight semaphore-style `runWithConcurrency()` helper in analyze.js capped at AI_PIPELINE_CONCURRENCY (default 15). No external dependency added.

## Files affected
- src/tools/analyze.js — added runWithConcurrency() helper; updated runStep1/2/3 signatures to accept and pass concurrency; updated call sites in run() to read config.aiPipelineConcurrency
- src/config/index.js — added aiPipelineConcurrency field reading AI_PIPELINE_CONCURRENCY env var (default: 15)
- .env.example — added AI_PIPELINE_CONCURRENCY=15 with operator guidance comment

## Side-effects on other stories
None — the fix is entirely within the --analyze pipeline. Steps 1–3 produce identical output; only parallelism behavior changes. Step 4 (serialized per-industry for-loop) is unaffected.

## Recommended spec update
- architecture.md ## Configuration table: add AI_PIPELINE_CONCURRENCY row (max parallel AI calls in Steps 1–3, default 15)
- story-spec.md Criterion 2: note that Steps 1–3 execute with bounded concurrency (AI_PIPELINE_CONCURRENCY) to prevent 429 rate-limit storms
- architecture.md ## Amendment: document that Promise.allSettled unbounded parallelism is prohibited for AI pipeline steps; use runWithConcurrency or equivalent

---
story_id: STORY-003
title: "AI-powered analysis — 5-step bottom-up pipeline (--analyze)"
depends_on: [STORY-001]
reads:
  actors:    [operator]
  data:      [portfolio, industry_insight, customer, solutions_l1, solutions_l2, solutions_l3, contract, tool-invocation]
  contracts: [error-envelope, tool-module, portfolio-json, industry-insight-shape, customer-shape, solutions-l1-shape, solutions-l3-shape, contract-block-shape]
  patterns:  [cli-dispatch, env-config, exit-code-contract, bottom-up-ai-pipeline]
---

## Criteria
1. `--analyze <file.json>` reads a portfolio JSON produced by --transform; exits 0 on success.
2. Executes pattern:bottom-up-ai-pipeline in order: Step 1 (contract_insights per L3, sonnet), Step 2 (solution_architecture_insights per L1, sonnet), Step 3 (enterprise_architecture_insights per customer, sonnet), Step 4 (industry_insights summary per industry, opus).
3. After completion, every contract:contract-block-shape.contract_insights[] is non-empty, every contract:solutions-l1-shape.solution_architecture_insights[] is non-empty, every contract:customer-shape.enterprise_architecture_insights[] is non-empty, and every contract:industry-insight-shape.summary[] is non-empty.
4. Portfolio JSON is written back to disk after each step completes — a crash loses at most one step's computation.
5. Prompt templates are `.md` files in `/src/ai/`; sole product knowledge source is `src/ai/sap-product-catalog.json`; no inline prompt strings in source code.
6. Steps 1–3 use `AI_MODEL` env var (sonnet); Step 4 uses `AI_MODEL_SENIOR` env var (opus); both must be set.
7. Missing argument: `error: --analyze requires a filename argument`; exits 1.
8. File not found: `error: file not found: <path>`; exits 1.
9. `AI_API_KEY` not set: `error: AI_API_KEY is not set`; exits 1.
10. Any API call failure: `error: AI API error: <message>`; exits 2.

## Interfaces
- `consumption-analyzer --analyze <file>`
  auth:     actor:operator — no auth; single-user CLI
  guard:    AI_API_KEY, AI_MODEL, AI_MODEL_SENIOR must be set; file must exist and be valid portfolio JSON
  response: contract:portfolio-json written in-place; progress lines to stderr per step
  errors:   exit 1 (missing arg, file not found, missing API key), exit 2 (API failure, JSON parse failure)

## Permissions
- actor:operator — may invoke `--analyze` unconditionally; all config via `.env`

## State
- full machine: data:tool-invocation.state-machine
- produced → enriched: trigger: --analyze completes all 5 steps · guard: all AI fields non-empty

## Data
- owns: data:portfolio (enriches in-place — populates all AI insight fields across all 4 levels)
- reads: data:contract (Step 1 input: year/month series + variances per L3 product)
- reads: data:solutions_l1 (Step 2 scope: one call per L1 per customer; reads all L3 contract_insights aggregated)
- reads: data:customer (Step 3 scope: one call per customer; reads all L1 solution_architecture_insights)
- reads: data:industry_insight (Step 4 scope: one call per distinct industry; reads customer enterprise_architecture_insights)
- new fields: none (all AI fields defined in contract:contract-block-shape, contract:solutions-l1-shape, contract:customer-shape, contract:industry-insight-shape)

## Change history
| Release | Date       | Summary                                                                                                    | Source     |
|---------|------------|------------------------------------------------------------------------------------------------------------|------------|
| 1.2.0   | 2026-06-25 | Gap merged: Criterion 2 message text relaxed — commander intercepts missing-arg before tool module; exit 1 and error: prefix contract preserved | gap-merge |
| 2.0.0   | 2026-06-26 | Rewritten for cACV domain: dual input (portfolio.json + raw CSV), MODELS.sonnet, AI_MAX_TOKENS default 2048, date injection, AIClient class, domain prompt template | rewrite |
| 2.0.1   | 2026-06-26 | Gap merged: {{fiscal_year}} added to prompt substitution variables; AIClient baseURL fallback documented | gap-merge |
| 3.0.0   | 2026-06-27 | Re-spec for 3-level AI pipeline: L1 haiku per sub-SA, L2 haiku product field writes, L3 opus portfolio narrative | rewrite |
| 3.0.1   | 2026-06-27 | Gap merged: stripCodeFences() fallback regex handles preamble text before JSON code fence | gap-merge |
| 3.1.0   | 2026-06-27 | Gap merged: L3 schema expanded; key_signals and signal_type removed; L3 per-field count logging added | gap-merge |
| 4.0.0   | 2026-06-28 | Rewritten for 5-step bottom-up pipeline; supersedes 3-level pipeline; new entity hierarchy and metric names | rewrite |
| 4.1.3   | 2026-06-29 | Schema restructure: solution_architecture_insights moved to L1, enterprise_architecture_insights moved to customer, Step 4 (account_insights) removed; pipeline is now 4 steps | gap-merge |

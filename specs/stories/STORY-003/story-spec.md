---
story_id: STORY-003
title: "AI-powered cACV analysis (--analyze)"
depends_on: [STORY-001]
reads:
  actors:    [operator]
  data:      [portfolio-json, product-metrics, sub-solution-area, tool-invocation]
  contracts: [error-envelope, tool-module, portfolio-json, product-in-subsa-shape]
  patterns:  [cli-dispatch, env-config, exit-code-contract, ai-prompt-call]
---

## Criteria
1. `--analyze <file.json>` accepts a `portfolio.json` produced by --transform; exits 0 on success.
2. 3-level AI pipeline executes in sequence:
   - L1 (haiku): one call per sub-SA across all customers; prompt template `/src/ai/analyze-sa.md`; injects sub-SA name, its products' metrics, and product-catalog context via `{{placeholders}}`; produces product-level insights for that sub-SA (no `signal_type`, `_ai_signal`, or `_ai_pattern` fields).
   - L2 (haiku, via L1 response): parses L1 JSON response; writes `insight`, `recommendation`, and `ea_action` into each `product-in-subsa-shape` object in memory.
   - L3 (opus): one call for the full portfolio; prompt template `/src/ai/analyze.md` (substantially rewritten with tone rules and recommended-ask reasoning); receives aggregated L1/L2 enriched portfolio; produces `ai_insights.pulse_narrative`, `ai_insights.per_customer`, `ai_insights.executive_view`, `ai_insights.renewal_risks[]`, `ai_insights.momentum[]`, `ai_insights.architectural_signals[]`, `ai_insights.industry_perspectives[]`; each `executive_view.portfolio_health_by_customer[]` entry includes `recommended_ask_rationale`.
3. After L2, every product in `portfolio.json` has `insight`, `recommendation`, `ea_action` populated (non-null strings); after L3, `portfolio.json.ai_insights` is a non-null structured object with `pulse_narrative`, `per_customer` (no `key_signals` field), `executive_view` (each entry includes `recommended_ask_rationale`), `renewal_risks[]`, `momentum[]`, `architectural_signals[]` (fields: `title`, `pattern`, `explanation`, `action_for_ea` — no `signal_type`), and `industry_perspectives[]`.
4. `sap-product-catalog.json` is read once at startup and passed as product-capability context to each L1 call; missing catalog file emits `warn:` to stderr but does not fail.
5. Updated `portfolio.json` written back to disk in-place; `pulse_narrative` also written to stdout.
6. L1/L2 models source from `MODELS.haiku`; L3 sources from `MODELS.opus`; both resolved via `src/lib/aiClient.js`.
7. If filename argument omitted: `error: --analyze requires a filename argument`; exits 1.
8. If file not found: `error: file not found: <path>`; exits 1.
9. If `AI_API_KEY` not set: `error: AI_API_KEY is not set`; exits 1.
10. If any AI API call fails: `error: AI API error: <message>`; exits 2.
11. If the model response contains preamble text before the JSON code fence (e.g. "Here is the analysis:\n```json\n..."), `stripCodeFences()` extracts the JSON block via fallback regex and parses successfully; no exit 2 is raised.
11a. L3 logging: after completion, logs emit per-field counts for all generated sections (`renewal_risks`, `momentum`, `architectural_signals`, `industry_perspectives`, `per_customer`) to stderr; L1 emits a progress line per sub-SA processed.
12. No `action_for_csm` field generated; CSM actions removed from all prompt templates and response shapes.

## Interfaces
- `consumption-analyzer --analyze <file>`
  auth:     actor:operator — no auth; single-user CLI
  guard:    AI_API_KEY must be set; file must exist and be valid JSON portfolio
  response: contract:portfolio-json (written in-place); `pulse_narrative` string to stdout
  errors:   exit 1 (missing arg, file not found, missing API key), exit 2 (API failure, JSON parse failure)

## Permissions
- actor:operator — may invoke `--analyze` unconditionally; all config via `.env`

## State
- invoked → success (exit 0): portfolio.json enriched in-place; pulse_narrative on stdout
- invoked → user-error (exit 1): missing arg, file not found, missing API key
- invoked → processing-failure (exit 2): API error or unreadable JSON
- full machine: data:tool-invocation.state-machine

## Data
- owns: data:portfolio-json (mutates in-place: populates `ai_insights` block and all product AI fields; does NOT write `ai_config`)
- reads: data:sub-solution-area (iterates sub-SAs for L1 calls)
- reads: data:product-metrics (insight, recommendation, ea_action fields written at L2)
- new fields: ai_insights.renewal_risks[], ai_insights.momentum[], ai_insights.architectural_signals[], ai_insights.industry_perspectives[], executive_view[].recommended_ask_rationale (see contract:portfolio-json)

## Change history
| Release | Date       | Summary                                                                                                    | Source     |
|---------|------------|------------------------------------------------------------------------------------------------------------|------------|
| 1.2.0   | 2026-06-25 | Gap merged: Criterion 2 message text relaxed — commander intercepts missing-arg before tool module; exit 1 and error: prefix contract preserved | gap-merge |
| 2.0.0   | 2026-06-26 | Rewritten for cACV domain: dual input (portfolio.json + raw CSV), MODELS.sonnet, AI_MAX_TOKENS default 2048, date injection, AIClient class, domain prompt template | rewrite |
| 2.0.1   | 2026-06-26 | Gap merged: {{fiscal_year}} added to prompt substitution variables; AIClient baseURL fallback documented (direct SDK instantiation when AI_BASE_URL unset) | gap-merge |
| 3.0.0   | 2026-06-27 | Re-spec for 3-level AI pipeline: L1 haiku per sub-SA (analyze-sa.md), L2 haiku product field writes, L3 opus portfolio narrative; product AI fields now in nested hierarchy; action_for_csm removed | rewrite |
| 3.0.1   | 2026-06-27 | Gap merged: criterion 11 added — stripCodeFences() fallback regex handles preamble text before JSON code fence; fixes L1 haiku parse failures on sub-SAs with many products | gap-merge |
| 3.1.0   | 2026-06-27 | Gap merged: L3 schema expanded with 5 new ai_insights fields (renewal_risks, momentum, architectural_signals, industry_perspectives, recommended_ask_rationale per customer); key_signals and signal_type removed; L1 signal_type/_ai_signal/_ai_pattern fields removed; L3 per-field count logging added; ai_config write-back removed | gap-merge |

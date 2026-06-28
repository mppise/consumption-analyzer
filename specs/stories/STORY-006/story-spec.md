---
story_id: STORY-006
title: "Industry vertical inference"
depends_on: [STORY-004]
reads:
  actors:    [operator]
  data:      [portfolio, customer]
  contracts: [portfolio-json, cacv-json-record, warn-envelope]
  patterns:  [metrics-computation]
---

## Criteria
1. After --transform completes, every customer entry in the portfolio JSON contains a non-null `industry` string.
2. `inferIndustry(customerName)` returns exactly one of the 23 canonical SAP industry verticals (as enumerated in `VALID_VERTICALS` exported from src/lib/industry.js); the AI model (AI_MODEL env var, sonnet) selects the best match from that enum for the given customer name.
3. AbbVie → "Pharma/Life Sciences"; Cardinal → "Healthcare/MedTech"; Medtronic → "Healthcare/MedTech"; Abbott → "Healthcare/MedTech" (unit test assertions).
4. Deduplication: each unique customer name results in exactly one AI call per --transform run; in-memory cache ensures subsequent references to the same name reuse the cached result.
5. If the AI call fails or returns an unrecognised value, `inferIndustry` returns "Professional services" — never null, never throws.
6. Inference uses an AI call via `src/lib/aiClient.js` (AI_MODEL env var, sonnet); `_setAiClientFactory` and `_clearCache` hooks are exported from src/lib/industry.js for test injection without ESM module mocking.

## Interfaces
No new CLI flag or HTTP endpoint. `inferIndustry` is an internal async function called by `src/tools/transform.js`.

Call site in transform.js:
  location: after customer data is assembled; customer names deduplicated; all inferIndustry() calls awaited before portfolio JSON is written
  input:    customerName (string)
  output:   Promise<string> — one of the 23 VALID_VERTICALS; "Professional services" on error/unrecognised
  module:   src/lib/industry.js
  model:    AI_MODEL env var (sonnet)

## Permissions
- actor:operator — runs --transform; receives enriched portfolio JSON with industry field populated

## State
No state transitions — creation only (industry field written once per --transform run).

## Data
- owns: data:portfolio (writes `customer[].industry` and `industry_insights[]`)
- reads: data:customer (customer name field)
- new fields:
  - customer.industry: string — SAP industry vertical from VALID_VERTICALS; already declared in contract:customer-shape and entity:customer

## Change history
| release | date       | summary                                                                                           | source    |
|---------|------------|---------------------------------------------------------------------------------------------------|-----------|
| 3.0.0   | 2026-06-27 | Gap merged: rules 6 and 7 absent from src/lib/industry.js — rewrote rule set with Ariba-presence branching for Watchlist Screening and Ariba+Concur→Manufacturing; spec was complete and correct, no spec changes required | gap-merge |
| 3.1.0   | 2026-06-28 | Gap merged: AI rewrite — hardcoded rules replaced by AI call (AI_MODEL/sonnet); 8-vertical enum replaced by 23 SAP verticals; inferIndustry now async, productNames param removed; fallback changed to "Professional services"; caching and test hooks added | gap-merge |

---
story_id: STORY-006
title: "Industry vertical inference"
depends_on: [STORY-004]
reads:
  actors:    [operator]
  data:      [portfolio-json, customer-portfolio, cacv-record]
  contracts: [portfolio-json, warn-envelope]
  patterns:  [metrics-computation]
---

## Criteria
1. After --transform completes, every portfolio JSON contains a non-null `industry` string at the root level.
2. `inferIndustry(customerName, productNames)` returns exactly one of: "Pharma/Life Sciences", "Healthcare/MedTech", "Manufacturing", "Financial Services", "Retail/Commerce", "Technology", "Public Sector", "Unknown".
3. AbbVie → "Pharma/Life Sciences"; Cardinal → "Healthcare/MedTech"; Medtronic → "Healthcare/MedTech"; Abbott → "Healthcare/MedTech" (unit test assertions).
4. Rules are evaluated in priority order — higher-priority signals win (e.g. Traceability Hub presence beats Commerce Cloud presence).
5. If no rule matches, `inferIndustry` returns "Unknown" — never null, never throws.
6. Inference runs purely in-process; no AI call, no network access, no disk I/O beyond the existing transform write.

## Interfaces
No new CLI flag or HTTP endpoint. `inferIndustry` is an internal function called by `src/tools/transform.js`.

Call site in transform.js:
  location: after customer data is assembled, before portfolio JSON is written
  input:    customerName (string), productNames (string[] — logical product names from cacv-records)
  output:   string — one of the 8 enumerated verticals
  module:   src/lib/industry.js

## Permissions
- actor:operator — runs --transform; receives enriched portfolio JSON with industry field populated

## State
No state transitions — creation only (industry field written once per --transform run).

## Data
- owns: data:portfolio-json (writes `industry` field at root level)
- reads: data:customer-portfolio (customer_name per customer), data:cacv-record (logical_product per record)
- new fields:
  - portfolio-json.industry: string — enumerated vertical; already declared in contract:portfolio-json and entity:portfolio-json

Rule priority (encoded in src/lib/industry.js, evaluated in order, first match wins):
  1. product contains "Traceability Hub" OR "Batch Release Hub" → "Pharma/Life Sciences"
  2. customer name matches pharma terms (AbbVie, Pfizer, Novartis, Roche, Sanofi, Bayer, Merck, AstraZeneca, Lilly, GSK, Amgen, Genentech, Biogen, Regeneron, BMS) → "Pharma/Life Sciences"
  3. customer name matches health/medtech terms (Cardinal, Medtronic, Abbott, Stryker, Becton, Baxter, Zimmer, Boston Scientific, Edwards, Hologic, Intuitive) → "Healthcare/MedTech"
  4. product contains "Commerce Cloud" (no higher-priority rule matched) → "Retail/Commerce"
  5. product contains "Watchlist Screening" AND (Ariba present) → "Financial Services"
  6. product contains "Watchlist Screening" (no Ariba) → "Manufacturing"
  7. Ariba present AND Concur present AND no higher-priority rule → "Manufacturing"
  8. fallback → "Unknown"

## Change history
| release | date       | summary                                                                                           | source    |
|---------|------------|---------------------------------------------------------------------------------------------------|-----------|
| 3.0.0   | 2026-06-27 | Gap merged: rules 6 and 7 absent from src/lib/industry.js — rewrote rule set with Ariba-presence branching for Watchlist Screening and Ariba+Concur→Manufacturing; spec was complete and correct, no spec changes required | gap-merge |

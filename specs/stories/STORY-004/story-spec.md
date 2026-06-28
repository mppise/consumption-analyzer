---
story_id: STORY-004
title: "CSV to JSON transformation with new portfolio schema (--transform)"
depends_on: [STORY-001]
reads:
  actors:    [operator]
  data:      [csv-input, portfolio, solutions_l1, solutions_l2, solutions_l3, contract, contract_month]
  contracts: [cacv-json-record, field-mapper-contract, portfolio-json, solutions-l1-shape, solutions-l2-shape, solutions-l3-shape, contract-block-shape, contract-month-shape, reconciler-error, error-envelope, warn-envelope]
  patterns:  [cli-dispatch, metrics-computation, env-config, exit-code-contract]
---

## Criteria
1. `consumption-analyzer --transform <file.csv>` writes `data/<basename>-portfolio.json`; output path printed to stdout on success.
2. Output conforms to contract:portfolio-json: generated_at (ISO 8601), reporting_month (YYYYMM — latest month with consumed_contract_value > 0), fiscal_year, customer_count, industry_insights: [], customers[].
3. Each customer entry conforms to contract:customer-shape: customer_id (null for single-customer CSVs), customer, industry: string (inferred by `inferIndustry()` from src/lib/industry.js — see STORY-006), account_insights: [], solutions_l1[].
4. L1 → L2 → L3 nesting is preserved: every L3 product carries lpr_id, lpr_name, solution_architecture_insights: [], contract per contract:contract-block-shape (ai_insights: [], year-keyed monthly arrays).
5. Each contract_month conforms to contract:contract-month-shape with computed variances: acv_gap, budget_gap, budget_attainment (null if budget = 0) — integer-safe arithmetic per entity:contract_month rules.
6. Historical actuals fallback: when consumed_contract_value = 0 AND budget_contract_value = 0 AND delta_cacv > 0 → use delta_cacv as consumed_contract_value (FY2024/FY2025 CACV_CROSS_FC_OPS_DIBO_REPORT rows).
7. Missing/unreadable file → exit 1 + contract:error-envelope; empty CSV after header skip → exit 2; any reconciliation check failure → exit 2 + contract:reconciler-error.
8. Warnings (e.g. unmapped columns, skipped rows) written to stderr via contract:warn-envelope; do not suppress or mix with stdout.

## Interfaces
`consumption-analyzer --transform <file.csv>`
  auth:     actor:operator (no auth)
  guard:    file must exist and be readable; ≥1 data row after 2-row header skip
  response: contract:portfolio-json written to disk; output path to stdout
  errors:   exit 1 — missing arg or file not found; exit 2 — parse failure, reconciliation failure, write error

## Permissions
- actor:operator — runs --transform, reads any CSV path, writes portfolio.json to data/

## State
- produced: --transform completes; entity:portfolio written with AI fields as empty arrays
- full machine: data:tool-invocation.state-machine

## Data
- owns: data:portfolio (creates on each run; overwrites prior file at same path)
- reads: data:csv-input (all rows via contract:cacv-json-record through contract:field-mapper-contract)
- new fields: none — all shapes defined in contracts.md and data-model.md

## Change history
| release | date       | summary | source |
|---------|------------|---------|--------|
| 3.3.0   | 2026-06-28 | Full rewrite for new portfolio schema (L1/L2/L3 hierarchy, renamed metrics, 5-step AI field stubs) | re-spec |
| 3.4.0   | 2026-06-28 | Gap merged: Criterion 3 updated — industry field now inferred by inferIndustry() from src/lib/industry.js rather than left as empty string placeholder | gap-merge |

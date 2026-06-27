---
story_id: STORY-004
title: "CSV to JSON transformation (--transform)"
depends_on: [STORY-001]
reads:
  actors:    [operator]
  data:      [cacv-record, product-metrics, portfolio-json, customer-portfolio, solution-area, sub-solution-area]
  contracts: [cacv-json-record, field-mapper-contract, portfolio-json, customer-portfolio-shape, solution-area-shape, sub-solution-area-shape, product-in-subsa-shape, reconciler-error, error-envelope, warn-envelope]
  patterns:  [cli-dispatch, metrics-computation, env-config, exit-code-contract]
---

## Criteria
1. `consumption-analyzer --transform <file.csv>` writes `<dir>/<basename>-portfolio.json`; output path printed to stdout on success.
2. `--output <path>` overrides the output file path.
3. Output conforms to contract:portfolio-json exactly: `generated_at`, `reporting_month` (YYYYMM — last month with any actuals > 0), `fiscal_year`, `customer_count`, `industry` (placeholder "Unknown" until STORY-006), `customers[]`, `summary`, `ai_insights: null`.
4. Each customer entry conforms to contract:customer-portfolio-shape: `customer_id`, `customer_name`, `summary` (total_ytd_target, total_ytd_actuals, overall_attainment_pct), `solution_areas[]`, `risk_items[]`. No `employee_id`, no risk counts in summary.
5. Products are nested at `customers[].solution_areas[].sub_solution_areas[].products[]` per contract:product-in-subsa-shape. No flat products[] array at any higher level.
6. Each product object includes: `lpr`, `name`, `ytd_target`, `ytd_actuals`, `ytd_attainment_pct`, `ytd_acv_act`, `contract_utilization_pct`, `monthly_series[]`, `trend_direction`, `insight: null`, `recommendation: null`, `ea_action: null`. `_composite_key` must be stripped before writing.
7. All financial summations use integer-safe arithmetic: `Math.round(val * 100)` per value, sum as integers, divide by 100. Attainment: `Math.round((actuals / target) * 1000) / 10`; null when target = 0.
8. Reconciler runs per-customer and portfolio-level (checks 1–7); tolerance = `max(0.01, 0.001 * magnitude)`. Any check 1–6 failure → exit 2 + contract:reconciler-error to stderr.
9. Historical actuals fallback: when cacv_act = 0 AND cacv_target = 0 AND delta_cacv > 0 → use delta_cacv as actuals (FY2024/FY2025 CACV_CROSS_FC_OPS_DIBO_REPORT rows).
10. Missing/unreadable file → exit 1 + contract:error-envelope. Empty CSV after header skip → exit 2. CSV parse failure → exit 2. Warnings → stderr via contract:warn-envelope.

## Interfaces
`consumption-analyzer --transform <file.csv> [--output <file.json>]`
  auth:     actor:operator (no auth)
  guard:    file must exist and be readable; ≥1 data row after 2-row header skip
  response: contract:portfolio-json written to disk; output path to stdout
  errors:   exit 1 — missing arg or file not found; exit 2 — parse failure, reconciliation failure, write error

## Permissions
- actor:operator — runs --transform, reads any CSV path, writes portfolio.json to data/ or --output path

## State
No state transitions — stateless; each run produces a new entity:portfolio-json from scratch.
- full machine: data:tool-invocation.state-machine

## Data
- owns: data:portfolio-json (creates on each run)
- reads: data:cacv-record (all fields from CSV input rows via contract:field-mapper-contract)
- new fields: none — all shapes defined in contracts.md and data-model.md

## Change history
| release | date       | summary                                                                                                                   | source    |
|---------|------------|---------------------------------------------------------------------------------------------------------------------------|-----------|
| 1.3.0   | 2026-06-26 | Gap merged: catch-all rules added to risk-classification-engine (8b OnTrack ≥90%, 8c Low catch-all); criterion 3 updated | gap-merge |
| 2.5.1   | 2026-06-26 | Gap merged: composite product key (logical_product_id/lpr_id), actuals-from-delta fallback for FY2024/FY2025 rows        | gap-merge |
| 3.0.0   | 2026-06-27 | Re-specced for v3 hierarchy: products nested under sub_solution_areas; removed employee_id, risk counts from summary, risk_reason from risk_items; integer-safe arithmetic and proportional reconciler tolerance formalised | re-spec |
| 3.1.0   | 2026-06-27 | Gap merged: removed forecasting fields (fy_target_total, year_end_forecast, year_end_attainment_pct, forecast_confidence) and risk classification fields (risk_level, risk_reason) from product-in-subsa-shape; removed risk_items[] from customer object | gap-merge |

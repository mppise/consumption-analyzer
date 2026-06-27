# Data Model

## entity:pdf-input
A PDF file placed in the `data/` directory (or specified via CLI arg) that is the subject of a conversion operation.

Fields:
- path: string, required — absolute or relative filesystem path to the PDF file
- filename: string, required — basename of the file (e.g. `report.pdf`)
- page_count: integer, optional — total pages in the PDF; populated after file is opened # inferred
- tables_found: integer, optional — number of tables detected during extraction # inferred

State machine: none (read-only input artifact; no lifecycle)

owned-by: actor:operator

---

## entity:csv-output
A CSV file produced by the pdf2csv tool, written to `data/` or stdout.

Fields:
- path: string, optional — filesystem path if written to disk; null if output to stdout
- filename: string, optional — derived from input filename (e.g. `report.csv`)
- row_count: integer, optional — number of data rows written # inferred
- delimiter: string, required — field delimiter character, sourced from `CSV_DELIMITER` env var (default `,`)
- source_pdf: string, required — FK reference to entity:pdf-input.path

State machine: none (write-once output artifact; no lifecycle)

owned-by: actor:operator

---

## entity:csv-input
A CSV file placed in the `data/` directory (or specified via CLI arg) that is the subject of an analysis operation.

Fields:
- path: string, required — absolute or relative filesystem path to the CSV file
- filename: string, required — basename of the file (e.g. `report.csv`)
- row_count: integer, optional — number of data rows (excluding header); populated after file is read # inferred
- column_count: integer, optional — number of columns detected from the header row # inferred
- domain: string, optional — free-form domain hint for AI prompt context; defaults to general-purpose if not supplied # inferred

State machine: none (read-only input artifact; no lifecycle)

owned-by: actor:operator

---

## entity:analysis-result
The AI-generated analysis produced by the --analyze tool for a given CSV input. Ephemeral — streamed to stdout, not persisted to disk.

Fields:
- source_csv: string, required — FK reference to entity:csv-input.path
- prompt_tokens: integer, optional — tokens sent to the AI model # inferred
- response_text: string, required — the raw text response from the AI model, written to stdout
- model: string, required — the AI model ID used (sourced from AI_MODEL env var)

State machine: none (write-once ephemeral artifact; streamed to stdout, not stored)

owned-by: actor:operator

---

## entity:tool-invocation
A single execution of `consumption-analyzer` with a given flag and arguments. Represents one run of the CLI.

Fields:
- flag: string, required — the feature flag used (e.g. `--pdf2csv`)
- args: string[], required — positional arguments passed after the flag
- exit_code: integer, required — 0 (success), 1 (user error), 2 (processing failure)
- error_message: string, optional — human-readable error written to stderr on non-zero exit
- timestamp: datetime, optional # inferred

State machine:
- invoked → success (exit 0)
- invoked → user-error (exit 1)
- invoked → processing-failure (exit 2)

owned-by: actor:operator

---

## entity:cacv-record
A single row of the cACV source data after parsing from CSV. Represents one product's target and actual consumption for one month. Produced by --transform, stored in memory and written to the portfolio JSON.

Fields:
- solution_area: string, required — top-level grouping (e.g. "Finance and Spend Management")
- sub_solution_area: string, required — second-level grouping (e.g. "Procurement")
- logical_product: string, required — product name (e.g. "Ariba Buying and Invoicing")
- product_id: string, required — LPR product identifier (e.g. "LPR746"); same LPR code may appear across multiple sub_solution_areas or customers
- customer_id: string, optional — customer identifier parsed from combined "Name (ID)" field via parseCustomerRaw(); null in single-customer CSVs. Note: employee_id is not a field — customers are identified by customer_id only.
- month: string, required — YYYYMM format (e.g. "202601")
- cacv_target: number, required — budgeted cACV value in dollars
- cacv_actual: number, required — actual cACV value in dollars; for FY2024/FY2025 historical rows where both cacv_act and cacv_target are empty, delta_cacv (col 7 "Δ cACV to BUD") is used as actuals proxy when positive (0 for future months)
- delta_cacv: number, optional — value of "Δ cACV to BUD" column; used as actuals fallback for historical rows with empty cacv_act
- is_future_month: boolean, required — true if month >= current month (actuals not yet reported)

State machine: none (read-only intermediate representation; no lifecycle)

owned-by: actor:operator

---

## entity:product-metrics
Computed metrics for a single product across all months in the fiscal year. Produced by --transform from a set of entity:cacv-record entries. In the new portfolio.json hierarchy, this entity is nested under entity:sub-solution-area (i.e. products[] lives inside sub_solution_areas[], not at the customer root level).

Fields:
- lpr: string, required — LPR product code (e.g. "LPR868"); canonical product identifier
- name: string, required — logical product name (e.g. "Ariba Buying and Invoicing")
- logical_product_id: string, required — composite uniqueness key `customer_id|solution_area|sub_solution_area|lpr`; used as the grouping and reconciler key
- product_id: string, required — alias for lpr; retained for backward compatibility with reconciler checks
- solution_area: string, required — FK to parent entity:solution-area.name
- sub_solution_area: string, required — FK to parent entity:sub-solution-area.name
- ytd_target: number, required — sum of targets for reported (non-future) months; computed using integer-safe arithmetic (multiply by 100, sum as integers, divide)
- ytd_actuals: number, required — sum of actuals for reported (non-future) months; same precision rule
- ytd_attainment_pct: number, required — `Math.round((actuals / target) * 1000) / 10` — 1 decimal precision; null if ytd_target = 0
- ytd_acv_act: number, required — ACV actuals figure for the YTD period # inferred
- contract_utilization_pct: number, required — utilization percentage against contract value # inferred
- monthly_series: object[], required — array of {month, target, actual, attainment_pct, gap, is_future_month}
- trend_direction: string, required — one of: up, down, flat (based on last 3 reported months)
- fy_target_total: number, required — full-year target including future months
- year_end_forecast: number, required — projected year-end actuals based on current attainment trend
- year_end_attainment_pct: number, required — year_end_forecast / fy_target_total * 100; 1 decimal precision
- forecast_confidence: string, required — one of: high, medium, low # inferred
- risk_level: string, required — one of: Critical, High, Medium, Low, OnTrack, NoData
- insight: string | null, required — AI-generated architectural insight; null until --analyze has been run
- recommendation: string | null, required — AI-generated recommendation; null until --analyze has been run
- ea_action: string | null, required — EA-specific action derived from AI analysis; null until --analyze has been run

Computation precision rules:
- All financial summations use integer-safe arithmetic: `Math.round(val * 100)` per value, sum as integers, then divide by 100
- Attainment %: `Math.round((actuals / target) * 1000) / 10` (1 decimal precision; null if target = 0)
- Reconciliation tolerances are proportional: `max(0.01, 0.001 * magnitude)` — not a flat 0.01

State machine: none (computed artifact; derived on every --transform run; AI fields populated by --analyze)

owned-by: actor:operator

---

## entity:portfolio-json
The top-level structured JSON file written to disk by --transform and read by --dashboard. Customers are the top-level grouping; products are nested inside sub_solution_areas (not at the customer root). Filename convention: `<source-basename>-portfolio.json` in data/.

Fields:
- generated_at: datetime, required — ISO 8601 timestamp of when --transform ran
- reporting_month: string, required — latest month with non-zero actuals (YYYYMM)
- fiscal_year: string, required — e.g. "FY2026"
- customer_count: integer, required — number of distinct customers in the dataset
- industry: string, required — inferred from customer name + product portfolio fingerprint (e.g. "Pharma/Life Sciences", "Manufacturing", "Healthcare"); populated by STORY-006
- customers: entity:customer-portfolio[], required — one entry per distinct customer
- summary: object, required — portfolio-level rollup:
  - total_ytd_target: number
  - total_ytd_actuals: number
  - overall_attainment_pct: number (1 decimal precision)
- ai_insights: object | null — structured AI insights block written by --analyze; contains pulse_narrative, per_customer, executive_view, and other insight fields; null until --analyze has run

State machine: none (write-once output artifact per --transform run; AI fields populated in-place by --analyze)

owned-by: actor:operator

---

## entity:customer-portfolio
One customer's full portfolio entry within entity:portfolio-json. Contains a summary (SA-level, no products) and the full nested solution area hierarchy (including products at the sub-SA level).

Fields:
- customer_id: string, required — parsed from combined "Name (ID)" field via parseCustomerRaw()
- customer_name: string, required — display name parsed from the same combined field
- summary: object, required — customer-level rollup (consumed by Executive/Regional Head view):
  - total_ytd_target: number
  - total_ytd_actuals: number
  - overall_attainment_pct: number (1 decimal precision)
- solution_areas: entity:solution-area[], required — full nested hierarchy (consumed by EA view)
- risk_items: entity:risk-classification[], required — products flagged by risk engine; contains product_id, logical_product, solution_area, risk_level, risk_reason, ytd_target, months_remaining, urgency_score (recommendation field removed)

owned-by: actor:operator

---

## entity:solution-area
One solution area within a entity:customer-portfolio entry.

Fields:
- name: string, required — e.g. "Finance and Spend Management"
- ytd_target: number, required
- ytd_actuals: number, required
- attainment_pct: number, required — 1 decimal precision
- sub_solution_areas: entity:sub-solution-area[], required

owned-by: actor:operator

---

## entity:sub-solution-area
One sub-solution area within a entity:solution-area entry. Products are nested here — this is the leaf-bearing level of the hierarchy.

Fields:
- name: string, required — e.g. "Procurement"
- ytd_target: number, required
- ytd_actuals: number, required
- attainment_pct: number, required — 1 decimal precision
- products: entity:product-metrics[], required — all products belonging to this sub-SA for this customer

owned-by: actor:operator

---

## entity:risk-classification
A risk assessment record for a single product. Produced by the risk classification engine inside --transform. Part of entity:customer-portfolio.risk_items.

Fields:
- product_id: string, required — FK to entity:product-metrics.lpr (LPR code)
- logical_product: string, required
- solution_area: string, required
- risk_level: string, required — Critical | High | Medium | Low | OnTrack | NoData
- risk_reason: string, required — which business rule triggered this classification
- ytd_target: number, required — dollar value context for urgency calculation
- months_remaining: integer, required — months left in fiscal year after reporting_through_month
- urgency_score: number, required — derived from months_remaining × attainment_gap × ytd_target # inferred

Note: recommendation field removed from risk_items in the new hierarchy. Recommendations are now per-product AI fields (entity:product-metrics.recommendation).

State machine: none

owned-by: actor:operator

---

## entity:recommendation
A rule-based action recommendation for an at-risk product. Produced deterministically by --transform (or --dashboard at render time) from entity:risk-classification.

Fields:
- product_id: string, required — FK to entity:risk-classification.product_id
- risk_level: string, required — inherited from risk-classification
- who_to_speak_to: string[], required — mapped roles (e.g. ["CSM", "EA"] for zero-utilization)
- message_template: string, required — short templated phrase (e.g. "Utilization gap detected — schedule enablement session")
- urgency: string, required — one of: immediate | this-month | this-quarter
- suggested_actions: string[], required — 3–5 concrete steps

State machine: none

owned-by: actor:operator

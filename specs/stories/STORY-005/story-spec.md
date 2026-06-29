---
story_id: STORY-005
title: "3-pane HTML dashboard generation (--dashboard)"
depends_on: [STORY-004]
reads:
  actors:    [operator, stakeholder]
  data:      [portfolio, industry_insight, customer, solutions_l1, solutions_l2, solutions_l3, contract, contract_month]
  contracts: [portfolio-json, industry-insight-shape, customer-shape, solutions-l1-shape, solutions-l2-shape, solutions-l3-shape, contract-block-shape, contract-month-shape, error-envelope]
  patterns:  [cli-dispatch, html-generation, exit-code-contract]
  ux:        [component-conventions, screen-template]
---

## Criteria
1. `consumption-analyzer --dashboard <portfolio.json>` writes `<source-basename>-dashboard.html` to `data/`; output path written to stdout on success; exits 0.
2. Generated HTML opens as `file://` in any modern browser with zero internet access — Bootstrap 5 CSS, Bootstrap JS, and Bootstrap Icons are inlined at generation time from `node_modules`; Chart.js is inlined; no CDN fetches at view time.
3. Page load renders INDUSTRY view: left pane lists all industries from `industry_insights[]` with aggregated annual_contract_value, budget_contract_value, consumed_contract_value (summed from L3 walk across all customers in the industry) and inline expand/collapse for industry_insights[].summary; middle pane shows customer cards for selected industry; no right pane on initial load.
4. Clicking a customer renders that customer's panel showing: customer name, enterprise_architecture_insights (with [insight]/[action] badge icons; fallback "Run --analyze to generate insights" when empty), YTD Budget/Consumed/ACV + Full-Year Budget/Consumed derived by customerAnnualTotals() (L3 walk: sum `projected_annual_budget_contract_value` and `projected_annual_consumed_contract_value` from the latest populated month per L3 per year across all L3s under the customer); if `customer.enterprise_architecture_diagram` is a non-empty string a Mermaid block diagram is rendered before the L1 solution areas — if empty or missing the block is skipped entirely; L1 breakdown always expanded — each L1 tile shows solution_architecture_insights with badges, YTD Budget Attainment, YTD Budget/Consumed bars, Full-Year Budget/Consumed footer derived by l1AnnualTotals() (same L3 walk scoped to that L1's L3s, denominator-zero safe); clicking an L1 tile opens L3 drawer in right pane showing contract_insights per L3 product grouped by L2; right pane does not render on customer selection alone.
5. `customer.enterprise_architecture_diagram` non-empty: Mermaid block diagram renders in customer panel before L1 solution areas, using Mermaid.js (CDN link conditionally injected into generated HTML only when at least one customer has a non-empty diagram); if all customers have empty or missing diagram, no Mermaid script tag is emitted.
6. All AI insight arrays (contract_insights, solution_architecture_insights, enterprise_architecture_insights, industry_insights[].summary) display fallback text when empty — no null errors; [insight] prefix renders blue lightbulb badge, [action] prefix renders amber lightning bolt badge; insight sections are always-visible Bootstrap card frames.
7. Right pane chart: Chart.js line chart per L3 product — three datasets (ACV, budget, consumed) reading ytd_annual_contract_value, ytd_budget_contract_value, ytd_consumed_contract_value; months filtered to exclude entries beyond portfolio.reporting_month; data labels on each point; values as abbreviated USD; budget_attainment as percentage with 1 decimal; Full-Year Budget/Consumed shown as single values derived from projected_annual_* fields via l3AnnualTotals().
8. All chart colors use semantic constants per ux:visual-system (C_ACV, C_BUDGET, C_CONSUMED, C_PCT); no RAG/threshold coloring; language standard enforced: "consumed" not "actuals", "budget" not "target".
9. Missing or unreadable input file exits 1 with contract:error-envelope; malformed JSON exits 2; all errors to stderr.

## Interfaces
--dashboard <portfolio.json>
  auth:     actor:operator (no auth — local CLI)
  guard:    file must exist and parse as valid contract:portfolio-json
  response: output path written to stdout; HTML file written to data/<source-basename>-dashboard.html
  errors:   exit 1 — file not found or missing arg; exit 2 — JSON parse failure or write error

## Permissions
- actor:operator — invokes --dashboard; reads contract:portfolio-json; writes HTML output to data/
- actor:stakeholder — read-only consumer of generated HTML; no CLI access

## State
No state transitions — read-only consumption of contract:portfolio-json; write-once HTML output per run.
- full machine: data:portfolio (produced/enriched states defined in data-model)

## Data
- owns: data:portfolio (reads all fields; no mutation)
- reads: data:industry_insight (industry, summary)
- reads: data:customer (customer, industry, enterprise_architecture_insights, enterprise_architecture_diagram, solutions_l1 tree)
- reads: data:solutions_l1 (name, solution_architecture_insights, solutions_l2)
- reads: data:contract_month (month, ytd_annual_contract_value, ytd_budget_contract_value, ytd_consumed_contract_value, projected_annual_budget_contract_value, projected_annual_consumed_contract_value, variances.ytd_acv_gap, variances.ytd_budget_gap, variances.ytd_budget_attainment)
- new fields: none

## Change history
| release | date | summary | source |
|---------|------|---------|--------|
| 2.4.0 | 2026-06-26 | Gap merged: pure CSS replaces Bootstrap; file size criterion updated; AI_MAX_TOKENS raised to 8192 | gap-merge |
| 3.0.0 | 2026-06-27 | Re-spec: three-panel layout, two views (EA/Exec), nested hierarchy, AI companion panel | re-spec |
| 3.0.0 | 2026-06-27 | Gap merged: v3 nested hierarchy traversal, product.name display, industry tag, output naming fix | gap-merge |
| 3.1.0 | 2026-06-27 | Gap merged: ea_action deduplicated; forecast fields removed | gap-merge |
| 3.2.0 | 2026-06-27 | Gap merged: semantic color scheme, RAG removed, waterfall SVG, architectural signals, language standards | gap-merge |
| 3.3.0 | 2026-06-28 | Re-spec: clean-slate rewrite — 3-pane unified view (no role tabs), new entity names, new metric names, stakeholder actor, Bootstrap 5 inlined | re-spec |
| 3.4.0 | 2026-06-28 | Gap merged: pattern:html-generation updated — separate template.js module no longer required; all HTML generation kept inline in dashboard.js | gap-merge |
| 3.5.0 | 2026-06-28 | Gap merged: industry insights inline in left pane; L1 breakdown always expanded; right pane driven by L1 selection (selectL1); line charts replace monthly tables; AI insights always-visible card frames | gap-merge |
| 4.1.3 | 2026-06-29 | Schema restructure: customer panel shows enterprise_architecture_insights (was account_insights); L1 tiles show solution_architecture_insights (was enterprise_architecture_insights); ACCOUNT filter level removed from Signals view | gap-merge |
| 4.2.0 | 2026-06-29 | Gap merged: Signals view removed; INDUSTRY/ACCOUNTS two-view layout; ytd_* field names in charts; annual_contract_values Full-Year metrics; [insight]/[action] badge icons; L1 tile YTD attainment bars | gap-merge |
| 4.3.0 | 2026-06-29 | Gap merged: Mermaid diagram block in customer panel (conditional CDN inject, graceful degradation); l1AnnualBudget proportional allocation from customer.annual_contract_values (denominator-zero safe) | gap-merge |
| 4.4.0 | 2026-06-29 | Gap merged: Full-Year Budget/Consumed derived from projected_annual_* fields via L3 walk (l3AnnualTotals/l1AnnualTotals/customerAnnualTotals); removed customer.annual_contract_values and industry_insights[].aggregated_contracts reads; variance reads confirmed as ytd_* prefixed | gap-merge |

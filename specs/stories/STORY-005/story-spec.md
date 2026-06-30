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
3. Page load renders INDUSTRY view: left pane lists all industries with 6 metrics per row in order Consumed → Budget → ACV for YTD group then Projected group (portProjConsumed/portProjBudget/portProjAcv computed via customerAnnualTotals() walk); inline expand/collapse for industry_insights[].summary; middle pane shows customer cards for selected industry; no right pane on initial load.
4. Clicking a customer renders that customer's panel: customer name, enterprise_architecture_insights ([insight]/[action] badges; fallback "Run --analyze to generate insights" when empty), metrics in Consumed → Budget → ACV order for YTD group then Projected group (Proj Consumed in C_PROJ_CONSUMED #7c3aed); Full-Year derived by customerAnnualTotals() L3 walk; Mermaid diagram rendered before L1 areas when `enterprise_architecture_diagram` is non-empty (skipped otherwise); L1 breakdown always expanded — each tile shows solution_architecture_insights, YTD Budget Attainment bar, YTD Budget/Consumed bars, Proj Consumed footer via l1AnnualTotals() (denominator-zero safe); clicking an L1 tile opens L3 drawer in right pane grouped by L2; right pane does not render on customer selection alone.
5. `customer.enterprise_architecture_diagram` non-empty: Mermaid block diagram renders in customer panel before L1 solution areas, using Mermaid.js (CDN link conditionally injected into generated HTML only when at least one customer has a non-empty diagram); if all customers have empty or missing diagram, no Mermaid script tag is emitted.
6. All AI insight arrays (contract_insights, solution_architecture_insights, enterprise_architecture_insights, industry_insights[].summary) display fallback text when empty — no null errors; [insight] prefix renders blue lightbulb badge, [action] prefix renders amber lightning bolt badge; insight sections are always-visible Bootstrap card frames.
7. Right pane chart: Chart.js line chart per L3 product — three datasets in order Consumed (C_CONSUMED) first, Budget (C_BUDGET) second, ACV (C_ACV) third; reading ytd_consumed_contract_value, ytd_budget_contract_value, ytd_annual_contract_value; months filtered to exclude entries beyond portfolio.reporting_month; data labels on each point; values as abbreviated USD; budget_attainment as percentage with 1 decimal; Full-Year Budget/Consumed + Proj Consumed shown as single values derived from projected_annual_* fields via l3AnnualTotals(); per-customer donut section shows Proj Consumed in C_PROJ_CONSUMED alongside Proj Budget and Proj ACV.
8. All chart colors and metric ordering follow ux:visual-system constants (C_ACV, C_BUDGET, C_CONSUMED, C_PROJ_CONSUMED, C_PCT); Consumed → Budget → ACV order enforced on all surfaces (top nav, industry bar, customer cards, L1 tiles, donut cards, L3 drawer tabs); industry header strip shows 8 metrics: 6 dollar metrics (YTD Consumed · YTD Budget · YTD ACV · Proj Consumed · Proj Budget · Proj ACV) plus YTD Att% (C_PCT, via attPct()) and Proj Att% (projected color constant); top nav header shows "YTD Consumed $x · YTD Budget $x · YTD ACV $x | Proj Consumed $x · Proj Budget $x · Proj ACV $x" with labels in #64748b and values in semantic colors; no RAG/threshold coloring; language standard enforced: "consumed" not "actuals", "budget" not "target".
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
| ≤3.2.0 | 2026-06-26/27 | Pre-respec history: CSS/Bootstrap swap; v3 hierarchy; ea_action dedup; semantic colors; RAG removed | gap-merge |
| 3.3.0 | 2026-06-28 | Re-spec: clean-slate rewrite — 3-pane unified view (no role tabs), new entity names, new metric names, stakeholder actor, Bootstrap 5 inlined | re-spec |
| 3.4.0 | 2026-06-28 | Gap merged: pattern:html-generation updated — separate template.js module no longer required; all HTML generation kept inline in dashboard.js | gap-merge |
| 3.5.0 | 2026-06-28 | Gap merged: industry insights inline in left pane; L1 breakdown always expanded; right pane driven by L1 selection (selectL1); line charts replace monthly tables; AI insights always-visible card frames | gap-merge |
| 4.1.3 | 2026-06-29 | Schema restructure: customer panel shows enterprise_architecture_insights (was account_insights); L1 tiles show solution_architecture_insights (was enterprise_architecture_insights); ACCOUNT filter level removed from Signals view | gap-merge |
| 4.2.0 | 2026-06-29 | Gap merged: Signals view removed; INDUSTRY/ACCOUNTS two-view layout; ytd_* field names in charts; annual_contract_values Full-Year metrics; [insight]/[action] badge icons; L1 tile YTD attainment bars | gap-merge |
| 4.3.0 | 2026-06-29 | Gap merged: Mermaid diagram block in customer panel (conditional CDN inject, graceful degradation); l1AnnualBudget proportional allocation from customer.annual_contract_values (denominator-zero safe) | gap-merge |
| 4.4.0 | 2026-06-29 | Gap merged: Full-Year Budget/Consumed derived from projected_annual_* fields via L3 walk (l3AnnualTotals/l1AnnualTotals/customerAnnualTotals); removed customer.annual_contract_values and industry_insights[].aggregated_contracts reads; variance reads confirmed as ytd_* prefixed | gap-merge |
| 4.5.0 | 2026-06-29 | Gap merged: Projected Consumed added to all surfaces (C_PROJ_CONSUMED #7c3aed); 6-metric industry bar; Consumed→Budget→ACV order enforced everywhere; top nav format updated; portfolio-level portProjAcv/portProjBudget/portProjConsumed via customerAnnualTotals(); C_PROJ_CONSUMED added to ux:visual-system | gap-merge |
| 4.6.0 | 2026-06-30 | Gap merged: YTD Att% (C_PCT via attPct()) and Proj Att% (projected color constant) tiles added to industry header strip; 6-metric bar becomes 8-metric bar; ux:component-conventions and ux:screen-template updated | gap-merge |

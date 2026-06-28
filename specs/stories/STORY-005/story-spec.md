---
story_id: STORY-005
title: "HTML dashboard generation (--dashboard)"
depends_on: [STORY-004]
reads:
  actors:    [operator, executive, ea]
  data:      [portfolio-json, customer-portfolio, solution-area, sub-solution-area, product-metrics]
  contracts: [portfolio-json, customer-portfolio-shape, solution-area-shape, sub-solution-area-shape, product-in-subsa-shape, risk-item, error-envelope]
  patterns:  [cli-dispatch, html-generation, exit-code-contract]
  ux:        [component-conventions, screen-template]
---

## Criteria
1. `consumption-analyzer --dashboard <portfolio.json>` writes a single HTML file to the same directory as input, named `<source-basename>-dashboard.html`; output path written to stdout on success.
2. Generated HTML opens as a `file://` URL in any modern browser with zero internet access — Chart.js is fetched from CDN at generation time and inlined; pure CSS and inline SVG are used for all styling and icons (no Bootstrap); if any CDN fetch fails, a `warn:` is emitted to stderr and the asset is omitted gracefully.
3. Three-panel layout: left rail (role-switcher tabs + collapsible navigation tree, Architectural Signals section between Customers and Portfolio KPIs), center panel (view-specific content), right companion panel (AI insights for selected item; all sections show "Run --analyze" fallback when AI fields are null).
4. Two views switchable via left rail role tabs: **EA view** renders full customer → SA → Sub-SA → product hierarchy; **Executive view** renders a portfolio KPI banner + per-customer health cards with SA-level attainment only — no product rows.
5. EA view LPR rows: waterfall SVG chart (3 bars: ACV / Target / cACV, scaled to ACV ceiling, inline USD labels, ghost gap fill) + monthly attainment line chart below waterfall (dots per month in C_CACV, att% labels in C_PCT, dashed 100% reference line, month labels); ea_action surfaces once only under a numbered "EA Priority Actions" list — no standalone EA Action block.
6. Executive view: portfolio banner shows overall_attainment_pct, total_ytd_actuals, total_ytd_target, portfolio ACV; customer cards show attainment %, customer_name, industry (if present), and SA-level rollup — no product detail.
7. Companion panel for customer selection: `renewal_risks[]` renders product name + risk narrative + recommended engagement; `momentum[]` renders title + architectural significance + expansion opportunity; `recommended_ask_rationale` renders as muted grey context sentence above the Ask; insight/recommendation/ea_action for product rows (null → graceful "Run --analyze" empty state); no forecast fields displayed.
8. No RAG/threshold coloring anywhere; all color derives from semantic constants per ux:component-conventions (C_CACV orange, C_TARGET green, C_ACV grey, C_PCT royal blue); dollar+label pairs rendered in same semantic color; architectural signals section in left rail uses warning icon (orange) as bullet, word-wrapped titles with separators, clickable to open `showSignalPopup()` (customers affected, pattern, explanation, EA action — no signal type label).
9. Missing or unreadable input file exits code 1 with contract:error-envelope on stderr; malformed JSON exits code 2; successful run exits code 0.
10. All dashboard data comes from the embedded portfolio JSON constant (no runtime fetch or XHR); the embedded constant uses the full contract:portfolio-json shape.

## Interfaces
--dashboard <portfolio.json>
  auth:     actor:operator (no auth — local CLI)
  guard:    input file must exist and parse as valid contract:portfolio-json
  response: output path written to stdout (plain string); HTML file written to disk
  errors:   exit 1 — file not found or missing arg; exit 2 — JSON parse failure or write error

## Permissions
- actor:operator — invokes --dashboard; reads contract:portfolio-json; writes HTML output file
- actor:executive, actor:ea — read-only consumers of generated HTML; no CLI access

## State
No state transitions — read-only consumption of contract:portfolio-json; write-once HTML output per run.

## Data
- owns: data:portfolio-json (reads all fields to build embedded constant)
- reads: data:customer-portfolio (summary, solution_areas, risk_items per customer)
- reads: data:sub-solution-area (products[] navigation in EA view)
- reads: data:product-metrics (ytd_attainment_pct, ytd_actuals, ytd_target, ytd_acv_act, monthly_series, trend_direction, insight, recommendation, ea_action)
- new fields: none

## Change history
| release | date | summary | source |
|---------|------|---------|--------|
| 2.4.0 | 2026-06-26 | Gap merged: pure CSS replaces Bootstrap; file size criterion updated to data-driven bound; AI_MAX_TOKENS raised to 8192; ai_insights and ai_config added to contract:portfolio-json | gap-merge |
| 3.0.0 | 2026-06-27 | Re-spec: three-panel layout, two views (EA/Exec), nested hierarchy (customer→SA→SubSA→product), AI companion panel, null-safe insight fields, risk classification display removed | re-spec |
| 3.0.0 | 2026-06-27 | Gap merged: v3 nested hierarchy traversal (products at sub_solution_areas[].products[]), product.name display (lpr fallback), insight/recommendation/ea_action on product object, industry tag on EA/Exec views, YTD Budget rail KPI, output naming fix | gap-merge |
| 3.1.0 | 2026-06-27 | Gap merged: ea_action deduplicated (standalone EA Action block removed; surfaces only via EA Priority Actions list); forecast fields (year_end_attainment_pct, forecast_confidence) removed from LPR companion | gap-merge |
| 3.2.0 | 2026-06-27 | Gap merged: semantic color scheme (C_CACV/C_TARGET/C_ACV/C_PCT), RAG coloring removed, EA view waterfall SVG + monthly attainment chart, architectural signals left rail section, companion renewal_risks/momentum/recommended_ask_rationale, language standards, percentage alignment | gap-merge |

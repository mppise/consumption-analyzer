# Deploy Artifact — Release 4.1.0
**Date:** 2026-06-28  **Status:** deployed
**Platform:** local-npm (npm install + npm link)

## Release summary

Minor release (4.0.1 → 4.1.0). All 6 stories deployed. STORY-005 (3-pane HTML dashboard) completes its first full deployment. Deploy script updated to v4.1.0 schema: solutions_l1/l2/l3 hierarchy, 5-step AI pipeline prompt templates, 3-pane left-drives-right navigation checks, AI-powered industry inference (23 SAP verticals).

## Stories in this release

| Story | Title | Language | Build command | Release type |
|-------|-------|----------|---------------|--------------|
| STORY-001 | CLI scaffold and entry point | node | npm install && npm link | minor |
| STORY-002 | PDF to CSV conversion (--pdf2csv) | node | npm install | minor |
| STORY-003 | AI-powered analysis — 5-step bottom-up pipeline (--analyze) | node | npm install | minor |
| STORY-004 | CSV to JSON transformation with new portfolio schema (--transform) | node | npm install | minor |
| STORY-005 | 3-pane HTML dashboard generation (--dashboard) | node | npm install | minor |
| STORY-006 | Industry vertical inference | node | npm install | minor |

## Deployment order
1. STORY-001 — CLI scaffold and entry point (no dependencies)
2. STORY-002 — PDF to CSV conversion (depends on STORY-001)
3. STORY-003 — AI-powered analysis (depends on STORY-001)
4. STORY-004 — CSV to JSON transformation (depends on STORY-001)
5. STORY-005 — 3-pane HTML dashboard generation (depends on STORY-004)
6. STORY-006 — Industry vertical inference (depends on STORY-004)

## Generated files

| File | Purpose |
|------|---------|
| specs/deploy.sh | Deploy script — npm install + npm link + flag verification (v4.1.0 checks) |
| package.json | Version stamped to 4.1.0 |
| specs/deploy-artifact.md | This file |

## Checks

| Check | Result |
|-------|--------|
| Gate: all stories built | pass |
| Gate: build-report overall_status | pass (all 6 stories) |
| Gate: architecture.md present with Artifact Index | pass |
| Gate: deployment.md present with deployment:target | pass |
| Dependency order resolved | pass (topological: 001→002, 001→003, 001→004→005, 001→004→006) |
| Runtime profiles read from build-report.yaml | pass (all 6 stories) |
| Platform target | local-npm |
| Version stamp method | npm version field in package.json → 4.1.0 |
| deploy.sh syntax check | pass |
| npm install | pass |
| npm link | pass |
| Binary linked at PATH | pass |
| consumption-analyzer --version | 4.1.0 |
| Flag --pdf2csv in --help | pass |
| Flag --analyze in --help | pass |
| Flag --transform in --help | pass |
| Flag --dashboard in --help | pass |
| Flag --output in --help | pass |
| --transform end-to-end (CACV_CROSS_FC_OPS_DIBO_REPORT.csv) | pass |
| portfolio.json customers array | pass |
| portfolio.json solutions_l1/l2/l3 hierarchy | pass |
| portfolio.json customer.industry populated | pass |
| portfolio.json contract.contract_insights slot | pass |
| portfolio.json no fy_target_total | pass |
| portfolio.json no risk_items[] | pass |
| --dashboard end-to-end (portfolio.json) | pass |
| dashboard.html no CDN references | pass |
| dashboard.html 3-pane layout (industry→customer→detail) | pass |
| dashboard.html account_insights rendered | pass |
| dashboard.html contract_insights rendered | pass |
| dashboard.html enterprise_architecture_insights rendered | pass |
| dashboard.html no year_end_attainment_pct | pass |
| dashboard.html inline scripts parse without SyntaxError | pass |
| project-state.yaml all deployed:true | pass |

## Deployment history

| Release | Date | Platform |
|---------|------|----------|
| 1.0.0 | 2026-06-25 | local-npm |
| 1.1.0 | 2026-06-25 | local-npm |
| 1.2.0 | 2026-06-25 | local-npm |
| 1.3.0 | 2026-06-26 | local-npm |
| 2.0.0 | 2026-06-26 | local-npm |
| 2.1.0 | 2026-06-26 | local-npm |
| 2.2.0 | 2026-06-26 | local-npm |
| 2.3.0 | 2026-06-26 | local-npm |
| 2.4.0 | 2026-06-26 | local-npm |
| 2.5.0 | 2026-06-26 | local-npm |
| 2.5.1 | 2026-06-26 | local-npm |
| 2.6.0 | 2026-06-26 | local-npm |
| 3.0.0 | 2026-06-27 | local-npm |
| 3.1.0 | 2026-06-27 | local-npm |
| 3.2.0 | 2026-06-27 | local-npm |
| 3.3.0 | 2026-06-27 | local-npm |
| 4.0.0 | 2026-06-28 | local-npm |
| 4.0.1 | 2026-06-28 | local-npm |
| 4.1.0 | 2026-06-28 | local-npm |

## Environment variables required

| Variable | Required for | Notes |
|----------|-------------|-------|
| DATA_DIR | all commands | Default: ./data |
| LOG_LEVEL | all commands | silent / info / debug |
| PDF_MAX_PAGES | --pdf2csv | 0 = all pages |
| CSV_DELIMITER | --pdf2csv | Default: , |
| AI_API_KEY | --analyze, --transform (STORY-006 inferIndustry) | Anthropic API key |
| AI_MODEL | --analyze (Steps 1-3), --transform (industry inference) | Sonnet model ID |
| AI_MODEL_SENIOR | --analyze (Steps 4-5) | Opus model ID |
| AI_MAX_TOKENS | --analyze | Max tokens per AI response |
| AI_BASE_URL | --analyze, --transform | Custom endpoint; empty = Anthropic default |

--pdf2csv and --dashboard require no AI vars — local file processing only.
--transform requires AI_API_KEY + AI_MODEL for STORY-006 industry inference (inferIndustry is async, AI-powered).

## Development warnings (from build reports — non-blocking)

- STORY-001: deploy.sh flag verification covers [--pdf2csv, --analyze, --transform, --dashboard, --build-product-catalog]; --output is a modifier flag, not a tool flag
- STORY-002: new-format PDFs (CACV_CROSS_FC_OPS_DIBO_REPORT) do not carry a separate lpr column; logical_product_id will be empty in output CSV — downstream --transform parses LPR code from product name
- STORY-003: Steps 4-5 run customers/industries sequentially to respect opus model rate limits
- STORY-004: LPR code parsed from PFHIER_LOGICAL_PRODUCT_DESC column (no standalone logical_product_id in this CSV format)
- STORY-005: Bootstrap Icons woff2 font embedded as base64 data URI for offline-capable dashboard
- STORY-006: inferIndustry() uses AI_MODEL (sonnet) via AIClient — requires AI_API_KEY at runtime; criterion 6 (no AI call) superseded per gap.md

## Manual steps required

None — binary is linked and all flags verified operational.

Script: `specs/deploy.sh`

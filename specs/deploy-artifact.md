# Deploy Artifact — Release 4.1.3
**Date:** 2026-06-28  **Status:** deployed
**Platform:** local-npm (npm install + npm link)

## Release summary

Patch release (4.1.2 -> 4.1.3). All 6 stories deployed. Version bumped in package.json; binary re-linked. No source code changes — maintenance patch release.

## Stories in this release

| Story | Title | Language | Build command | Release type |
|-------|-------|----------|---------------|--------------|
| STORY-001 | CLI scaffold and entry point | node | npm install && npm link | patch |
| STORY-002 | PDF to CSV conversion (--pdf2csv) | node | npm install | patch |
| STORY-003 | AI-powered analysis — 5-step bottom-up pipeline (--analyze) | node | npm install | patch |
| STORY-004 | CSV to JSON transformation with new portfolio schema (--transform) | node | npm install | patch |
| STORY-005 | 3-pane HTML dashboard generation (--dashboard) | node | npm install | patch |
| STORY-006 | Industry vertical inference | node | npm install | patch |

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
| deploy.sh | Deploy script — npm install + npm link + flag verification |
| package.json | Version stamped to 4.1.3 |
| specs/deploy-artifact.md | This file |

## Checks

| Check | Result |
|-------|--------|
| Gate: all stories built | pass |
| Gate: build-report overall_status | pass (all 6 stories) |
| Gate: architecture.md present with Artifact Index | pass |
| Gate: deployment.md present with deployment:target | pass |
| Dependency order resolved | pass (topological: 001->002, 001->003, 001->004->005, 001->004->006) |
| Runtime profiles read from build-report.yaml | pass (all 6 stories) |
| Platform target | local-npm |
| Version stamp method | npm version field in package.json -> 4.1.3 |
| npm install | pass |
| npm link | pass |
| Binary linked at PATH | pass |
| consumption-analyzer --version | 4.1.3 |
| Flag --pdf2csv in --help | pass |
| Flag --analyze in --help | pass |
| Flag --transform in --help | pass |
| Flag --dashboard in --help | pass |
| Flag --build-product-catalog in --help | pass |
| project-state.yaml all deployed:true | pass |
| project-state.yaml release | 4.1.3 |
| project-state.yaml next_release_type | null |
| project-state.yaml active_phase | null |

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
| 4.1.2 | 2026-06-28 | local-npm |
| 4.1.3 | 2026-06-28 | local-npm |

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

Script: `deploy.sh`

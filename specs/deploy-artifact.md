# Deploy Artifact — Release 4.6.0
**Date:** 2026-06-30  **Status:** ready
**Platform:** local-npm (Node.js CLI, no cloud infrastructure)

## Stories in this release

| Story | Title | Language | Build command | Release type |
|-------|-------|----------|---------------|--------------|
| STORY-001 | CLI scaffold and entry point | node | npm install && npm link | prior release |
| STORY-002 | PDF to CSV conversion (--pdf2csv) | node | npm install | prior release |
| STORY-003 | AI-powered analysis — 5-step bottom-up pipeline (--analyze) | node | node src/cli.js | minor |
| STORY-004 | CSV to JSON transformation with new portfolio schema (--transform) | node | npm install | prior release |
| STORY-005 | 3-pane HTML dashboard generation (--dashboard) | node | npm install | minor |
| STORY-006 | Industry vertical inference | node | node src/cli.js --transform <file.csv> | prior release |

## Deployment order
1. STORY-001 — CLI scaffold and entry point
2. STORY-002 — PDF to CSV conversion (--pdf2csv)
3. STORY-003 — AI-powered analysis — 5-step bottom-up pipeline (--analyze)
4. STORY-004 — CSV to JSON transformation with new portfolio schema (--transform)
5. STORY-006 — Industry vertical inference
6. STORY-005 — 3-pane HTML dashboard generation (--dashboard)

## Generated files

| File | Purpose |
|------|---------|
| specs/deploy.sh | Main deploy script — run with --dry-run first |
| specs/.env.example | Environment template — copy to .env and fill values |

## Checks

| Check | Result |
|-------|--------|
| Gate: all stories built | pass |
| Gate: build-report overall_status | pass (all 6 stories) |
| Gate: Artifact Index references deployment | pass |
| Gate: deployment:target present | pass |
| Dependency order resolved | pass (topological: 001->002, 001->003, 001->004->005, 001->004->006) |
| Platform target | local-npm |
| Version stamp method | npm version --no-git-tag-version |
| deploy.sh syntax | pass |
| deploy.sh permissions | pass (executable) |
| .env.example written | pass |
| project-state.yaml all deployed:true | pass |
| project-state.yaml release | 4.6.0 |
| project-state.yaml next_release_type | null |

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
| 4.2.0 | 2026-06-29 | local-npm |
| 4.3.0 | 2026-06-29 | local-npm |
| 4.4.0 | 2026-06-29 | local-npm |
| 4.5.0 | 2026-06-29 | local-npm |
| 4.6.0 | 2026-06-30 | local-npm |

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
| AI_MAX_TOKENS | --analyze | Max tokens per AI response (default: 8192) |
| AI_BASE_URL | --analyze, --transform | Custom endpoint; empty = Anthropic default |
| AI_PIPELINE_CONCURRENCY | --analyze (Steps 1-3) | Max parallel AI calls; default 15 |

--pdf2csv and --dashboard require no AI vars — local file processing only.
--transform requires AI_API_KEY + AI_MODEL for STORY-006 industry inference (inferIndustry is async, AI-powered).

## Development warnings (from build reports — non-blocking)

- STORY-001: deploy.sh flag verification covers [--pdf2csv, --analyze, --transform, --dashboard, --build-product-catalog]; --output is a modifier flag, not a tool flag
- STORY-002: new-format PDFs (CACV_CROSS_FC_OPS_DIBO_REPORT) do not carry a separate lpr column; logical_product_id will be empty in output CSV — downstream --transform parses LPR code from product name
- STORY-003: AI_PIPELINE_CONCURRENCY (default 15) is not yet listed in architecture.md ## Configuration table — added to .env.example and config/index.js; recommend adding to architecture.md in next spec pass
- STORY-003: runWithConcurrency() is implemented inline in analyze.js — if needed elsewhere it should be promoted to src/lib/concurrency.js
- STORY-004: LPR code parsed from PFHIER_LOGICAL_PRODUCT_DESC column (no standalone logical_product_id in this CSV format)
- STORY-005: Bootstrap Icons woff2 font embedded as base64 data URI for offline-capable dashboard; Mermaid CDN script only emitted when at least one customer has a non-empty enterprise_architecture_diagram
- STORY-006: inferIndustry() uses AI_MODEL (sonnet) via AIClient — requires AI_API_KEY at runtime; criterion 6 (no AI call) superseded per gap.md

## Manual steps required

None — binary is linked and all flags verified operational.

Script: `specs/deploy.sh`

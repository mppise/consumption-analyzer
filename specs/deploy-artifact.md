# Deploy Artifact — Release 3.2.0
**Date:** 2026-06-27  **Status:** deployed
**Platform:** local-npm (CLI binary installed via npm link)

## Release summary

Minor release (3.1.0 → 3.2.0). Bug fixes and field removal across STORY-003, STORY-004, STORY-005.

- STORY-003: `stripCodeFences()` fallback regex added — extracts JSON block from anywhere in the AI response, fixing L1 haiku parse failures when the model returns preamble text before the JSON fence
- STORY-004: Forecast fields removed from `product-in-subsa-shape` (`fy_target_total`, `year_end_forecast`, `year_end_attainment_pct`, `forecast_confidence`) and risk classification fields removed from customer shape (`risk_level`, `risk_reason`, `risk_items[]`)
- STORY-005: EA action no longer duplicated — surfaces only via EA Priority Actions list; forecast fields (`year_end_attainment_pct`, `forecast_confidence`) removed from LPR companion panel display

## Stories in this release

| Story | Title | Language | Build command | Release type |
|-------|-------|----------|---------------|--------------|
| STORY-001 | CLI scaffold and entry point | node | npm install && npm link | minor |
| STORY-002 | PDF to CSV conversion (--pdf2csv) | node | npm install | minor |
| STORY-003 | AI-powered cACV analysis (--analyze) | node | node src/cli.js | minor |
| STORY-004 | CSV to JSON transformation (--transform) | node | node src/cli.js --transform \<file.csv\> | minor |
| STORY-005 | HTML dashboard generation (--dashboard) | node | node src/cli.js --dashboard \<portfolio.json\> | minor |
| STORY-006 | Industry vertical inference | node | node src/cli.js | minor |

## Deployment order
1. STORY-001 — CLI scaffold and entry point (no dependencies)
2. STORY-002 — PDF to CSV conversion (depends on STORY-001)
3. STORY-003 — AI-powered cACV analysis (depends on STORY-001)
4. STORY-004 — CSV to JSON transformation (depends on STORY-001)
5. STORY-005 — HTML dashboard generation (depends on STORY-004)
6. STORY-006 — Industry vertical inference (depends on STORY-004)

## Generated files

| File | Purpose |
|------|---------|
| specs/deploy.sh | Main deploy script — run with --dry-run first |
| specs/deploy.sh.old | Backup of previous deploy.sh (Release 3.1.0) |
| specs/.env.example | Environment template — copy to .env and fill values |

## Checks

| Check | Result |
|-------|--------|
| Hard gate: all stories built | pass |
| Hard gate: deployment.md present | pass |
| Hard gate: architecture.md present | pass |
| Dependency order resolved | pass (topological: 001→002, 001→003, 001→004→005, 001→004→006) |
| Runtime profiles read from build-report.yaml | pass (all 6 stories) |
| Platform target | local-npm |
| Version stamp method | npm version 3.2.0 --no-git-tag-version |
| deploy.sh syntax | pass |
| deploy.sh permissions | executable |

## v3.2.0 verification checks added to deploy.sh

| Check | Scope |
|-------|-------|
| v3.2.0: analyze.js stripCodeFences() has fallback regex for preamble text | STORY-003 source |
| v3.2.0: transform.js does not write fy_target_total | STORY-004 source |
| v3.2.0: transform.js does not write year_end_forecast | STORY-004 source |
| v3.2.0: transform.js does not write year_end_attainment_pct | STORY-004 source |
| v3.2.0: transform.js does not write forecast_confidence | STORY-004 source |
| v3.2.0: transform.js does not write risk_items[] on customer | STORY-004 source |
| v3.2.0: dashboard.js no standalone EA Action block | STORY-005 source |
| v3.2.0: dashboard.js has EA Priority Actions list | STORY-005 source |
| v3.2.0: dashboard.js does not display year_end_attainment_pct | STORY-005 source |
| v3.2.0: dashboard.js does not display forecast_confidence | STORY-005 source |
| v3.2.0: portfolio.json product has no fy_target_total | --dry-run runtime (both branches) |
| v3.2.0: portfolio.json product has no year_end_forecast | --dry-run runtime (both branches) |
| v3.2.0: portfolio.json product has no year_end_attainment_pct | --dry-run runtime (both branches) |
| v3.2.0: portfolio.json product has no forecast_confidence | --dry-run runtime (both branches) |
| v3.2.0: portfolio.json customer has no risk_items[] | --dry-run runtime (both branches) |
| v3.2.0: portfolio.json customer has no risk_level | --dry-run runtime (both branches) |
| v3.2.0: portfolio.json customer has no risk_reason | --dry-run runtime (both branches) |
| v3.2.0: dashboard.html has EA Priority Actions list | --dry-run runtime (both branches) |
| v3.2.0: dashboard.html no standalone EA Action label | --dry-run runtime (both branches) |
| v3.2.0: dashboard.html no year_end_attainment_pct | --dry-run runtime (both branches) |
| v3.2.0: dashboard.html no forecast_confidence | --dry-run runtime (both branches) |

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

## Environment variables required

| Variable | Required for | Notes |
|----------|-------------|-------|
| DATA_DIR | all commands | Default: ./data |
| LOG_LEVEL | all commands | silent / info / debug |
| PDF_MAX_PAGES | --pdf2csv | 0 = all pages |
| CSV_DELIMITER | --pdf2csv | Default: , |
| AI_API_KEY | --analyze | API key for AI service |
| AI_MODEL | --analyze | Model ID (e.g. anthropic--claude-4.7-opus for L3) |
| AI_BASE_URL | --analyze | Custom endpoint; empty = Anthropic default |
| AI_MAX_TOKENS | --analyze | 32000 recommended for 3-level pipeline |

--transform and --dashboard require no AI vars — local file processing only.

## Unmerged gap specs (informational)

None — no gap specs remain open at 3.2.0.

## Development warnings (from build reports — non-blocking)

- STORY-002: new-format PDFs (CACV_CROSS_FC_OPS_DIBO_REPORT) do not carry logical_product — only the LPR code. logical_product is empty string in CSV; transform handles gracefully via product.name fallback.
- STORY-003: AIClient requires non-empty baseURL; when AI_BASE_URL is unset, analyze.js falls back to direct Anthropic SDK instantiation.
- STORY-003: L1 haiku uses max_tokens=2000 per sub-SA (parallel via Promise.allSettled); L3 opus requires larger token budget.
- STORY-003: L1 haiku graceful degradation — sub-SA parse failure warns to stderr and continues; product AI fields remain null for that sub-SA.
- STORY-004: monthly_series items emit only {month, target, actual} — contract specifies additional fields but these are stripped to reduce token payload; downstream can compute at render time.
- STORY-004: risk_items[] note — per 3.2.0 spec update, risk_items[] is now fully removed from customer shape (previously retained per 3.1.0 build warning "spec is the contract" — spec updated for 3.2.0).
- STORY-006: STORY-004 build had implemented industry.js with only 6 of 8 rules; STORY-006 corrected to all 8 rules. Final implementation verified against all spec test cases.

## Manual steps required

- MANUAL: back up and restore the data/ directory across reinstalls as needed — it is gitignored and not managed by deploy.sh

Script: `specs/deploy.sh`

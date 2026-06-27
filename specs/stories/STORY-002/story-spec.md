---
story_id: STORY-002
title: "PDF to CSV conversion (--pdf2csv)"
depends_on: [STORY-001]
reads:
  actors:    [operator]
  data:      [pdf-input, csv-output, tool-invocation]
  contracts: [error-envelope, warn-envelope, csv-row, tool-module]
  patterns:  [cli-dispatch, stream-to-stdout, env-config, exit-code-contract]
---

## Criteria
1. Given a valid SAP cACV PDF, the tool writes a CSV to `<input-dir>/<input-basename>.csv`; stdout emits the output file path on success; exit code 0.
2. Output header is exactly: `solution_area,sub_solution_area,logical_product,logical_product_id,month,cacv_target,cacv_actual` — derived by `buildMergedHeader()` followed by `normalizeHeaderToCanonical()`; `HEADER_ALIAS_MAP` is the single source of PDF-label-to-canonical mapping; unknown columns are dropped and missing canonical columns are filled with `''`; neither raw header row appears as a data row.
3. Both old-format PDFs (Measures row first, column labels second) and new-format PDFs (CACV_CROSS_FC_OPS_DIBO_REPORT — reversed row order) are correctly detected by `isCacvHeaderRow()` and produce the same normalized 7-column output.
4. A UTF-8 BOM (`﻿`) at the start of any extracted text cell is stripped before parsing; no BOM character appears in the output CSV.
5. Comma-formatted numbers (e.g. `"22,865"` or `1,234,567.89`) are stripped of commas and quote-wrapping and emitted as plain unquoted numeric strings.
6. Page-noise rows — rows matching the `N - N` pattern, date-only rows, and single-cell metadata rows — are filtered; they do not appear in the output CSV.
7. Exit code 1 when invoked without a filename or the specified file does not exist; stderr receives contract:error-envelope.
8. Exit code 2 when the PDF yields no detectable table rows after header merge or cannot be parsed; stderr receives contract:error-envelope.
9. Per-page warnings and PDF_MAX_PAGES truncation are written to stderr as contract:warn-envelope and do not abort processing.

## Interfaces
`--pdf2csv <file>`
  auth:     actor:operator (no auth — local CLI)
  guard:    argument must be non-empty; file must exist at resolved path
  response: contract:csv-row written to `<input-dir>/<input-basename>.csv`; output path emitted to stdout
  errors:
    - exit 1: missing argument, file not found
    - exit 2: no table rows detected after header merge, corrupt/unreadable PDF

## Permissions
- actor:operator — may invoke `--pdf2csv` with any resolvable file path; no restrictions beyond filesystem access

## State
- invoked → success: trigger: PDF parsed, ≥1 data row written · guard: tables_found >= 1
- invoked → user-error: trigger: missing arg or file not found
- invoked → processing-failure: trigger: no table rows after header merge or parse error
- full machine: data:tool-invocation.state-machine

## Data
- owns: data:csv-output (written to `<input-dir>/<input-basename>.csv`; path derived from PDF input path)
- owns: data:tool-invocation (one record per run)
- reads: data:pdf-input (path, filename, page_count)
- new fields: none

## Change history

| Release | Date       | Summary                                                                                                           | Source     |
|---------|------------|-------------------------------------------------------------------------------------------------------------------|------------|
| 1.0.0   | 2026-06-25 | Gap merged: header-row ordering clarified; stream-to-stdout updated with pdfreader v3 buffering note             | gap-merge  |
| 1.1.0   | 2026-06-25 | Gap merged: clean output mode — headers deduplicated, page-number/date/metadata noise filtered                   | gap-merge  |
| 2.0.0   | 2026-06-26 | Spec rewritten for cACV domain: 2-row header detection, comma-number parsing, normalized 7-column output         | story-spec |
| 3.0.0   | 2026-06-27 | Re-spec: old vs new format detection (isCacvHeaderRow/buildMergedHeader), BOM stripping made explicit criteria   | story-spec |
| 3.0.0   | 2026-06-27 | Gap merged: HEADER_ALIAS_MAP + normalizeHeaderToCanonical canonical projection; BOM cell-level stripping; lpr→logical_product_id alias clarified | gap-merge  |

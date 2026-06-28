# Gap: STORY-004

## Changes
- 2026-06-28 Criterion 3 says `industry: ""` (placeholder until STORY-006) but STORY-006's `inferIndustry()` already existed in src/lib/industry.js from a prior build. Since STORY-006 depends_on STORY-004 and its sole deliverable is the `inferIndustry()` call inside transform.js, calling it here satisfies both STORY-004 (non-null industry field) and STORY-006 (industry populated from deterministic rules). Decision: call `inferIndustry()` in the transform rather than writing a literal empty string — this satisfies STORY-006 criterion 1 ("every customer entry contains a non-null industry string") at zero extra cost.

## Files affected
- src/tools/transform.js — major rewrite for new portfolio schema (L1/L2/L3 hierarchy, renamed metrics, contract_month shape)
- src/lib/metrics.js — not modified (existing functions retained; transform.js no longer calls computeProductMetrics but the module remains valid for --analyze context)

## Side-effects on other stories
- STORY-003 (--analyze): analyze.js already expects the new portfolio schema (customers[].solutions_l1[].solutions_l2[].solutions_l3[] with contract.ai_insights=[], enterprise_architecture_insights=[], etc.) — confirmed compatible, no changes needed.
- STORY-005 (--dashboard): will need to consume the new portfolio schema. The old dashboard.js reads `solution_areas[].sub_solution_areas[].products[]` which no longer exists. STORY-005 must be rewritten.
- STORY-006 (industry inference): inferIndustry() is now called inside STORY-004's transform.js. STORY-006 has no additional implementation work beyond confirming the existing rules and adding unit tests.

## Recommended spec update
- story-spec.md criterion 3: update `industry: ""` to `industry: string (inferred by inferIndustry() from src/lib/industry.js)` to reflect actual behavior.
- architecture.md data-model entity:customer: already accurate (says "determined by STORY-006 industry inference").

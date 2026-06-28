# Gap: STORY-006

## Changes
- 2026-06-28 Rule 3 health/medtech term for Cardinal was coded as `'cardinal health'` (full phrase), requiring the full phrase to be present in the customer name. The spec says `Cardinal → "Healthcare/MedTech"`, meaning a customer named exactly "Cardinal" must match. Term corrected to `'cardinal'` (substring), which still matches "Cardinal Health" as well as bare "Cardinal".

## Files affected
- src/lib/industry.js — healthTerms array: `'cardinal health'` changed to `'cardinal'`
- tests/industry.test.js — new file: 29 unit tests covering all 8 rule branches, the 4 spec-mandated name assertions, fallback behaviour, and null-safety

## Side-effects on other stories
None. The change widens the match for "Cardinal" names only; no other story references healthTerms directly.

## Recommended spec update
The story-spec.md rule 3 list already includes "Cardinal" as the term. No spec change required — the implementation was wrong, the spec was correct. No arch artifact update needed.

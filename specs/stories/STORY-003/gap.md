# Gap — STORY-003: AI-powered analysis

## Changes
- Add Mermaid block diagram generation to Step 3 (runStep3 in analyze.js, lines 425–479). After generating `enterprise_architecture_insights`, make an additional AI call (or extend the existing prompt) to produce a `enterprise_architecture_diagram` Mermaid string representing the customer's SAP solution landscape. Parse and store the result as `customer.enterprise_architecture_diagram`.
- The diagram should reflect the customer's SAP products/solutions derived from their L1/L2/L3 solution data and the enterprise architecture insights already generated in Step 3.

## Files affected
- `src/tools/analyze.js` — runStep3 function (lines 425–540): added `buildSolutionLandscapeText`, `stripMermaidFences` helpers and a second AI call inside runStep3 to generate and store `customer.enterprise_architecture_diagram` as a raw Mermaid string
- `src/ai/step3-enterprise-arch-diagram.md` — new prompt template for the Mermaid diagram generation sub-call in Step 3

## Side-effects on other stories
- STORY-004: must initialize `enterprise_architecture_diagram: ""` stub on customer object in transform.js
- STORY-005: dashboard may render diagram when present (deferred — UX to be defined later)

## Recommended spec update
- STORY-003 Criterion 3: extend to assert `customer.enterprise_architecture_diagram` is a non-empty string after --analyze run on a customer with known solutions
- contracts.md (contract:customer-shape): add `enterprise_architecture_diagram: string` field
- data-model.md (entity:customer): document new field at customer level

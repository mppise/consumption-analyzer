# Architectural Companion — Design Brief
Date: 2026-06-26

## Philosophy
Not a dashboard. An architectural intelligence companion.
- Narrative-first, numbers hidden unless requested
- SAP product-aware reasoning
- Role-aware actions (EA, CSM, MU Lead, Customer CTO)
- Inline micro-interactions — contextual in-place AI responses
- Real-time AI calls at interaction time (browser → local proxy)

## Hierarchy
Customer → Solution Area → Logical Product (fallback: Sub-Solution Area)

## Pages
1. Portfolio Pulse
2. Architectural Signals
3. Product Intelligence
4. Action Center

## Real-time AI
- Browser calls local proxy: POST http://localhost:6655/anthropic/v1/messages
- API key embedded in PORTFOLIO_DATA.ai_config at build time
- Model: opus for all calls

## SAP Product Knowledge (in prompt)
- Ariba = P2P procurement, low util = maverick spend risk
- Concur = T&E, high = travel policy working
- SAP Build = low-code, zero = no citizen dev program, blocks extensions
- Commerce Cloud = revenue, any gap = direct revenue impact
- SAP Digital Payments = treasury, gaps = ERP payment not connected
- Preferred Success = support tier, low = not leveraging entitlement

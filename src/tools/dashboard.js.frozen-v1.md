# Frozen v1 — 2026-06-27

Working state of dashboard.js and cli.js approved by user.

## What's in this version

**Exec view**
- Portfolio pulse strip: YTD Attainment, Consumed cACV, Budget cACV, Contracted ACV, Budget Gap
- Risk/Opportunity bar: two-column, sourced from AI portfolio_risks + portfolio_opportunities
- Color key bar: ≥90% green / 75–89% amber / <75% red
- Customer cards: name + industry tag, actuals/budget/ACV/att%, AI headline, SA rows color-coded by attainment, recommended ask
- Industry perspective section (when >1 industry)
- Companion panel: strategic situation → recommended ask → SA breakdown → QBR prep

**EA view** (frozen, no changes)
- Fused SVG line chart + data table per LPR row
- Bar chart with transparency layering (ACV 90% → budget 60% → cACV 35%)
- Left 28% / right 72% split per LPR

**Left rail**
- Customers → Signals → Portfolio KPIs (order fixed)

**CLI**
- --serve flag: generates dashboard and serves over HTTP (avoids file:// restrictions)
- --dashboard: generates offline HTML file

## Restore
cp src/tools/dashboard.js.frozen-v1 src/tools/dashboard.js
cp src/cli.js.frozen-v1 src/cli.js

# SKU Selection Matrix

Select SKU based on `context.json.intent.budget`. Cross-reference with `intent.scale` for right-sizing.

## Budget Tiers

> ⛔ **Free/shared tiers (App Service F1/D1, Static Web Apps Free) are NOT offered.** Every app requires a managed identity for Azure resource auth, and the free-tier MI sidecar OOMs on Linux; free SWA also lacks CORS/custom-auth config these apps need. The compute floor is **B1 (App Service)** / **Standard (Static Web Apps)**. Never emit F1, D1, or Free.

| Service | cost-optimized | balanced | performance |
|---------|---------------|----------|-------------|
| Container Apps | Consumption (scale-to-zero) | Consumption | Dedicated |
| App Service | B1 (Basic) | B1 / S1 | P1v3 |
| Azure SQL | Basic (5 DTU) | Standard (S0) | Premium / Serverless |
| Cosmos DB | Serverless | Provisioned (400 RU) | Provisioned (autoscale) |
| Storage | Standard_LRS | Standard_GRS | Premium_LRS |
| Static Web Apps | Standard | Standard | Standard |
| Service Bus | Basic | Standard | Premium |
| Redis Cache | Basic C0 | Standard C1 | Premium P1 |
| Functions | Consumption | Flex Consumption | Premium EP1 |
| Log Analytics | PerGB2018 | PerGB2018 | PerGB2018 (dedicated cluster) |

> ⚠️ **Log Analytics `Free` SKU is deprecated.** ARM rejects it with some API versions and retention settings. Always use `PerGB2018` — first 5 GB/month is free anyway.

## Modifier Rules

- `intent.scale = "Large"` (100K+ users) → bump minimum one tier above cost-optimized
- `intent.budget = "performance"` + `intent.scale = "Small"` → don't over-provision; use balanced tier
- Policy denies a SKU → fall back to next available tier (never below the B1 / SWA Standard floor), add to `assumptions[]`
- Cosmos DB Serverless: max 1K RU/s burst, no geo-replication — only for intermittent/dev workloads. Sustained read-heavy → Provisioned.

## Default Behavior

- Single-component app + cost-optimized → cheapest **viable** SKU at or above the floor (App Service B1, Static Web Apps Standard)
- Simple web app with no DB → ~$13–$20/month (B1 minimum — no $0 tier)
- Always output exact SKU codes: "App Service B1 (Basic)" not "cheapest tier"

## Auto-Cheapest for Fast-Track

⛔ **If `prereq-output.json.fastTrackEligible == true` AND `context.json.intent.budget` is unset, treat as `cost-optimized`.** Fast-track means single-component + no DB + no auth + no Dockerfile. Pick **App Service B1 (Basic)** for dynamic apps that need a runtime (Node.js/Python starter templates), or **Static Web Apps Standard** for pure static HTML/JS/CSS with no server-side runtime. The user still sees the SKU + monthly cost in the scaffold approval gate — they can override via "Edit plan". Do NOT ask the user about budget unless they mention cost first (per [intent-gathering.md](../../references/intent-gathering.md)).

⛔ **There is no free promise — fast-track starts at the B1 / SWA Standard floor.** If the chosen floor SKU is unavailable during deploy prep (no B1 quota — see [sku-quota-validation.md](sku-quota-validation.md) § After Checking), fall back to the **cheapest AVAILABLE** tier at or above the floor. Record an `assumptions[]` note stating WHY the SKU differs, so the approval gate presents the resulting cost.

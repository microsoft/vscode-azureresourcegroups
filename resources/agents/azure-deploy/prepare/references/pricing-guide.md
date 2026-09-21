# App Onboard Prepare — Pricing Guide

> ⛔ **SELF-CHECK:** If `costEstimate.breakdown[]` has ANY `monthlyUsd > 0`, this session MUST contain at least one `pricing_get` or `az rest` pricing API call. NEVER estimate from memory/training; reference values may be stale. After 2 API failures, use reference value WITH disclaimer `"⚠️ Estimated from reference — live API unavailable."`

## No Free-Tier Shortcut — Compute Always Has Cost

> ⛔ **There is no $0 shortcut.** Compute has a floor (App Service **B1**, Static Web Apps **Standard**, Functions **Flex Consumption**) — F1/D1/Free/Consumption are never selected (see [sku-matrix.md](sku-matrix.md)). So any app with a compute component has a non-zero monthly cost and MUST get a live pricing call. Do NOT write a $0 estimate for a compute app.

Some services can still fall within free **grant** limits (they are metered, not a fixed free SKU) — note the grant in the estimate but still price the paid meters:

| Service | Free grant (still price paid usage above it) |
|---------|-----------------------------------------------|
| Functions (Flex Consumption) | First 250K executions + 100K GB-s/month |
| Cosmos DB | Free-tier account: 1000 RU/s + 25 GB (one per subscription) |
| Container Apps | First 180K vCPU-s + 360K GiB-s + 2M requests/month |
| Log Analytics | First 5 GB/month ingestion |

---

## App Service Quick Reference

| SKU | `skuName` | Monthly |
|-----|-----------|---------|
| B1 Linux | `B1` | ~$13.14 |

> ⛔ **Case-sensitive:** use `B1` not `b1`. Use `skuName` (not `armSkuName`) for Basic/Standard.

---

## How to Use

1. Choose budget SKU from [sku-matrix.md](sku-matrix.md).
2. Get filters/formulas from service section in [pricing-guide-services.md](pricing-guide-services.md).
3. Call router `mcp_azure_mcp_pricing` (VS Code) / `azure-pricing` (CLI) with `intent`, `command: "pricing_get"`, and `parameters` object, NOT `--flags`. Parallel OK. ⛔ At least one filter inside `parameters`: `sku`, `service`, `region`, `service-family`, or `filter`. ⛔ **`sku` matches `armSkuName`, not `skuName`**; use ONLY for populated `armSkuName` (App Service, MySQL/PostgreSQL, Redis). Empty-`armSkuName` services (ACR, Storage, Cosmos) return `[]` or 400 for `sku`/`service`; instead raw `filter` on `serviceName` + `meterName`.
4. Apply multiplier from each meter's `unitOfMeasure` (§ Monthly Multiplier), NOT per-service constant.
5. Cross-check `retailPrice` with planned SKU.

## Monthly Multiplier — by Meter Unit

⛔ **Read each record's `unitOfMeasure`; NEVER blanket `× 730`**. ACR, for example, mixes `1/Day` + `1 Second` + `1 GB/Month`:

| `unitOfMeasure` | Monthly formula |
|-----------------|-----------------|
| `1 Hour` / `1/Hour` | `retailPrice × 730` |
| `1/Day` / `1 Day` | `retailPrice × 30` |
| `1 GB/Month` | `retailPrice × estimatedGB` (monthly already) |
| `1 Second` / `1 GiB Second` | `retailPrice × activeUnitsPerMonth` (usage-based) |
| `10K` / `1M` operations | `retailPrice × estimatedOps ÷ unitSize` |

## Usage-Based Services

For AI/OpenAI/LLM components, add `"💸 Usage-based — excluded from total"` to `costEstimate.breakdown[]` and `"⚠️🤖 AI inference costs excluded"` to `assumptions[]`. Show at EVERY approval gate.

## Service Pricing Reference

See [pricing-guide-services.md](pricing-guide-services.md) for service filters, meters, formulas.

**Key rules:**
- `armSkuName` is usually empty for PaaS; filter by `meterName` or `productName`
- Read `unitOfMeasure` (§ Monthly Multiplier); never assume ×730
- Functions Consumption / Static Web Apps: not in API
- Default `isPrimaryMeterRegion eq true` + `priceType eq 'Consumption'`; first check [pricing-guide-services.md](pricing-guide-services.md), as Service Bus, Cosmos 100 RU/s, and Redis Basic drop `isPrimaryMeterRegion`.
- Service names are case-sensitive

## Troubleshooting

Empty `pricing_get`: (1) check populated/case-sensitive `armSkuName`; (2) HTTP fallback `https://prices.azure.com/api/retail/prices?$filter={filter}`. (3) After 2 failures, use [pricing-guide-services.md](pricing-guide-services.md) + disclaimer; (4) log `costEstimate.apiFailures[]`.

> ⛔ **Never claim remaining free credits.** Say "Check balance at portal."

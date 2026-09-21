# App Onboard Prepare — Per-Service Pricing Patterns

Azure service filters, meters, formulas. Methodology/troubleshooting: [pricing-guide.md](pricing-guide.md).

### Container Apps

No `armSkuName`. Filter with `serviceName eq 'Azure Container Apps' and armRegionName eq '{region}' and priceType eq 'Consumption' and isPrimaryMeterRegion eq true`

**Key meters:** `Standard vCPU Active Usage` (1 Second), `Standard Memory Active Usage` (1 GiB Second), `Standard Requests` (1M).

**Monthly (Consumption; 1 vCPU, 2 GiB, 8h active/day):**
`(vCPU_active_rate × 3600 × 8 × 30) + (memory_active_rate × 2 × 3600 × 8 × 30)`

**Free grant:** 180K vCPU-sec + 360K GiB-sec + 2M requests/sub/month. Scale-to-zero: $0 idle. For `min_replicas >= 1`, add idle-meter cost.

---

### Container Registry (ACR)

Empty `armSkuName`: ⛔ do NOT filter by `sku` (returns `[]`). Filter `serviceName eq 'Container Registry' and armRegionName eq '{region}' and priceType eq 'Consumption'`, then match `meterName`.

| Tier | `meterName` | `unitOfMeasure` | Monthly |
|------|-------------|-----------------|---------|
| Basic | `Basic Registry Unit` | `1/Day` | `retailPrice × 30` (~$5) |
| Standard | `Standard Registry Unit` | `1/Day` | `retailPrice × 30` (~$20) |
| Premium | `Premium Registry Unit` | `1/Day` | `retailPrice × 30` (~$50) |

⛔ **`1/Day` → × 30, NOT × 730.** Other ACR meters (`Task vCPU Duration` = `1 Second` build compute, `Data Stored` = `1 GB/Month`) are usage-based; exclude from fixed monthly unless builds are heavy. ACR Basic ≈ **$5/mo** fixed.

---

### App Service

**MCP call:** `pricing_get --service "Azure App Service" --region "{region}"`

**Meter-to-SKU mapping:**

| SKU | `meterName` | Notes |
|-----|-------------|-------|
| B1 | `B1` | Compute floor — no F1/Free (see [sku-matrix.md](sku-matrix.md)) |
| B2 | `B2` | |
| S1 | `S1 App` | |
| P1v3 | `P1 v3 App` | Linux/Windows differ by `productName` |

**Gotcha:** Basic/Standard `armSkuName` empty; match `meterName`.

**Monthly:** `retailPrice × 730`

---

### Azure SQL Database

**DTU model:** no `armSkuName`; filter `productName` + `meterName`.

| SKU | `productName` contains | `meterName` (unit: 1/Day) |
|-----|----------------------|-------------|
| Basic (5 DTU) | `SQL Database Single Basic` | `B DTU` |
| S0 (10 DTU) | `SQL Database Single Standard` | `S0 DTUs` |
| S1 (20 DTU) | `SQL Database Single Standard` | `S1 DTUs` |

**Monthly (DTU):** `retailPrice × 30`

**vCore model:** `productName` filters. Serverless: `'SQL Database General Purpose - Serverless - Compute Gen5'`. Hyperscale: `'SQL Database Single/Elastic Pool Hyperscale'`. Monthly: `retailPrice × 730`.

---

### Cosmos DB

Filter: `serviceName eq 'Azure Cosmos DB' and armRegionName eq '{region}' and priceType eq 'Consumption' and isPrimaryMeterRegion eq true`

| Model | Match on | Monthly formula |
|-------|----------|----------------|
| Provisioned | `meterName eq '100 RU/s'`, `productName eq 'Azure Cosmos DB'` | `(targetRU / 100) × retailPrice × 730` |
| Autoscale | `productName eq 'Azure Cosmos DB autoscale'`, `meterName` starts with `AP` | varies |
| Serverless | `productName eq 'Azure Cosmos DB serverless'`, `meterName eq '1M RUs'` | `retailPrice × estimatedMillionsOfRU` |

> ⚠️ **Provisioned 100 RU/s gotcha:** `isPrimaryMeterRegion eq true` entry has `retailPrice: 0` free-tier placeholder. Real price (~$0.008/hr in eastus) has `isPrimaryMeterRegion: false`. Drop `isPrimaryMeterRegion` or match `retailPrice > 0`.

**Storage:** `meterName eq 'Data Stored'` + `productName eq 'Azure Cosmos DB'` (1 GB/Month). Meter has `isPrimaryMeterRegion: false`; omit that filter.

**Free tier:** 1,000 RU/s + 25 GB per account (one per subscription).

---

### Storage

No `armSkuName`; filter `meterName` + `productName`.

**Filter (Hot LRS Blob):**
```
serviceName eq 'Storage' and armRegionName eq '{region}' and meterName eq 'Hot LRS Data Stored' and productName eq 'Blob Storage'
```

**Meter-to-SKU mapping:**

| SKU matrix tier | `meterName` | `productName` |
|----------------|-------------|---------------|
| Standard_LRS | `Hot LRS Data Stored` | `Blob Storage` or `General Block Blob v2` |
| Standard_GRS | `Hot GRS Data Stored` | `Blob Storage` or `General Block Blob v2` |
| Premium_LRS | `Premium LRS Data Stored` | `Premium Block Blob` |

**Monthly:** `retailPrice × estimatedGB`

---

### Service Bus

**Filter:**
```
serviceName eq 'Service Bus' and armRegionName eq '{region}'
```

> ⚠️ **Do NOT add `isPrimaryMeterRegion eq true`**. All Service Bus meters have `isPrimaryMeterRegion: false`; filter returns no useful results.

**Key meters:**

| Tier | `meterName` | Unit | Notes |
|------|-------------|------|-------|
| Basic | `Basic Messaging Operations` | 1M | Usage-based only |
| Standard | `Standard Base Unit` | 1/Hour | Base cost (always-on) |
| Standard | `Standard Messaging Operations` | 1M | Tiered; first 13M free |
| Premium | `Premium Messaging Unit` | 1/Hour | Per messaging unit |

**Monthly (Standard):** `baseUnitRate × 730` + operations beyond first 13M free.

**Gotcha:** Standard Base Unit has hourly and monthly entries; use hourly × 730.

---

### Redis Cache

`armSkuName` populated; `pricing_get --sku` works.

**MCP call:** `pricing_get --service "Redis Cache" --sku "{armSkuName}" --region "{region}"`

**armSkuName pattern:** `Azure_Redis_Cache_{Tier}_{Size}_Cache` (e.g., `Azure_Redis_Cache_Basic_C0_Cache`, `Azure_Redis_Cache_Standard_C1_Cache`). Query MCP for exact price.

**Gotcha:** Basic entries have `isPrimaryMeterRegion: false`; standard filter removes them. Query `armSkuName` directly or omit `isPrimaryMeterRegion` and match `productName eq 'Azure Redis Cache Basic'`.

**Monthly:** `retailPrice × 730`

---

### Azure Database for PostgreSQL Flexible Server

`armSkuName` populated; `pricing_get --sku` works. ⛔ **`skuName` is CASE-SENSITIVE:** `B1MS` works; `B1ms` returns 0.

**MCP call:** `pricing_get --service "Azure Database for PostgreSQL" --sku "{armSkuName}" --region "{region}"`

**armSkuName values:** ⛔ case-sensitive. Small Burstable uses short names (`B1MS`, `B2S`); larger Burstable + GP/MO use `Standard_`.

| SKU | `armSkuName` |
|-----|-------------|
| Burstable B1ms | `B1MS` |
| Burstable B2s | `B2S` |
| Burstable B2ms | `Standard_B2ms` |
| General Purpose D2ds_v5 | `Standard_D2ds_v5` |

**Storage:** Query separately: `meterName eq 'Storage Data Stored'` and `productName` containing `Flexible Server Storage`. Unit 1 GiB/Month. Default 32 GiB included at ~$0.115/GiB/mo.

**Monthly (compute):** `retailPrice × 730`
**Monthly (storage):** `storageRate × storageSizeGB`
**Total:** compute + storage (e.g., B1ms + 32 GiB ≈ $12.41 + $3.68 = ~$16.09)

---

### Functions

**Consumption plan:** absent from API. Free: 1M executions + 400K GB-seconds/month.

**Flex/Premium** filter: `serviceName eq 'Functions' and armRegionName eq '{region}' and priceType eq 'Consumption' and isPrimaryMeterRegion eq true`
- Flex: `On Demand Execution Time` (1 GB Second), `On Demand Total Executions` (10), `Always Ready Baseline`
- Premium: `Premium vCPU Duration` (1 Hour), `Premium Memory Duration` (1 GiB Hour). Monthly: `vCPU_rate × 730 + memory_rate × GiB × 730`

---

### Static Web Apps

**Not in the Retail Prices API.** Fixed pricing — query [azure.microsoft.com/pricing/details/app-service/static](https://azure.microsoft.com/en-us/pricing/details/app-service/static/):
- **Standard tier (floor — Free is never selected):** Flat monthly per app, unlimited bandwidth, 5 custom domains, SLA, private endpoints

---

### Log Analytics / Application Insights

**Filter:**
```
serviceName eq 'Azure Monitor' and armRegionName eq '{region}' and priceType eq 'Consumption' and isPrimaryMeterRegion eq true
```

**Key meters:**
- `Platform Logs Data Processed` (unit: 1 GB)
- Log Analytics ingestion — match `meterName` containing `Data Ingestion`

**Free grant:** First 5 GB/month of Log Analytics data ingestion.

**Monthly:** `retailPrice × estimatedGB`, after subtracting 5 GB free grant.

# Naming Patterns

AppOnboard Azure naming rules. Apply in Step 7.

> **Reference:** [Azure naming conventions](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-naming) — link, don't duplicate; check updates.

## Default Pattern

```
{abbreviation}-{resourcePrefix}
```

`resourcePrefix` = `{project}-{env}-{suffix}`, generated once in prepare Step 7 and stored in `prepare-plan.json.naming.resourcePrefix`.

- `{project}` — app name from `context.json.app.name`; lowercase alphanumeric + hyphens
- `{env}` — `dev` / `staging` / `prod`; intent or default `dev`
- `{suffix}` — first 4 session UUID chars (e.g., `a1d5`); generated once, stored in `naming.suffix`
- `{abbreviation}` — table's service prefix (e.g., `app`, `st`, `rg`)

**Examples with `resourcePrefix = myapp-dev-a1d5`:**
- Resource Group: `rg-myapp-dev-a1d5`
- App Service: `app-myapp-dev-a1d5`
- Storage: `stmyappdeva1d5` (alphanumeric only)

> ⛔ **No redundancy.** Resource name: `{abbr}-{resourcePrefix}`, NOT `{project}-{abbr}-{project}-{env}-{suffix}`. Project appears ONCE.
>
> ⛔ **Scaffold reads plan naming; it does NOT generate or modify names.**

Override through `context.json.overrides[]` using `key: "naming.pattern"`.

## Per-Resource Rules

| Resource | Abbreviation | Max Length | Allowed Chars | Globally Unique? | Example |
|----------|-------------|------------|---------------|------------------|---------|
| Resource Group | `rg` | 90 | Alphanumeric, hyphens, underscores, periods, parens | No; suffix prevents cross-session collisions | `rg-myapp-dev-a1d5` |
| App Service | `app` | 60 | Alphanumeric, hyphens | **Yes** | `app-myapp-dev-a1d5` |
| Container App | `ca` | 32 | Lowercase alphanumeric, hyphens | No, within env | `ca-myapp-dev-a1d5` |
| Container Registry | `cr` | 50 | **Alphanumeric only** | **Yes** | `crmyappdeva1d5` |
| Azure SQL Server | `sql` | 63 | Lowercase alphanumeric, hyphens | **Yes** | `sql-myapp-dev-a1d5` |
| Cosmos DB | `cosmos` | 44 | Lowercase alphanumeric, hyphens | **Yes** | `cosmos-myapp-dev-a1d5` |
| Storage Account | `st` | 24 | **Lowercase alphanumeric only** | **Yes** | `stmyappdeva1d5` |
| Log Analytics | `log` | 63 | Alphanumeric, hyphens | No (within RG) | `log-myapp-dev-a1d5` |
| App Insights | `appi` | 260 | Most chars | No (within RG) | `appi-myapp-dev-a1d5` |
| Service Bus | `sb` | 50 | Alphanumeric, hyphens | **Yes** | `sb-myapp-dev-a1d5` |
| Functions | `func` | 60 | Alphanumeric, hyphens | **Yes** | `func-myapp-dev-a1d5` |
| Static Web Apps | `swa` | 40 | Alphanumeric, hyphens | No; Rule 1 still requires suffix | `swa-myapp-dev-a1d5` |
| Redis Cache | `redis` | 63 | Alphanumeric, hyphens | **Yes** | `redis-myapp-dev-a1d5` |

> **CAF deviation:** Azure Cloud Adoption Framework uses `sbns` for Service Bus namespace; AppOnboard uses shorter `sb`. Both acceptable.

## Rules

1. **ALL resources get `{suffix}`**, including resource groups, preventing cross-session collisions across repeated app deployments. Generate this 4-char random string once per session.
2. **Container Registry + Storage Account:** strip hyphens; alphanumeric only. ⛔ **Mechanical transform—do NOT re-derive char-by-char:** `('cr' + resourcePrefix).replace(/-/g,'').toLowerCase()`, truncate to ≤50 (ACR) / ≤24 (Storage). Example: `resourcePrefix = bezkoder-dev-18a3` → `cr` + `bezkoderdev18a3` → `crbezkoderdev18a3`. Copy pattern; don't spell concatenation.
3. **Validate length** after substitution. Storage Account and Container App (24 / 32 chars, alphanumeric) are tightest. `{project}` budget: `24 - len(abbreviation) - len(env) - len(suffix) - 3 - 2` (separators + healing reserve). For `st` + `dev` (Storage strips hyphens): ~10 chars max. 2-char reserve fits fallback healing suffix (e.g., `edd6` → `edd602`). **If over budget:**
   1. Truncate at nearest in-budget hyphen (e.g., `broken-web-app` at 10 → `broken-web`)
   2. Without in-budget hyphen, hard-truncate; no trailing hyphen
   3. Check truncated name against reserved words (Rule 4)
   4. Recompute ALL names from truncated project; do NOT mix lengths
4. **Never use reserved words** as resource names (`admin`, `login`, `root`, `test`)
5. After validation, put concrete names in `naming.resources[]` within `prepare-plan.json`

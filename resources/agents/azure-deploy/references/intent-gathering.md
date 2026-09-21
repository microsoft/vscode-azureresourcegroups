# Intent Gathering

## Scope Triage (Step 2 — before prereq)

> ⛔ **Scope triage BEFORE prereq.** Check azd template markers (`azure.yaml` + IaC in `infra/`).
>
> **Skip triage when:**
> - User explicitly requests cost estimates, service recommendations, or code analysis
> - Empty workspace (prereq’s zero-code-path handles it)
> - Code exists without infra files (no `.bicep`, `.tf`, `azure.yaml`, or `infra/` dir)—full pipeline only sensible path
> - Intentionally vulnerable app signals (🛑 detection) — proceed to prereq directly
>
> ### If azd template detected
>
> ⛔ **MUST read [`azd-template-routing.md`](azd-template-routing.md)** for detection criteria, gate, routing protocol.
>
> ### If NO azd template BUT infra files present
>
> Ask ONE `ask_user` question:
> 1. **Yes — analyze and deploy end-to-end** (Recommended)
> 2. **Just scaffold Bicep/Terraform**
> 3. **Just deploy it** (I have IaC ready)
> 4. **Other**
>
> Option 1 / vague → full pipeline (Step 3). Others → hand off to `azure-prepare`.

## After Prereq Returns (Step 4 — scan-informed intent gathering)

Prereq wrote `prereq-output.json` + `context.json.components[]`; authoritative downstream source (prepare/scaffold consume `context.json`, not `prereq-output.json`).

Before questions, present detected component boundaries: each deployable component's path, framework, and intended Azure compute model. For SPA + Azure Functions, state both mappings: frontend retains separate hosting; backend remains separate Function App. Never infer SWA-managed API solely from frontend `/api` routes.

Confirm Azure target ("☁️ **Azure target**: {subscriptionName} ({subscriptionId})"). Different subscription → write `context.json.overrides[]`.

**Present scan results first; ask only unanswered items** (≤2 mostly covered, ≤4 with gaps):

| # | Topic | Ask if... |
|---|-------|----------|
| 1 | App purpose | Unclear from `detectedStack` + `components[]` |
| 3 | Data/storage | Prereq found no DB/compose |
| 4 | Auth approach | No detected MSAL/passport/auth library |
| 5 | Scale | Always — prereq doesn't know traffic expectations |

⛔ Do NOT ask stack/language (prereq always answers), or budget unless user mentioned cost. Corrections → `context.json.overrides[]`. Stop when covered or user says "just go."

**Update intent:** Merge scan results into `context.json.intent`; set `refinedFromScan: true`; populate `scanDiscoveredFacts[]`.

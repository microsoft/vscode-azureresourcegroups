# Deployability Check

> ⛔ **No build/install/test commands — `npm install`, `npm test`, `dotnet build`, `dotnet restore`, `dotnet test`, `pip install`, `pytest`, `go mod download`, `cargo build`. Use static analysis only during this check.**

Assess Azure deployability and preparation-plan feasibility.

> ⛔ **MUST read these in order. Skip conditional items when their condition is unmet:**
>
> 1. [component-mapping.md](component-mapping.md) — Steps 1–2: Component→Azure mapping, existing infrastructure detection, Terraform provider classification, compose service extraction. **Conditional: monorepo only (>1 project manifest found).** Single-component repos skip to Step 3.
> 2. [dependency-compatibility.md](dependency-compatibility.md) — Step 3: EOL runtimes/frameworks, archived repos, vulnerable apps, platform deps, Dockerfile analysis, native module detection
> 3. Steps 4–5 below

## Step 4: Recipe Feasibility

Find at least one viable deployment recipe.

| Check | Question |
|-------|----------|
| AZD feasible? | Standard web app stack? No exotic build requirements? |
| Container feasible? | Can be Dockerized? Or already has Dockerfile? |
| Functions feasible? | Event-driven or HTTP-triggered stateless handlers? |
| Terraform feasible? | User has TF experience or existing TF files? |

| Outcome | Verdict |
|---------|---------|
| At least one recipe clearly viable | ✅ PASS |
| Viable with modifications (config change, Dockerfile tweak) | 🔧 Recommended Fix — note required changes |
| Viable but requires significant rework (>5 files, architecture change) | 🔶 Major Migration — warn about scope |
| Minor platform concerns (ephemeral storage, missing .dockerignore) | ⚠️ WARN — informational |
| No viable recipe identified | ❌ FAIL |

## Step 5: Specialized Deployment Detection

Check whether the stack needs a specialized deployment agent. On match, set `context.json.routeToSkill` and `routeReason` for direct Step 8 routing.

> **Non-Azure cloud SDK deps** (AWS/GCP SDKs, Firebase, etc.) — carry as evaluated 🔶 blockers (no `routeToSkill`); prereq stops at Step 8. See [dependency-compatibility.md § Non-Azure Cloud SDK Dependencies](dependency-compatibility.md).

| Dependency / Pattern | `routeToSkill` | `routeReason` |
|---------------------|----------------|---------------|
| `@github/copilot-sdk`, `github-copilot-sdk`, `GitHub.CopilotSdk` | `azure-hosted-copilot-sdk` | `copilot-sdk-detected` |
| `azure_ai_projects`, `azure-ai-agents`, `foundry-agents` | `microsoft-foundry` | `foundry-agents-detected` |

## f1Viable Aggregation (deprecated signal)

F1/D1/Free are never selected (B1 floor); `f1Viable` is effectively always `false`. Still populate `f1BlockReason` for blockers found in [dependency-compatibility.md § Native Module Detection](dependency-compatibility.md) or [§ SKU Sizing Signals](dependency-compatibility.md)—it drives sizing **up** from B1 (B2/S1), never down to free.

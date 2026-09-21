Component-to-Azure mapping and existing-infrastructure detection. Part of [deployability check](deployability-check.md).

## Step 1: Component Mapping Feasibility

Map each detected component to a known Azure service.

| Component Type | Mappable Azure Services |
|----------------|------------------------|
| SPA / Static Site | Static Web Apps, Blob + CDN |
| Existing Azure Functions project | Azure Functions |
| SSR Web App | Container Apps, App Service |
| REST / GraphQL API | Container Apps, App Service, Functions |
| Background Worker | Container Apps, Functions |
| Scheduled Task | Functions (Timer Trigger) |
| Event Processor | Functions, Container Apps |
| CLI Tool | Not directly deployable — flag |

| Outcome | Verdict |
|---------|---------|
| All components map to Azure services | ✅ PASS |
| Some components need clarification | ⚠️ WARN |
| Unknown component type, can't map | ⚠️ WARN — ask user for context |
| Component is fundamentally incompatible | ❌ FAIL |

## Preserve Existing Compute Models

The table above describes what can host newly designed components. It does not permit replatforming an
existing component whose framework already selects a compute model.

- `host.json` plus an Azure Functions SDK or worker signal identifies an Azure Functions project. Map it to
  Azure Functions even when all of its triggers are HTTP triggers.
- Keep separate service roots as separate components. A SPA root and a Functions root produce a frontend
  component and a backend component.
- Static Web Apps may host the frontend, but an existing Functions root must not become an SWA-managed API.
  Do not move or copy its source under an SWA API directory and do not change its runtime or authentication
  provider to `azureStaticWebApps`.
- A detached Static Web App plus Function App with explicit CORS is the default. Linking the separately
  deployed Function App as an SWA backend requires explicit user approval and must be recorded in
  `context.json.overrides[]`.

## Step 2: Existing Infrastructure Check

Detect existing Azure infrastructure or deployment config.

| Found | Implication |
|-------|-------------|
| `azure.yaml` | AZD project — may only need update |
| `infra/*.bicep` | Bicep IaC exists |
| `infra/*.tf` or `*.tf` | Terraform IaC exists — classify provider (see below) |
| `Dockerfile` | Containerization ready |
| `.github/workflows/` | CI/CD configured |
| `azure-pipelines.yml` | Azure DevOps CI/CD |
| `docker-compose.yml` | Multi-container setup — parse for service dependencies |
| None of the above | Greenfield — full prep needed |

Record findings for azure-prepare recipe selection.

### Terraform Provider Classification

When `.tf` files exist, read `versions.tf`, `provider.tf`, or `main.tf` for `required_providers`. Classify into `context.json.detectedInfraProvider.terraform`:

| `required_providers` contains | Classification | Scaffold behavior |
|-------------------------------|---------------|-------------------|
| `hashicorp/azurerm` only | `"azure"` | Halt — existing Azure IaC |
| `hashicorp/google` or `hashicorp/google-beta` (no `azurerm`) | `"gcp"` | Generate Azure TF alongside |
| `hashicorp/aws` (no `azurerm`) | `"aws"` | Generate Azure TF alongside |
| Multiple cloud providers including `azurerm` | `"multi"` | Halt — Azure IaC already present |
| Multiple cloud providers without `azurerm` | `"multi"` | Generate Azure TF alongside |
| No provider block found or only non-cloud providers | `"unknown"` | Halt — ask user to clarify |

Also check `azure.yaml` coexistence: BOTH `azure.yaml` AND non-Azure `.tf` → `azure.yaml` wins → route to `azure-deploy`, not AppOnboard scaffold.

### Compose Service Dependency Extraction

When `docker-compose.yml` or `compose.yml` exists, parse `services:` infrastructure dependencies. Map known images to `detectedServices[]` (`DetectedService` in `session-schemas.ts`):

| Image pattern | `type` | Version source |
|--------------|--------|----------------|
| `postgres:*` | `postgresql` | Image tag (e.g., `postgres:16` → `"16"`) |
| `redis:*` / `redis/redis-stack:*` | `redis` | Image tag |
| `*kafka*` (bitnami, confluent, etc.) | `kafka` | Image tag |
| `elasticsearch:*` / `opensearchproject/*` | `elasticsearch` | Image tag |
| `mariadb:*` | `mariadb` | Image tag |
| `mongo:*` | `mongodb` | Image tag |
| `rabbitmq:*` | `rabbitmq` | Image tag |
| `minio/*` | `minio` | Image tag |
| `mysql:*` | `mysql` | Image tag |

Set `source: "compose"` on each. Omit `version` for no tag or `latest`. Skip app-owned services (`build:` context points to repo).

### Compose Hostname Detection

After extracting compose services, grep source and config for service names used as hostnames. Compose DNS names (e.g., `postgres`, `redis`, `api`) resolve inside Docker networks, NOT on Azure PaaS.

**Detection:** For each service name, search config (`.env`, `config.*`, `application.*`, `settings.*`) and source for hostname patterns: `host=<service_name>`, `<service_name>:<port>`, `://<service_name>:`, or `<service_name>.`. Examples: `host=postgres`, `redis://redis:6379`, `PGHOST=db`.

**Verdict:** ⚠️ WARN — `id: W-COMPOSE-HOSTNAME`. "App references Docker Compose service name `{name}` as a hostname. On Azure, use the managed service endpoint (set via environment variable) instead." Add to `postDeployRecommendations[]`: `{ "title": "Replace compose hostnames with Azure endpoints", "reason": "Compose DNS names don't resolve on Azure PaaS", "effort": "low", "services": ["{mapped Azure service}"] }`.

# Service Mapping Tables

Map components→Azure services. Apply `context.json.intent` modifiers, `context.json.overrides[]` hard constraints, policy filters.

## Hosting

> ⛔ **Existing framework beats generic component type.** Component path with `host.json` plus Azure Functions SDK or worker configuration → Azure Functions. Do not route through generic REST/GraphQL API row, merge into frontend, or package as SWA-managed API. Coexisting SPA and Functions require separate frontend and Azure Functions `services[]` entries whose `component` values match detected component names.

> ⛔ **Implicit dependencies:** For Container Apps with Dockerfile or prereq `hasDockerfile: true`, **ALWAYS include Container Registry (Basic)** in `services[]`. ACR hosts custom images; omission forces imperative deploy addition and wastes healing. ACR Basic: $0.17/day (~$5/mo).

| Component Type | Primary Service | Alternatives | Selection Signal |
|---------------|----------------|-------------|-----------------|
| SPA Frontend | Static Web Apps | Blob + CDN | React/Vue/Angular, no SSR |
| Existing Azure Functions project | Azure Functions (Flex Consumption) | Azure Functions Premium | `host.json` plus Functions SDK or worker configuration |
| SSR Web App | Container Apps | App Service, AKS | Next.js/Nuxt, server-rendered |
| REST/GraphQL API | Container Apps | App Service, Functions, AKS | Express/Fastify/Flask/FastAPI |
| Background Worker | Container Apps (scale-to-zero) | Functions, AKS | Celery/Bull/Agenda; no HTTP |
| Scheduled Task | Functions (Timer) | Container Apps Jobs | Cron patterns, periodic execution |
| Event Processor | Functions | Container Apps + KEDA | Event-driven, queue/topic consumer |
| Microservices (K8s) | AKS | Container Apps | kubectl/helm in repo, CRDs, service mesh |
| GPU/ML Workloads | AKS | Azure ML | GPU or training workloads |

**Stack shortcuts:** Containers (Docker, microservices) → Container Apps/AKS. Serverless (event-driven, variable traffic) → Functions. Traditional PaaS web → App Service.

**Frontend plus Functions:** Default: detached frontend host + separately deployed Function App. For Static Web Apps, add SWA origin to Function App CORS allowlist. Do not change Function App runtime, authentication provider, or app settings to `azureStaticWebApps`. Link existing Function App as SWA backend only when `context.json.overrides[]` records explicit user approval for `linkFunctionsToStaticWebApp`; linking neither removes Function App service nor changes its deployment channel.

**AKS vs Container Apps:** Choose Container Apps for scale-to-zero, no K8s expertise, or KEDA event processing. Delegate AKS planning to `azure-kubernetes`.

**App Service vs Container Apps:** Prefer App Service for unorchestrated single-process apps (B1 floor, ~$13/mo; no free tier). Prefer Container Apps for REST/GraphQL APIs (scaffold creates missing Dockerfile), scale-to-zero, multi-container/sidecar, or KEDA events. Budget changes SKU tier (Consumption vs Dedicated), not compute type. Container Apps Consumption scales to zero (near-$0 idle), closest to free, and supports managed identity.

**Static Dockerfile sites (nginx/httpd serving HTML):**
- **Primary:** Static Web Apps **Standard** — global CDN, custom auth/CORS, managed-identity BYO backends.
  > ⛔ **SWA region availability:** Validate via `az provider show --namespace Microsoft.Web --query "resourceTypes[?resourceType=='staticSites'].locations" -o tsv`.
- **Alternative:** App Service **B1** — ⛔ for static content use Windows B1 (IIS serves `index.html` natively) or Linux B1 (`linuxFxVersion: 'STATICSITE|1.0'`). ⛔ Do NOT use `NODE|*`/`PHP|*`/`PYTHON|*` for static sites — causes 504/503 cold start.
- **If Docker required:** Container Apps (scale-to-zero) or App Service B1+ (custom containers).

**Plain HTML (no package manager, no Dockerfile):** Static Web Apps Standard preferred, or Windows App Service B1 (IIS serves natively; Linux: `linuxFxVersion: 'STATICSITE|1.0'`).

## Data

| Need | Primary Service | Alternatives | Selection Signal |
|------|----------------|-------------|-----------------|
| Relational | Azure SQL | PostgreSQL Flexible, MySQL Flexible | SQL schema, transactions, joins |
| Document/NoSQL | Cosmos DB | — | JSON docs, global distribution |
| Graph (Gremlin) | Cosmos DB (Gremlin API) | — | Graph traversal, relationships |

> **Cosmos DB Serverless:** Each account supports ONE API type: SQL, MongoDB, Gremlin, Table, or Cassandra. Multi-API apps need separate accounts.

| Cache | Redis Cache | — | Sessions, rate limiting |
| Files/Blobs | Blob Storage | Files Storage | File uploads, static assets |
| Search | AI Search | — | Full-text search |
| MariaDB/MySQL | MySQL Flexible Server | — | Compose/connection config has `mariadb:*` or `mysql:*` |
| Elasticsearch/OpenSearch | AI Search | Azure Monitor (for Kibana) | Compose has `elasticsearch:*` or `opensearch:*` |
| S3-compatible / MinIO | Blob Storage | — | Compose `minio/*` or S3 SDK |

## Integration

| Need | Primary Service | Selection Signal |
|------|----------------|-----------------|
| Message Queue | Service Bus | Point-to-point, ordered, transactions |
| Pub/Sub | Event Grid | Event routing, fan-out |
| Streaming / Kafka | Event Hubs | High-throughput telemetry/logs. **Kafka protocol compatible**; apps using `kafka-clients`, Spring Kafka, `confluent-kafka-python` change only bootstrap URL + SASL config |
| Multi-step orchestration | Durable Functions + Durable Task Scheduler | DTS is the recommended managed backend |
| Low-code workflow | Logic Apps | Integration-heavy; visual designer |

> **docker-compose → Azure mapping:** Map each `detectedServices[].type` to table PaaS equivalent. For **unmapped services** (SSH daemons, custom sidecars; no managed equivalent), offer companion Linux VM (B1s ~$7/mo) at scaffold gate. Option only, never forced. Write `postDeployRecommendations[]`.

## Supporting (always include)

| Service | Purpose |
|---------|---------|
| Log Analytics | Central logs |
| Application Insights | Monitoring + APM |
| Managed Identity | Service-to-service auth (zero secrets) |

## Specialized Routing

Before mapping, delegate matching signals:

| Signal | Delegate To |
|--------|-------------|
| Copilot SDK, `@github/copilot-sdk` | `azure-hosted-copilot-sdk` |
| Foundry agent, AI agent deployment | `microsoft-foundry` |

> ⛔ **Non-Azure cloud SDK deps** (AWS/GCP/Firebase) belong to prereq; pipeline must NOT reach prepare with them. If present, prereq failed: HALT and do NOT continue architecture planning.

## Non-Azure Terraform Resource Mapping

When `context.json.detectedInfraProvider.terraform` is `"gcp"` or `"aws"`, read existing `.tf` and map resources to Azure. Use these architecture signals with component detection.

### GCP → Azure

| GCP Terraform Resource | Azure Equivalent | Notes |
|------------------------|-----------------|-------|
| `google_cloud_run_v2_service` | Container Apps | Map scaling, env vars, VPC config |
| `google_sql_database_instance` (POSTGRES) | PostgreSQL Flexible Server | Map tier, backup, maintenance |
| `google_sql_database_instance` (MYSQL) | MySQL Flexible Server | Map tier, backup config |
| `google_artifact_registry_repository` | Container Registry (ACR) | Basic tier unless geo-replication needed |
| `google_pubsub_topic` / `google_pubsub_subscription` | Service Bus | Map topic/subscription model |
| `google_secret_manager_secret` | On-compute app secret (App Service app settings / CA native secrets) — ⛔ no Key Vault | App-internal secrets only; Azure resource auth uses managed identity |
| `google_firestore_database` | Cosmos DB (NoSQL API) | Map indexes, TTL config |
| `google_cloudfunctions2_function` | Azure Functions | Map triggers, runtime |
| `google_service_account` + `google_project_iam_member` | Managed Identity + RBAC | Map roles |

Other GCP resources—storage, redis, compute network, VPC connector, cloud tasks—map 1:1 to Blob Storage, Redis Cache, VNet, Queue Storage.

### AWS → Azure

| AWS Terraform Resource | Azure Equivalent | Notes |
|------------------------|-----------------|-------|
| `aws_ecs_service` / `aws_ecs_task_definition` | Container Apps | Map task def → container config |
| `aws_rds_instance` (postgres/mysql) | PostgreSQL/MySQL Flexible Server | Map instance class → SKU |
| `aws_lambda_function` | Azure Functions | Map runtime, handler, triggers |
| `aws_dynamodb_table` | Cosmos DB (NoSQL API) | Map capacity, indexes |
| `aws_sns_topic` | Service Bus or Event Grid | Map subscriptions |
| `aws_secretsmanager_secret` | On-compute app secret (App Service app settings / CA native secrets) — ⛔ no Key Vault | App-internal secrets only; Azure resource auth uses managed identity |

Other AWS resources—S3, ECR, SQS, ElastiCache—map 1:1 to Blob Storage, ACR, Queue Storage/Service Bus, Redis Cache. SQS → Service Bus when FIFO ordering required.

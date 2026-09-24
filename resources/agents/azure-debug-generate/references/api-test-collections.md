# API Test Collection Patterns

> Generates `api-test-collections/{service-id}/` scripts. `{service-id}` is canonical ID from plan **Service Label** (see [generate.md](generate.md) § Service ID Derivation). Generate only for checked **Generate** services. Use language-agnostic commands exercising running app and live-emulator integrations.

---

## HTTP

 **HTTP patterns** use project-type `{baseUrl}` (e.g., `http://localhost:7071/api` for Functions). Other patterns directly target emulators and work across project types.

### GET request

```sh
curl -i "{baseUrl}/{FunctionName}"
```

### POST with JSON body

```sh
curl -i -X POST "{baseUrl}/{FunctionName}" \
  -H "Content-Type: application/json" \
  -d @sample-data.json
```

> **`{baseUrl}` by project type:**
>
> | Project Type | Base URL |
> |-------------|---------|
> | Azure Functions | `http://localhost:7071/api` |
> | Container App | `http://localhost:{port}` (from Dockerfile `EXPOSE`) |
> | App Service | `http://localhost:{port}` (from framework dev server) |

---

## Storage (Azurite — Blob / Queue / Table)

> Requires Azurite running. Uses `--connection-string "UseDevelopmentStorage=true"` for all commands.

### Blob trigger — upload a file

```sh
az storage blob upload \
  --connection-string "UseDevelopmentStorage=true" \
  --container-name {container-name} \
  --name "sample-file.json" \
  --file sample-file.json \
  --overwrite
```

### Queue trigger — send a message

```sh
az storage message put \
  --connection-string "UseDevelopmentStorage=true" \
  --queue-name {queue-name} \
  --content '{"id": "test-001", "data": "sample"}'
```

### Table trigger — insert an entity

```sh
az storage entity insert \
  --connection-string "UseDevelopmentStorage=true" \
  --table-name {table-name} \
  --entity PartitionKey=pk RowKey=rk001 Value=test
```

---

## Cosmos DB

> Requires Cosmos DB Emulator running on `https://localhost:8081`. TLS verification must be disabled for local calls.

### Insert a document

```sh
curl -k -X POST "https://localhost:8081/dbs/{database}/colls/{collection}/docs" \
  -H "Authorization: type=master&ver=1.0&sig=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==" \
  -H "Content-Type: application/json" \
  -H "x-ms-documentdb-partitionkey: [\"test\"]" \
  -H "x-ms-version: 2018-12-31" \
  -d '{"id": "test-001", "partitionKey": "test", "data": "sample"}'
```

> `-k` disables TLS verification for emulator self-signed cert. Never use in production.

---

## Service Bus

> Requires Service Bus Emulator running. Uses curl against the Service Bus Emulator's HTTP endpoint.

### Send a message to a queue

```sh
curl -i -X POST "http://localhost:5672/messages" \
  -H "Content-Type: application/json" \
  -H "BrokerProperties: {\"Label\": \"test\"}" \
  -d '{"id": "test-001", "data": "sample"}'
```

> Service Bus Emulator HTTP endpoint/port may vary. Check emulator docs and docker-compose configuration for correct URL. SDK tests use Azure Service Bus SDK with connection string from `emulators/` config.

### Send a message to a topic

```sh
curl -i -X POST "http://localhost:5672/messages" \
  -H "Content-Type: application/json" \
  -H "BrokerProperties: {\"Label\": \"test\"}" \
  -d '{"id": "test-001", "data": "sample"}'
```

> Adjust URL path for topic endpoints per emulator API surface.

---

## Event Hubs

> Requires Event Hubs Emulator running.

### Send an event

```sh
curl -i -X POST "http://localhost:5672/messages" \
  -H "Content-Type: application/json" \
  -d '{"id": "test-001", "data": "sample"}'
```

> Event Hubs Emulator HTTP endpoint/port may vary. Check emulator docs and docker-compose configuration for correct URL. SDK tests use Azure Event Hubs SDK with connection string from `emulators/` config.

---

## Timer (Azure Functions only)

External events cannot fire timer triggers; Functions host runs their schedule. Trigger on demand through Functions admin API:

```sh
curl -i -X POST "http://localhost:7071/admin/functions/{FunctionName}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

> Functions admin endpoint is local-only. `{}` body required but ignored by timer trigger.

---

## Generation Rules

During Phase 2 API test collection generation:

1. Resolve endpoints from implemented route registrations, not only `.azure/project-plan.md`; the project plan intentionally omits derived authentication routes, so include implemented registration, login, and current-user endpoints when `API Login` is enabled.
2. Create `api-test-collections/{service-id}/` per service, deriving `{service-id}` from the plan's **Service Label** (see [generate.md](generate.md) § Service ID Derivation). Generate only services whose **Generate** column is checked.
3. Within each service directory, create one subdirectory per inventoried trigger/endpoint.
4. Name the trigger directory `{trigger-type}-{function-or-endpoint-name}` (e.g., `http-GetOrder`, `blob-ProcessUpload`).
5. Create an `invoke` script (`.sh` on macOS/Linux, `.ps1` on Windows) from the appropriate pattern here, substituting discovered values (function name, container name, etc.).
6. When a body is required, place `sample-data.json` or `sample-message.json` beside the invoke script.
7. On macOS/Linux, make the script executable (`chmod +x`).

> Generate timer test scripts only on explicit user request; rarely needed locally.

---

## Plan Section Formatting Rules

In plan **API Test Collections**, heading format varies by trigger. Include differing subfolder names under `api-test-collections/{service-id}/` (e.g., `http-register`, `http-createOrder`) in each section heading, exposing route-to-script mapping.

---

### HTTP triggers / web API endpoints

```
### {METHOD} {route} [{🔒}] `{folder-name}`
```

- **`{METHOD} {route}`** — HTTP verb and full route path (e.g., `GET /api/health`)
- **`🔒`** — Include this emoji when the endpoint requires authentication (any auth scheme: Bearer JWT, API key, etc.). Omit entirely for anonymous/public endpoints.
- **`` `{folder-name}` ``** — The exact folder name under `api-test-collections/{service-id}/` (e.g., `` `http-health` ``)

**Examples:**

```markdown
### GET /api/health `http-health`

### POST /api/auth/register `http-register`

### GET /api/auth/me 🔒 `http-getMe`

### POST /api/orders 🔒 `http-createOrder`
```

**Auth key** — add this once at the top of the API Test Collections section, just after the folder tree, when any 🔒 routes are present:

```markdown
> 🔒 = requires authentication (replace `<token>` with a JWT from the login endpoint before running)
```

---

### Non-HTTP triggers (blob, queue, Service Bus, Event Hubs, etc.)

```
### {TriggerType}: {function-or-resource-name} `{folder-name}`
```

- **`{TriggerType}`** — Human-readable trigger category: `Blob`, `Queue`, `Service Bus`, `Event Hubs`, `Table`, `Cosmos DB`, etc.
- **`{function-or-resource-name}`** — The function name or the specific resource being targeted (container name, queue name, topic name, etc.)
- **`` `{folder-name}` ``** — The exact folder name under `api-test-collections/{service-id}/` (e.g., `` `blob-ProcessUpload` ``)

**Examples:**

```markdown
### Blob: uploads container `blob-processUpload`

### Queue: order-requests `queue-sendOrder`

### Service Bus: invoices topic `servicebus-sendInvoice`

### Event Hubs: telemetry `eventhubs-sendTelemetry`
```

> 🔒 excludes non-HTTP triggers: direct resource data push, not authenticated HTTP call.

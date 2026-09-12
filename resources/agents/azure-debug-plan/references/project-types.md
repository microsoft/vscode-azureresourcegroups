# Project Types

> These are **common examples, not an exhaustive list**. If a service root does not match
> any of these, classify it by whatever best describes its purpose (e.g. `background-worker`, `console`, etc.).

## Detection Table

| Detection Signals | Project Type | Include in Plan? |
|-------------------|-------------|------------------|
| `host.json` + Azure Functions SDK | **functions** | ✅ Yes |
| SPA framework in `package.json`, or `vite.config.*` / `next.config.*` / `angular.json` (no `host.json`) | **frontend-spa** | ✅ Yes |
| HTTP framework (Express, Fastify, Flask, FastAPI, ASP.NET, Spring Boot, etc.) | **app-service** | ✅ Yes |
| `Dockerfile` with a containerized application | **container-app** | ✅ Yes |
| No entry point, no framework, exports modules only (shared/common/util packages) | **library** | ❌ Exclude |

---

## functions

For Azure Functions projects, scan bindings to identify Azure service dependencies. Parse `function.json` files or decorator/attribute bindings in source code.

> **Implicit dependency:** All Azure Functions projects require Azure Storage for the host runtime (trigger management, lease coordination, internal state). Always emit an Azurite emulator entry in the plan regardless of whether application-level storage SDK packages are detected.

| Binding | Azure Service | Emulator |
|---------|--------------|----------|
| `blobTrigger`, `blob` | Blob Storage | azurite |
| `queueTrigger`, `queue` | Queue Storage | azurite |
| `table` | Table Storage | azurite |
| `httpTrigger` | (built-in) | — |
| `timerTrigger` | (built-in) | — |
| `warmupTrigger` | (built-in) | — |
| `durableClient`, `orchestrationTrigger`, `activityTrigger` | Durable Functions | durable-task-scheduler |
| `cosmosDBTrigger`, `cosmosDB` | Cosmos DB | cosmosdb-emulator |
| `serviceBusTrigger`, `serviceBus` | Service Bus | servicebus-emulator |
| `eventHubTrigger`, `eventHub` | Event Hubs | eventhubs-emulator |
| `eventGridTrigger`, `eventGrid` | Event Grid | — |
| `signalRTrigger`, `signalR` | SignalR Service | — |
| `sql`, `sqlTrigger` | Azure SQL | azure-sql-edge |

> Multiple storage bindings (blob + queue + table) consolidate to a **single** azurite entry.
> This table is **not exhaustive** — map any other bindings to their Azure service accordingly.

---

## frontend-spa

Frontend SPA projects do not require emulators or Azure bindings, but they **are** service roots. When a frontend is detected alongside a backend, the workspace is multi-service and **must** produce a compound debug configuration.

### Framework Detection

| Framework | Detection Signals |
|-----------|-------------------|
| Vite | `vite.config.*` or `vite` in devDependencies |
| Next.js | `next.config.*` or `next` in dependencies |
| Angular | `angular.json` |
| Create React App | `react-scripts` in dependencies |
| Blazor WASM | `*.razor` + `WebAssembly` SDK in `*.csproj` |

### Backend Proxy Dependencies

If a proxy config points to a local backend, record the dependency so the compound debug configuration can order startup (backends before frontends).

| Framework | Proxy Config Location |
|-----------|----------------------|
| Vite | `server.proxy` in `vite.config.*` |
| Create React App | `"proxy"` in `package.json` |
| Angular | `proxy.conf.json` |
| Next.js | `rewrites()` in `next.config.*` |

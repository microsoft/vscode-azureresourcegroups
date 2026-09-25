# Project Types

> **Common examples, not exhaustive.** Classify unmatched service roots by best
> purpose description (e.g. `background-worker`, `console`, etc.).

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

For Azure Functions projects, scan bindings for Azure dependencies. Parse `function.json` or source decorator/attribute bindings.

> **Implicit dependency:** Every Azure Functions project requires Azure Storage for host runtime trigger management, lease coordination, and internal state. Always add an Azurite emulator plan entry, regardless of application-level storage SDK detection.

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

> Consolidate multiple storage bindings (blob + queue + table) into **one** azurite entry.
> Table is **not exhaustive**; map every other binding to its Azure service.

---

## frontend-spa

Frontend SPA projects need no emulators or Azure bindings but **are** service roots. Frontend plus backend makes workspace multi-service and **must** produce compound debug config.

### Framework Detection

| Framework | Detection Signals |
|-----------|-------------------|
| Vite | `vite.config.*` or `vite` in devDependencies |
| Next.js | `next.config.*` or `next` in dependencies |
| Angular | `angular.json` |
| Create React App | `react-scripts` in dependencies |
| Blazor WASM | `*.razor` + `WebAssembly` SDK in `*.csproj` |

### Backend Proxy Dependencies

If proxy config targets a local backend, record dependency so compound debug config starts backends before frontends.

| Framework | Proxy Config Location |
|-----------|----------------------|
| Vite | `server.proxy` in `vite.config.*` |
| Create React App | `"proxy"` in `package.json` |
| Angular | `proxy.conf.json` |
| Next.js | `rewrites()` in `next.config.*` |

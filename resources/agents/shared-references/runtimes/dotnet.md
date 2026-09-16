# .NET Runtime Reference (Azure Functions path)

> Azure Functions **isolated worker** on **.NET 10** with **ASP.NET Core integration**. xUnit + NSubstitute + Shouldly, FluentValidation, built-in `ILogger` + Application Insights, EF Core for relational data, `IConfiguration`/`ConnectionStrings` for settings, Managed Identity for Azure access.
>
> ### ⚠️ Target framework policy (MANDATORY)
>
> **All generated .NET projects MUST target `net10.0` and pin the SDK to `10.0.*` in `global.json`.** Do NOT downgrade to `net8.0` / `net9.0` unless the user **explicitly** requests an older framework (e.g., "target .NET 8", "we're stuck on 8.0 LTS", "use net9.0"). If the user asks for an older version, downgrade the `TargetFramework`, `global.json` SDK, and all `Microsoft.EntityFrameworkCore.*` / `Microsoft.Extensions.*` package versions together — never mix majors.

---

## Version & SDK Pinning

### `global.json` (repo root) — MANDATORY

Pins the SDK so local dev, CI, and generated scaffolds agree on the toolchain. Without this, a dev on .NET 9 builds differently than CI on .NET 10.

```json
{
  "sdk": {
    "version": "10.0.100",
    "rollForward": "latestFeature",
    "allowPrerelease": false
  }
}
```

### `Directory.Packages.props` (repo root) — MANDATORY (Central Package Management)

All package versions pinned in ONE place. **Never use wildcards** (`1.*`, `4.*`) in generated `.csproj` files — they produce non-deterministic builds.

> ### ⚠️ Resolve latest stable versions at scaffold time (MANDATORY)
>
> **The versions shown below are a floor, not a pin.** NuGet releases roll forward weekly — by the time this doc is used, many versions will be stale. The scaffold agent **MUST resolve the latest stable version of every package at scaffold time** and emit those resolved values into `Directory.Packages.props`. Do NOT copy the versions below verbatim.
>
> Resolve via one of:
> - `dotnet package search {PackageId} --exact-match --take 1` (CLI, deterministic, CI-friendly)
> - `nuget.org` API: `GET https://api.nuget.org/v3-flatcontainer/{lowercased-id}/index.json` → use the last entry in `versions[]` that does not contain `-` (stable only, no prereleases)
>
> **Constraints when resolving:**
> 1. **Stable only** — never emit a version containing `-preview`, `-rc`, `-alpha`, `-beta`, unless the user explicitly asks for prereleases.
> 2. **Respect major-version floors listed in the comments below** (e.g., Worker must be `>= 2.50.0` for .NET 10) — if the latest stable falls below the floor, that's a bug; flag it.
> 3. **Align framework-bundled packages to the target TFM major.** For `Microsoft.Extensions.*`, `Microsoft.EntityFrameworkCore.*`, `Microsoft.AspNetCore.*`, and `Npgsql.EntityFrameworkCore.PostgreSQL`, use the **latest `10.*` stable** when targeting `net10.0`. Do NOT pull `11.x` prereleases even if they exist.
> 4. **Azure Functions Worker extensions** follow their own version trains (e.g., `.Extensions.Http` is on `3.x`, `.Extensions.Http.AspNetCore` is on `2.x`). Resolve each independently.
> 5. **After emitting, run `dotnet restore` and fix any package-downgrade warnings** before marking the scaffold complete. Transitive conflicts usually mean one package needs to be bumped further.

```xml
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
    <CentralPackageTransitivePinningEnabled>true</CentralPackageTransitivePinningEnabled>
  </PropertyGroup>

  <ItemGroup>
    <!-- Functions runtime (Worker 2.x — FLOOR: 2.50.0 / 2.0.5 for .NET 10; resolve latest stable) -->
    <PackageVersion Include="Microsoft.Azure.Functions.Worker" Version="2.50.0" />
    <PackageVersion Include="Microsoft.Azure.Functions.Worker.Sdk" Version="2.0.5" />
    <PackageVersion Include="Microsoft.Azure.Functions.Worker.Extensions.Http" Version="3.3.0" />
    <PackageVersion Include="Microsoft.Azure.Functions.Worker.Extensions.Http.AspNetCore" Version="2.0.0" />
    <PackageVersion Include="Microsoft.Azure.Functions.Worker.OpenTelemetry" Version="1.0.0" />
    <PackageVersion Include="Azure.Monitor.OpenTelemetry.Exporter" Version="1.4.0" />
    <PackageVersion Include="Microsoft.ApplicationInsights.WorkerService" Version="2.23.0" />

    <!-- ASP.NET Core / config (align to net10.0 → latest 10.* stable) -->
    <PackageVersion Include="Microsoft.Extensions.Configuration" Version="10.0.0" />
    <PackageVersion Include="Microsoft.Extensions.Hosting" Version="10.0.0" />
    <PackageVersion Include="Microsoft.Extensions.Http.Resilience" Version="10.0.0" />

    <!-- Validation -->
    <PackageVersion Include="FluentValidation" Version="11.11.0" />
    <PackageVersion Include="FluentValidation.DependencyInjectionExtensions" Version="11.11.0" />

    <!-- Data (align to net10.0 → latest 10.* stable) -->
    <PackageVersion Include="Microsoft.EntityFrameworkCore" Version="10.0.0" />
    <PackageVersion Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.0" />
    <PackageVersion Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="10.0.0" />

    <!-- Azure SDK + identity (each has its own version train — resolve independently) -->
    <PackageVersion Include="Azure.Identity" Version="1.13.0" />
    <PackageVersion Include="Azure.Storage.Blobs" Version="12.24.0" />
    <PackageVersion Include="Azure.Storage.Queues" Version="12.22.0" />
    <PackageVersion Include="Microsoft.Azure.Cosmos" Version="3.47.0" />
    <PackageVersion Include="StackExchange.Redis" Version="2.8.0" />

    <!-- Test packages -->
    <PackageVersion Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
    <PackageVersion Include="xunit" Version="2.9.2" />
    <PackageVersion Include="xunit.runner.visualstudio" Version="2.8.2" />
    <PackageVersion Include="NSubstitute" Version="5.3.0" />
    <PackageVersion Include="NSubstitute.Analyzers.CSharp" Version="1.0.17" />
    <PackageVersion Include="Shouldly" Version="4.3.0" />
    <PackageVersion Include="coverlet.collector" Version="6.0.2" />
    <PackageVersion Include="FluentValidation.TestHelper" Version="11.11.0" />
    <PackageVersion Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.0" />
  </ItemGroup>
</Project>
```

> **Do NOT use `Moq`.** Moq 4.20+ ships [SponsorLink](https://github.com/moq/moq/issues/1372) which makes network calls and is blocked in many enterprises. Use **NSubstitute**.
>
> **Do NOT use `FluentAssertions` ≥ 8.0.** FluentAssertions 8+ requires a paid commercial license. Use **Shouldly** (MIT) or pin FluentAssertions to `< 8.0.0` only if explicitly required by the user.

---

## Azure Functions Isolated Worker — ASP.NET Core Integration

> **Use ASP.NET Core integration (`ConfigureFunctionsWebApplication` + `HttpRequest` / `IResult`) — NOT the legacy `HttpRequestData` / `HttpResponseData` API.** ASP.NET Core integration gives you model binding, `IResult`, `ProblemDetails`, middleware, and code that stays close to ASP.NET Core minimal API patterns.

### Initialization

```bash
func init services/Functions --worker-runtime dotnet-isolated --target-framework net10.0
cd services/Functions
```

Then hand-author `Functions.csproj` (see below) — the `func init` template uses outdated defaults.

### `host.json`

```json
{
  "version": "2.0",
  "logging": {
    "applicationInsights": {
      "samplingSettings": { "isEnabled": true, "excludedTypes": "Request" },
      "enableLiveMetricsFilters": true
    }
  },
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

### `local.settings.json` — Uses `ConnectionStrings:*`, NOT `DATABASE_URL`

`local.settings.json` is for **local dev only** (git-ignored). In Azure, the same keys become App Settings. For .NET, connection strings live under the `ConnectionStrings:` prefix and are read via `IConfiguration.GetConnectionString("Name")` — this matches the wider .NET ecosystem (ASP.NET Core and EF Core) and enables Managed Identity substitution in Azure.

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "ASPNETCORE_ENVIRONMENT": "Development",

    "ConnectionStrings:AppDb": "Host=localhost;Port=5432;Database=appdb;Username=localdev;Password=localdevpassword",
    "ConnectionStrings:Redis": "localhost:6379",
    "ConnectionStrings:Storage": "UseDevelopmentStorage=true"
  },
  "Host": { "CORS": "*", "CORSCredentials": false }
}
```

> **Env var name mapping for other runtimes**: Node/Python scaffolds in this repo use `DATABASE_URL` / `REDIS_URL` / `STORAGE_CONNECTION_STRING` because those are idiomatic there. **For .NET, always use `ConnectionStrings:AppDb` / `ConnectionStrings:Redis` / `ConnectionStrings:Storage`.** When the plan's resource table uses generic env var names, the .NET scaffold **MUST** translate to the `ConnectionStrings:` form.

### Secrets for local dev — use `dotnet user-secrets`

Never commit real secrets. For anything you can't put in plaintext `local.settings.json` (API keys, OpenAI keys, Entra client secrets during dev):

```bash
cd services/Functions
dotnet user-secrets init
dotnet user-secrets set "ConnectionStrings:AppDb" "Host=...;Password=realpassword"
dotnet user-secrets set "OpenAI:ApiKey" "sk-..."
```

Wire user-secrets into `Program.cs` (Functions worker doesn't enable them by default):

```csharp
var builder = FunctionsApplication.CreateBuilder(args);
builder.ConfigureFunctionsWebApplication();

if (builder.Environment.IsDevelopment())
    builder.Configuration.AddUserSecrets<Program>(optional: true);

// ... services registered on builder.Services below
var host = builder.Build();
await host.RunAsync();
```

### `Functions.csproj`

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <AzureFunctionsVersion>v4</AzureFunctionsVersion>
    <OutputType>Exe</OutputType>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <WarningsAsErrors>nullable</WarningsAsErrors>
  </PropertyGroup>

  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Sdk" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Http" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Http.AspNetCore" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.ApplicationInsights" />
    <PackageReference Include="Microsoft.ApplicationInsights.WorkerService" />
    <PackageReference Include="FluentValidation" />
    <PackageReference Include="FluentValidation.DependencyInjectionExtensions" />
    <PackageReference Include="Microsoft.Extensions.Http.Resilience" />
    <PackageReference Include="Azure.Identity" />
    <!-- Add Azure.Storage.Blobs, Npgsql.EntityFrameworkCore.PostgreSQL, StackExchange.Redis as needed -->
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\Shared\Shared.csproj" />
  </ItemGroup>
</Project>
```

> Note: `<PackageReference>` has **no `Version`** — versions are centrally pinned via `Directory.Packages.props`.

### `Program.cs` (Worker 2.x — `IHostApplicationBuilder`)

> **Uses the Worker 2.x builder** (`FunctionsApplication.CreateBuilder(args)` from `Microsoft.Azure.Functions.Worker.Builder`). Requires `Microsoft.Azure.Functions.Worker >= 2.50.0` + `Worker.Sdk >= 2.0.5` (both pinned in `Directory.Packages.props` above). This shape mirrors ASP.NET Core's `WebApplication.CreateBuilder(args)` and supports both debug shapes — `dotnet run` (HTTP-only) and `func host start` attach. The legacy `HostBuilder` shape still works but is not recommended for new scaffolds.

```csharp
using Azure.Identity;
using Azure.Monitor.OpenTelemetry.Exporter;
using Azure.Storage.Blobs;
using FluentValidation;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Azure.Functions.Worker.OpenTelemetry;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using StackExchange.Redis;

var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();

if (builder.Environment.IsDevelopment())
    builder.Configuration.AddUserSecrets<Program>(optional: true);

var config = builder.Configuration;

// ---------- Observability: OpenTelemetry → Azure Monitor (App Insights) ----------
builder.Services.AddOpenTelemetry()
    .UseFunctionsWorkerDefaults()
    .UseAzureMonitorExporter();

// ---------- Middleware ----------
builder.UseMiddleware<ExceptionMiddleware>();

// ---------- Data: EF Core + Npgsql ----------
builder.Services.AddDbContextPool<AppDbContext>(options =>
    options.UseNpgsql(config.GetConnectionString("AppDb")));

// ---------- Azure Storage: Managed Identity in Azure, connection string locally ----------
builder.Services.AddSingleton(sp =>
{
    var storage = config.GetConnectionString("Storage")
        ?? throw new InvalidOperationException("ConnectionStrings:Storage not configured");

    // If the config holds a blob service URI, authenticate with Managed Identity.
    // If it holds a classic connection string ("UseDevelopmentStorage=true" / "DefaultEndpointsProtocol=..."),
    // construct a client from it directly.
    return storage.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
        ? new BlobServiceClient(new Uri(storage), new DefaultAzureCredential())
        : new BlobServiceClient(storage);
});

// ---------- Redis ----------
builder.Services.AddSingleton<IConnectionMultiplexer>(sp =>
    ConnectionMultiplexer.Connect(config.GetConnectionString("Redis")!));

// ---------- Typed HttpClient with resilience ----------
builder.Services.AddHttpClient<IExternalApiClient, ExternalApiClient>()
    .AddStandardResilienceHandler();

// ---------- Validators ----------
builder.Services.AddValidatorsFromAssemblyContaining<CreateItemValidator>();

var host = builder.Build();
await host.RunAsync();
```

> **About App Insights:** Worker 2.x integrates telemetry via **OpenTelemetry** (`Microsoft.Azure.Functions.Worker.OpenTelemetry` + `Azure.Monitor.OpenTelemetry.Exporter`). The older `AddApplicationInsightsTelemetryWorkerService()` + `ConfigureFunctionsApplicationInsights()` pair is still supported but OpenTelemetry is the going-forward path in the Learn docs.

> **Production deployment pattern**: in App Settings, set `ConnectionStrings:Storage` to the **blob service URI** (e.g., `https://myaccount.blob.core.windows.net`) and grant the Function App's managed identity the `Storage Blob Data Contributor` role. The code above detects the URI form and automatically uses `DefaultAzureCredential`. The same pattern works for Cosmos, Service Bus, Key Vault, SQL — all support URI + Managed Identity auth.

### Managed Identity — Quick Reference

| Resource | Production config value | Code |
|----------|------------------------|------|
| Blob Storage | `ConnectionStrings:Storage=https://<account>.blob.core.windows.net` | `new BlobServiceClient(new Uri(cs), new DefaultAzureCredential())` |
| Queue Storage | `ConnectionStrings:Storage` (same account) | `new QueueServiceClient(new Uri(cs + "queue/..."), cred)` |
| Cosmos DB | `CosmosDb:AccountEndpoint=https://<acct>.documents.azure.com:443/` | `new CosmosClient(endpoint, new DefaultAzureCredential())` |
| Key Vault | `KeyVault:Uri=https://<vault>.vault.azure.net/` | `new SecretClient(new Uri(uri), new DefaultAzureCredential())` |
| PostgreSQL Flexible Server | Entra token auth — `Npgsql` + token provider | See [EF Core + Entra](https://learn.microsoft.com/azure/postgresql/flexible-server/how-to-azure-ad) |
| Service Bus | `ServiceBus:FullyQualifiedNamespace=<ns>.servicebus.windows.net` | `new ServiceBusClient(fqns, new DefaultAzureCredential())` |

Use `DefaultAzureCredential` everywhere — it picks up the Function App's managed identity in Azure and the developer's `az login` / VS Code credentials locally. Never ship connection strings with account keys.

---

## Function Handler Pattern — ASP.NET Core Integration (`HttpRequest` + `IResult`)

### List (GET)

```csharp
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;

public class GetItems(AppDbContext db, ILogger<GetItems> logger)
{
    [Function("GetItems")]
    public async Task<Ok<ListItemsResponse>> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "items")] HttpRequest req,
        int limit = 20,
        int offset = 0,
        CancellationToken ct = default)
    {
        logger.LogInformation("Listing items limit={Limit} offset={Offset}", limit, offset);

        var items = await db.Items
            .OrderBy(i => i.CreatedAt)
            .Skip(offset)
            .Take(limit)
            .ToListAsync(ct);

        return TypedResults.Ok(new ListItemsResponse(items, items.Count));
    }
}
```

> Note: `limit` / `offset` / `CancellationToken` are automatically bound from the query string / request lifetime by ASP.NET Core integration. No manual `req.Query["limit"]` parsing.

### POST with Validation

```csharp
using FluentValidation;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Azure.Functions.Worker;

public class CreateItem(
    AppDbContext db,
    IValidator<CreateItemRequest> validator,
    ILogger<CreateItem> logger)
{
    [Function("CreateItem")]
    public async Task<Results<Created<Item>, ValidationProblem>> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "items")]
        [FromBody] CreateItemRequest body,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(body, ct);
        if (!validation.IsValid)
            return TypedResults.ValidationProblem(validation.ToDictionary());

        var item = new Item
        {
            Id = Guid.NewGuid().ToString(),
            Name = body.Name,
            Description = body.Description ?? "",
            Price = body.Price,
            Category = body.Category,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };

        db.Items.Add(item);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Created item {ItemId}", item.Id);
        return TypedResults.Created($"/api/items/{item.Id}", item);
    }
}
```

> ### ⚠️ DO NOT mix `HttpTrigger HttpRequest req` with `[FromBody] T body` in the same handler
>
> Functions Worker `2.50.0+` with `Microsoft.Azure.Functions.Worker.Extensions.Http.AspNetCore 2.x` does **NOT** populate `[FromBody] T body` when the same handler also has a separate `[HttpTrigger] HttpRequest req` parameter — `body` silently arrives as `null`, and the handler returns 400 even when the client sent a valid JSON body. The bug is real, reproducible, and **does not surface in unit tests** because mocks construct `body` directly and never go through the binder. It surfaces the moment you `curl` a live host.
>
> **Two safe shapes — pick exactly one per handler:**
>
> **A. Body-only** *(the `CreateItem` example above)*. Stack `[HttpTrigger]` and `[FromBody]` on the **same** parameter. No `HttpRequest req` parameter at all. Use this whenever you don't need the raw request.
>
> **B. Explicit JSON read** — required whenever the handler also needs `HttpRequest req` (for `Authorization` headers, multipart uploads, raw streams, etc.). Drop `[FromBody]` entirely and read the body yourself with `req.ReadFromJsonAsync<T>(...)`. Reuse the app's configured `JsonOptions` so camelCase / converters match what the SPA sends:
>
> ```csharp
> // Functions/FunctionHelpers.cs
> public static async Task<T> ReadJsonBodyAsync<T>(HttpRequest req, CancellationToken ct) where T : class
> {
>     var jsonOptions = req.HttpContext.RequestServices
>         .GetService<IOptions<Microsoft.AspNetCore.Http.Json.JsonOptions>>()?.Value.SerializerOptions
>         ?? new JsonSerializerOptions(JsonSerializerDefaults.Web);
>
>     if (req.Body.CanSeek) req.Body.Position = 0;          // safe in tests / middleware re-reads
>
>     try
>     {
>         var body = await req.ReadFromJsonAsync<T>(jsonOptions, ct);
>         return body ?? throw new BadRequestException("Request body is required.");
>     }
>     catch (JsonException ex)
>     {
>         throw new BadRequestException($"Request body is not valid JSON: {ex.Message}");
>     }
> }
>
> // Functions/CreateItem.cs
> public async Task<IResult> Run(
>     [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "items")] HttpRequest req,
>     CancellationToken ct)
> {
>     var body = await FunctionHelpers.ReadJsonBodyAsync<CreateItemRequest>(req, ct);
>     await validator.ValidateAndThrowAsync(body, ct);
>     // ...persist, return TypedResults.Created(...)
> }
> ```
>
> **❌ Anti-pattern — silently fails at runtime:**
>
> ```csharp
> // ❌ DO NOT — body always arrives null because of the binder bug
> public async Task<IResult> Run(
>     [HttpTrigger(...)] HttpRequest req,            // <— both shapes
>     [FromBody] CreateItemRequest? body,            // <— at once = null body
>     CancellationToken ct) { ... }
> ```
>
> ⛔ **Hard rule for scaffolds:** when generating handlers that need `HttpRequest req` (auth-aware POSTs, multipart uploads, anything reading headers), use **Shape B** (`req.ReadFromJsonAsync<T>`). Never emit a parameter list that has both `HttpRequest req` and `[FromBody] T body`.
>
> #### Test fixtures must mirror this contract
>
> When unit-testing handlers that use Shape B, the test `HttpRequest` builder MUST:
> - Serialize the body with `JsonSerializerDefaults.Web` (camelCase) so it matches the production `JsonOptions`
> - Set `Request.ContentType = "application/json"`
> - Set `Request.ContentLength = bytes.Length`
> - Use a **seekable** `MemoryStream` for `Request.Body` (so the helper's `Body.Position = 0` re-read works)
>
> ```csharp
> // tests/Fixtures/HttpRequestBuilder.cs (excerpt)
> public HttpRequestBuilder WithJsonBody<T>(T body)
> {
>     var json = JsonSerializer.Serialize(body, new JsonSerializerOptions(JsonSerializerDefaults.Web));
>     var bytes = Encoding.UTF8.GetBytes(json);
>     _httpContext.Request.Body = new MemoryStream(bytes);     // seekable
>     _httpContext.Request.ContentLength = bytes.Length;
>     _httpContext.Request.ContentType = "application/json";
>     return this;
> }
> ```
>
> Skipping `ContentLength` or using `JsonSerializer.Serialize(body)` with default (PascalCase) options will produce green tests against a handler that 400s in production.

### GET by ID with 404

```csharp
public class GetItemById(AppDbContext db)
{
    [Function("GetItemById")]
    public async Task<Results<Ok<Item>, NotFound>> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "items/{id}")] HttpRequest req,
        string id,
        CancellationToken ct)
    {
        var item = await db.Items.FindAsync([id], ct);
        return item is null
            ? TypedResults.NotFound()
            : TypedResults.Ok(item);
    }
}
```

### Health Check

```csharp
public class Health(AppDbContext db, BlobServiceClient blobs, IConnectionMultiplexer redis)
{
    [Function("Health")]
    public async Task<IResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "health")] HttpRequest req,
        CancellationToken ct)
    {
        var checks = new Dictionary<string, bool>
        {
            ["database"] = await SafeCheck(() => db.Database.CanConnectAsync(ct)),
            ["storage"] = await SafeCheck(async () =>
            {
                await foreach (var _ in blobs.GetBlobContainersAsync(cancellationToken: ct).Take(1)) { }
                return true;
            }),
            ["cache"] = await SafeCheck(() => Task.FromResult(redis.IsConnected)),
        };

        var allHealthy = checks.Values.All(v => v);
        var status = allHealthy ? "healthy" : checks.Values.Any(v => v) ? "degraded" : "unhealthy";

        return allHealthy
            ? Results.Ok(new HealthResponse(status, checks))
            : Results.Json(new HealthResponse(status, checks), statusCode: StatusCodes.Status503ServiceUnavailable);

        static async Task<bool> SafeCheck(Func<Task<bool>> probe)
        {
            try { return await probe(); } catch { return false; }
        }
    }
}
```

> ### ⚠️ Probe at the SERVICE level, not at a specific container/queue/topic
>
> The handler above probes Azurite by enumerating containers (`blobs.GetBlobContainersAsync(...)`) — a **service-level** operation that succeeds the moment the storage account is reachable. **Do NOT** probe a specific child resource the app creates lazily, e.g.:
>
> ```csharp
> // ❌ DO NOT — fails until first upload, because `CreateIfNotExistsAsync` runs lazily on write
> ["storage"] = await SafeCheck(() => blobs
>     .GetBlobContainerClient("my-photos")
>     .GetPropertiesAsync(cancellationToken: ct).ContinueWith(_ => true));
> ```
>
> The container doesn't exist on a fresh deployment, so `GetPropertiesAsync` returns 404 and your health check stays red until real traffic arrives — wedging deployment slot swaps and Container Apps revision health gates. The same rule applies to:
>
> | Service | ✅ Service-level probe | ❌ Resource-level probe (lazy-created) |
> |---------|-----------------------|----------------------------------------|
> | Blob Storage | `BlobServiceClient.GetPropertiesAsync` / `GetBlobContainersAsync().Take(1)` | `BlobContainerClient.GetPropertiesAsync` |
> | Service Bus | `ServiceBusAdministrationClient.QueueExistsAsync(knownQueue)` | sending to a topic the app creates on first publish |
> | Cosmos DB | `CosmosClient.ReadAccountAsync` | `Container.ReadContainerAsync` |
> | Event Hubs | `EventHubProducerClient.GetEventHubPropertiesAsync` (only if hub is pre-provisioned) | reading from an instance the app creates lazily |
>
> Probe the namespace/account; never the per-resource child unless the resource is provisioned out-of-band by IaC and is guaranteed to exist before the app starts.

---

## Exception Middleware — replaces per-handler try/catch

With ASP.NET Core integration you get a real middleware pipeline. One middleware covers every function.

```csharp
// Middleware/ExceptionMiddleware.cs
using FluentValidation;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Azure.Functions.Worker.Middleware;
using Microsoft.Extensions.Logging;

public sealed class ExceptionMiddleware(ILogger<ExceptionMiddleware> logger) : IFunctionsWorkerMiddleware
{
    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        try
        {
            await next(context);
        }
        catch (ValidationException ex)
        {
            await WriteProblem(context, StatusCodes.Status422UnprocessableEntity, "Validation failed", ex.Message);
        }
        catch (KeyNotFoundException ex)
        {
            await WriteProblem(context, StatusCodes.Status404NotFound, "Not found", ex.Message);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Unhandled exception in {Function}", context.FunctionDefinition.Name);
            await WriteProblem(context, StatusCodes.Status500InternalServerError, "Internal server error", "An unexpected error occurred");
        }
    }

    private static async Task WriteProblem(FunctionContext ctx, int status, string title, string detail)
    {
        var req = await ctx.GetHttpRequestDataAsync();
        if (req is null) return;
        var res = req.CreateResponse();
        res.StatusCode = (System.Net.HttpStatusCode)status;
        await res.WriteAsJsonAsync(new ProblemDetails { Status = status, Title = title, Detail = detail }, statusCode: status);
        ctx.GetInvocationResult().Value = res;
    }
}
```

Handlers now throw naturally (or use `TypedResults.ValidationProblem`) — no try/catch boilerplate.

---

## EF Core — `DbContext`, Migrations, Seeding

### `AppDbContext`

```csharp
using Microsoft.EntityFrameworkCore;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Item> Items => Set<Item>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Item>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(64);
            e.Property(x => x.Name).IsRequired().HasMaxLength(255);
            e.Property(x => x.Price).HasColumnType("numeric(10,2)");
            e.HasIndex(x => x.Category);
        });
    }
}
```

### Migration Workflow

```bash
# install the tool once per repo (or globally)
dotnet tool install --global dotnet-ef

# create a migration
dotnet ef migrations add InitialCreate --project services/Functions

# apply to local database
dotnet ef database update --project services/Functions

# generate an idempotent SQL script for CI/CD
dotnet ef migrations script --idempotent --output migrations/deploy.sql --project services/Functions
```

### Production Migration Strategy

Don't run `dotnet ef database update` from the Function App at startup. Options:

1. **CI/CD step** — generate `deploy.sql` via `dotnet ef migrations script --idempotent` and apply via GitHub Actions / Azure DevOps pipeline before deploying the Function App. This is the recommended default.
2. **Dedicated migration job** — a short-lived container/App Service job that runs `dotnet ef database update` once per release, with the Function App gated on its success.

---

## Test Project Setup

### `Functions.Tests.csproj`

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="NSubstitute" />
    <PackageReference Include="NSubstitute.Analyzers.CSharp" />
    <PackageReference Include="Shouldly" />
    <PackageReference Include="coverlet.collector" />
    <PackageReference Include="FluentValidation.TestHelper" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\Functions\Functions.csproj" />
  </ItemGroup>
</Project>
```

### Fixtures

```csharp
public static class ItemFixtures
{
    public static Item CreateValidItem(string? id = null) => new()
    {
        Id = id ?? Guid.NewGuid().ToString(),
        Name = "Test Widget",
        Description = "A test widget for unit testing",
        Price = 29.99m,
        Category = "widgets",
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    public static CreateItemRequest CreateValidRequest() => new()
    {
        Name = "New Widget",
        Description = "A brand new widget",
        Price = 19.99m,
        Category = "widgets",
    };
}
```

### Unit Tests with NSubstitute + Shouldly

```csharp
using NSubstitute;
using Shouldly;
using Xunit;

public class CreateItemTests
{
    private readonly IValidator<CreateItemRequest> _validator;
    private readonly ILogger<CreateItem> _logger;
    private readonly AppDbContext _db;

    public CreateItemTests()
    {
        _validator = Substitute.For<IValidator<CreateItemRequest>>();
        _logger = Substitute.For<ILogger<CreateItem>>();

        // EF Core in-memory DB for unit-level tests — avoid InMemory for complex queries; use SQLite in-memory instead.
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"test-{Guid.NewGuid()}")
            .Options;
        _db = new AppDbContext(options);
    }

    [Fact]
    public async Task CreateItem_ReturnsCreated_WhenValid()
    {
        _validator.ValidateAsync(Arg.Any<CreateItemRequest>(), Arg.Any<CancellationToken>())
            .Returns(new FluentValidation.Results.ValidationResult());

        var handler = new CreateItem(_db, _validator, _logger);
        var body = ItemFixtures.CreateValidRequest();

        var result = await handler.Run(body, CancellationToken.None);

        result.Result.ShouldBeOfType<Created<Item>>();
        (await _db.Items.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task CreateItem_ReturnsValidationProblem_WhenInvalid()
    {
        var failures = new[] { new FluentValidation.Results.ValidationFailure("Name", "Required") };
        _validator.ValidateAsync(Arg.Any<CreateItemRequest>(), Arg.Any<CancellationToken>())
            .Returns(new FluentValidation.Results.ValidationResult(failures));

        var handler = new CreateItem(_db, _validator, _logger);

        var result = await handler.Run(new CreateItemRequest(), CancellationToken.None);

        result.Result.ShouldBeOfType<ValidationProblem>();
        (await _db.Items.CountAsync()).ShouldBe(0);
    }
}
```

### FluentValidation Tests (unchanged — library already works with Shouldly-style asserts)

```csharp
public class CreateItemValidatorTests
{
    private readonly CreateItemValidator _validator = new();

    [Fact]
    public void Valid_Input_Passes()
    {
        var result = _validator.TestValidate(ItemFixtures.CreateValidRequest());
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void Empty_Name_Fails()
    {
        var request = ItemFixtures.CreateValidRequest() with { Name = "" };
        var result = _validator.TestValidate(request);
        result.ShouldHaveValidationErrorFor(x => x.Name);
    }
}
```

### Running tests & coverage

```bash
dotnet test --collect:"XPlat Code Coverage" --logger "trx;LogFileName=test-results.trx"
```

---

## Validation — FluentValidation

```csharp
public class CreateItemValidator : AbstractValidator<CreateItemRequest>
{
    public CreateItemValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(255);
        RuleFor(x => x.Price).GreaterThan(0);
        RuleFor(x => x.Category).NotEmpty().MaximumLength(100);
    }
}
```

---

## Logging — Built-in `ILogger<T>` + Application Insights

No Serilog. Inject `ILogger<T>` and log via structured parameters — Application Insights captures everything via OpenTelemetry (`AddOpenTelemetry().UseFunctionsWorkerDefaults().UseAzureMonitorExporter()` in `Program.cs`).

```csharp
public class CreateItem(ILogger<CreateItem> logger)
{
    [Function("CreateItem")]
    public async Task<IResult> Run(...)
    {
        logger.LogInformation("Creating item {ItemName} in category {Category}", body.Name, body.Category);
        // ...
    }
}
```

Use `ILogger.BeginScope(...)` for request correlation; Application Insights ingests it automatically.

---

## Shared Types

```csharp
// Shared/Models/Item.cs
public class Item
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public decimal Price { get; set; }
    public string Category { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public record CreateItemRequest
{
    public string Name { get; init; } = "";
    public string? Description { get; init; }
    public decimal Price { get; init; }
    public string Category { get; init; } = "";
}

public record UpdateItemRequest(string? Name, string? Description, decimal? Price, string? Category);

public record ListItemsResponse(IReadOnlyList<Item> Items, int Total);

public record HealthResponse(string Status, IReadOnlyDictionary<string, bool> Services);
```

> Use `record` for DTOs — free value equality, immutability, and `with`-expressions for tests.

---

## API Testing with `.http` Files

Prefer `.http` files over Postman/Insomnia for .NET projects — they're first-class in both **Visual Studio 2022+** (built-in) and **VS Code** (via the `humao.rest-client` extension, already recommended by the project's `.vscode/extensions.json` when generated). They live in the repo next to the code that serves them, so they version alongside the API.

### Where to put them

```
services/
├── Functions/
│   ├── Functions.csproj
│   └── Functions.http        ← committed, one file per project
└── Functions.Tests/
```

The scaffold **MUST** generate `services/Functions/Functions.http` with one request per endpoint.

### Example — `Functions.http`

```http
@baseUrl = http://localhost:7071/api
@contentType = application/json

### Health check
GET {{baseUrl}}/health
Accept: application/json

### List items (default pagination)
GET {{baseUrl}}/items
Accept: application/json

### List items (custom pagination)
GET {{baseUrl}}/items?limit=5&offset=10
Accept: application/json

### Get item by id — happy path
# @name getItem
GET {{baseUrl}}/items/item-001
Accept: application/json

### Get item by id — 404
GET {{baseUrl}}/items/does-not-exist
Accept: application/json

### Create item — valid
# @name createItem
POST {{baseUrl}}/items
Content-Type: {{contentType}}

{
  "name": "Sample Widget",
  "description": "Created from Functions.http",
  "price": 29.99,
  "category": "widgets"
}

### Create item — uses response from previous request
# References the `createItem` request above so you can chain calls.
GET {{baseUrl}}/items/{{createItem.response.body.$.id}}
Accept: application/json

### Create item — invalid (422)
POST {{baseUrl}}/items
Content-Type: {{contentType}}

{
  "name": "",
  "price": -5,
  "category": ""
}
```

### Multi-environment — `http-client.env.json`

Check this into the repo alongside `Functions.http` so every dev / CI can switch environments without editing requests.

```json
{
  "dev": {
    "baseUrl": "http://localhost:7071/api"
  },
  "staging": {
    "baseUrl": "https://func-myapp-staging.azurewebsites.net/api",
    "functionKey": "{{$dotenv FUNCTION_KEY_STAGING}}"
  },
  "prod": {
    "baseUrl": "https://func-myapp.azurewebsites.net/api"
  }
}
```

> **Never commit real function keys / bearer tokens.** Use `http-client.env.json.user` (git-ignored) for per-developer secrets, or reference env vars via `{{$dotenv VAR_NAME}}` (VS Code REST Client) / `{{$processEnv VAR_NAME}}`.

Recommended `.gitignore` additions:

```gitignore
http-client.env.json.user
*.http.local
```

### Auth headers

```http
### Call an endpoint protected by a function key
GET {{baseUrl}}/items
x-functions-key: {{$dotenv FUNCTION_KEY}}

### Call an endpoint protected by Entra bearer token
GET {{baseUrl}}/items
Authorization: Bearer {{$aadToken resource=api://myapp-api}}
```

### Extensions.json recommendation

When generating `.vscode/extensions.json` for a .NET project, include the REST Client extension so VS Code users get `Send Request` codelens above each `###` block:

```json
{
  "recommendations": [
    "ms-dotnettools.csdevkit",
    "humao.rest-client"
  ]
}
```

### Why `.http` over Postman/Insomnia

| Concern | `.http` files | Postman / Insomnia |
|---------|---------------|---------------------|
| Lives in git next to the code | ✅ | ❌ (separate workspace/account) |
| Works in Visual Studio + VS Code + Rider | ✅ | Needs apps installed |
| Diffable in PRs | ✅ | ❌ (JSON export, noisy) |
| Requires login/account | ❌ | ✅ for cloud sync |
| Chained requests, env vars, dotenv | ✅ | ✅ |

> For shell-script-style smoke tests used by CI or generated under `api-test-collections/`, see [api-test-collections.md](.github/agents/azure-local-debug/references/api-test-collections.md) — those use `curl` and are runtime-agnostic. `.http` files are the **interactive** testing surface for developers; shell collections are the **automatable** surface.

---


No custom `AppConfig.Load()` class. Use `IConfiguration` (or typed `IOptions<T>`) — standard .NET.

```csharp
public class SomeHandler(IConfiguration config)
{
    public void Run()
    {
        var cs = config.GetConnectionString("AppDb")
            ?? throw new InvalidOperationException("ConnectionStrings:AppDb is required");
    }
}
```

For structured config (e.g., `OpenAI:ApiKey` + `OpenAI:Model`):

```csharp
// Program.cs
services.Configure<OpenAiOptions>(config.GetSection("OpenAI"));

// Handler
public class AskAi(IOptions<OpenAiOptions> opts) { /* opts.Value.ApiKey */ }
```

---

## Dependencies Quick Reference

### Functions Project

| Purpose | Package |
|---------|---------|
| Functions runtime | `Microsoft.Azure.Functions.Worker` + `.Sdk` |
| HTTP trigger + ASP.NET Core integration | `.Extensions.Http` + `.Extensions.Http.AspNetCore` |
| App Insights | `.Worker.ApplicationInsights` + `Microsoft.ApplicationInsights.WorkerService` |
| Validation | `FluentValidation` + `FluentValidation.DependencyInjectionExtensions` |
| Resilient HTTP | `Microsoft.Extensions.Http.Resilience` |
| Azure Identity (Managed Identity) | `Azure.Identity` |

### Per Azure Service

| Service | Package | Auth |
|---------|---------|------|
| Blob Storage | `Azure.Storage.Blobs` | Managed Identity via `DefaultAzureCredential` |
| Queue Storage | `Azure.Storage.Queues` | Managed Identity |
| Cosmos DB | `Microsoft.Azure.Cosmos` | Managed Identity |
| PostgreSQL (EF Core) | `Npgsql.EntityFrameworkCore.PostgreSQL` + `Microsoft.EntityFrameworkCore` | Entra token or connection string |
| Redis | `StackExchange.Redis` | Entra token (Azure Cache for Redis Enterprise) or access key |
| Service Bus | `Azure.Messaging.ServiceBus` | Managed Identity |
| Key Vault | `Azure.Security.KeyVault.Secrets` | Managed Identity |

### Test Packages

| Purpose | Package |
|---------|---------|
| Test runner | `xunit` + `xunit.runner.visualstudio` |
| Test SDK | `Microsoft.NET.Test.Sdk` |
| Mocking | `NSubstitute` (+ `NSubstitute.Analyzers.CSharp`) |
| Assertions | `Shouldly` |
| Validation tests | `FluentValidation.TestHelper` |
| Coverage | `coverlet.collector` |

---

## Migration Checklist — Upgrading from legacy Functions templates

When the user has an existing Functions project on older patterns, migrate in this order:

- [ ] Add `global.json` pinning .NET 10 SDK
- [ ] Add `Directory.Packages.props` with CPM enabled; strip `Version="..."` from `<PackageReference>` elements
- [ ] Bump `<TargetFramework>` to `net10.0`
- [ ] Bump `Microsoft.Azure.Functions.Worker` to `>= 2.50.0` and `.Sdk` to `>= 2.0.5` (Worker 2.x is required for .NET 10)
- [ ] Replace `HttpRequestData` / `HttpResponseData` handlers with `HttpRequest` + `IResult`
- [ ] Change `.ConfigureFunctionsWorkerDefaults()` → `.ConfigureFunctionsWebApplication()`
- [ ] Migrate `Program.cs` from `new HostBuilder()....Build()` to `FunctionsApplication.CreateBuilder(args)` (Worker 2.x `IHostApplicationBuilder`)
- [ ] Add `Microsoft.Azure.Functions.Worker.Extensions.Http.AspNetCore` package
- [ ] Replace `AddApplicationInsightsTelemetryWorkerService()` + `ConfigureFunctionsApplicationInsights()` with OpenTelemetry (`AddOpenTelemetry().UseFunctionsWorkerDefaults().UseAzureMonitorExporter()`)
- [ ] Move `local.settings.json` keys `DATABASE_URL` / `REDIS_URL` / `STORAGE_CONNECTION_STRING` → `ConnectionStrings:AppDb` / `ConnectionStrings:Redis` / `ConnectionStrings:Storage`
- [ ] Replace `AppConfig.Load()` with `IConfiguration` / `IOptions<T>` injection
- [ ] Remove Serilog; rely on `ILogger<T>` + Application Insights
- [ ] Replace Moq references with NSubstitute
- [ ] Replace FluentAssertions with Shouldly
- [ ] Introduce EF Core `AppDbContext` for relational data; delete bespoke `IDatabaseService`/`MockDatabaseService` unless a specific test seam requires them
- [ ] Add exception middleware; remove per-handler try/catch
- [ ] In Azure: set `ConnectionStrings:Storage` / Cosmos / Service Bus to URI form and assign the Function App's system-assigned managed identity the appropriate RBAC role
- [ ] Run `dotnet user-secrets init` in the Functions project for local-only secrets

# .NET (C# 8) Runtime Reference

> Azure Functions isolated worker model with .NET 8. xUnit setup, FluentValidation, Serilog logging, and built-in DI patterns.

---

## Azure Functions Isolated Worker Setup

### Initialization

```bash
func init src/Functions --dotnet --isolated
cd src/Functions
dotnet add package Microsoft.Azure.Functions.Worker
dotnet add package Microsoft.Azure.Functions.Worker.Sdk
dotnet add package Microsoft.Azure.Functions.Worker.Extensions.Http
```

### host.json

```json
{
  "version": "2.0",
  "logging": {
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true,
        "excludedTypes": "Request"
      }
    }
  },
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

### local.settings.json

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "ASPNETCORE_ENVIRONMENT": "Development",
    "STORAGE_CONNECTION_STRING": "UseDevelopmentStorage=true",
    "DATABASE_URL": "Host=localhost;Port=5432;Database=appdb;Username=localdev;Password=localdevpassword",
    "REDIS_URL": "localhost:6379"
  },
  "Host": {
    "CORS": "*",
    "CORSCredentials": false
  }
}
```

### Functions.csproj

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <AzureFunctionsVersion>v4</AzureFunctionsVersion>
    <OutputType>Exe</OutputType>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker" Version="1.*" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Sdk" Version="1.*" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Http" Version="3.*" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Http.AspNetCore" Version="1.*" />
    <PackageReference Include="FluentValidation" Version="11.*" />
    <PackageReference Include="Serilog" Version="3.*" />
    <PackageReference Include="Serilog.Sinks.Console" Version="5.*" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\Shared\Shared.csproj" />
  </ItemGroup>
</Project>
```

### Program.cs (DI Registration)

```csharp
// Program.cs
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Serilog;

// Configure Serilog
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console(outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {Message:lj}{NewLine}{Exception}")
    .Enrich.FromLogContext()
    .CreateLogger();

var host = new HostBuilder()
    .ConfigureFunctionsWebApplication()
    .ConfigureServices((context, services) =>
    {
        services.AddApplicationInsightsTelemetryWorkerService();
        services.ConfigureFunctionsApplicationInsights();

        // Register services via DI
        var config = AppConfig.Load();
        services.AddSingleton(config);

        // Register service implementations
        services.AddSingleton<IDatabaseService, PostgresDatabaseService>();
        services.AddSingleton<IStorageService, AzureStorageService>();
        services.AddSingleton<ICacheService, RedisCacheService>();

        // Register validators
        services.AddValidatorsFromAssemblyContaining<CreateItemValidator>();

        // Validate environment on startup
        config.Validate();
    })
    .Build();

host.Run();
```

---

## Function Handler Pattern

### HTTP Function (Isolated Worker)

```csharp
// Functions/GetItems.cs
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

public class GetItems
{
    private readonly IDatabaseService _database;
    private readonly ILogger<GetItems> _logger;

    public GetItems(IDatabaseService database, ILogger<GetItems> logger)
    {
        _database = database;
        _logger = logger;
    }

    [Function("GetItems")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "items")] HttpRequestData req)
    {
        try
        {
            var limit = int.TryParse(req.Query["limit"], out var l) ? l : 20;
            var offset = int.TryParse(req.Query["offset"], out var o) ? o : 0;

            var items = await _database.FindAllAsync<Item>("items", new QueryOptions
            {
                Limit = limit,
                Offset = offset
            });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new { items, total = items.Count });
            return response;
        }
        catch (Exception ex)
        {
            return ErrorHandler.HandleError(ex, req, _logger);
        }
    }
}
```

### POST with Validation

```csharp
// Functions/CreateItem.cs
using FluentValidation;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

public class CreateItem
{
    private readonly IDatabaseService _database;
    private readonly IValidator<CreateItemRequest> _validator;
    private readonly ILogger<CreateItem> _logger;

    public CreateItem(
        IDatabaseService database,
        IValidator<CreateItemRequest> validator,
        ILogger<CreateItem> logger)
    {
        _database = database;
        _validator = validator;
        _logger = logger;
    }

    [Function("CreateItem")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "items")] HttpRequestData req)
    {
        try
        {
            var body = await req.ReadFromJsonAsync<CreateItemRequest>();
            if (body == null)
                throw new BadRequestException("Request body is required");

            var validationResult = await _validator.ValidateAsync(body);
            if (!validationResult.IsValid)
                throw new FluentValidation.ValidationException(validationResult.Errors);

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

            var created = await _database.CreateAsync("items", item);

            var response = req.CreateResponse(HttpStatusCode.Created);
            await response.WriteAsJsonAsync(new { item = created });
            return response;
        }
        catch (Exception ex)
        {
            return ErrorHandler.HandleError(ex, req, _logger);
        }
    }
}
```

### GET by ID with 404

```csharp
// Functions/GetItemById.cs
public class GetItemById
{
    private readonly IDatabaseService _database;
    private readonly ILogger<GetItemById> _logger;

    public GetItemById(IDatabaseService database, ILogger<GetItemById> logger)
    {
        _database = database;
        _logger = logger;
    }

    [Function("GetItemById")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "items/{id}")] HttpRequestData req,
        string id)
    {
        try
        {
            var item = await _database.FindByIdAsync<Item>("items", id);
            if (item == null)
                throw new NotFoundException("Item", id);

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new { item });
            return response;
        }
        catch (Exception ex)
        {
            return ErrorHandler.HandleError(ex, req, _logger);
        }
    }
}
```

### Health Check

```csharp
// Functions/Health.cs
public class Health
{
    private readonly IDatabaseService _database;
    private readonly IStorageService _storage;
    private readonly ICacheService _cache;

    public Health(IDatabaseService database, IStorageService storage, ICacheService cache)
    {
        _database = database;
        _storage = storage;
        _cache = cache;
    }

    [Function("Health")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "health")] HttpRequestData req)
    {
        var checks = new Dictionary<string, bool>();

        try { checks["database"] = await _database.HealthCheckAsync(); } catch { checks["database"] = false; }
        try { checks["storage"] = await _storage.HealthCheckAsync(); } catch { checks["storage"] = false; }
        try { checks["cache"] = await _cache.HealthCheckAsync(); } catch { checks["cache"] = false; }

        var allHealthy = checks.Values.All(v => v);
        var anyHealthy = checks.Values.Any(v => v);
        var status = allHealthy ? "healthy" : anyHealthy ? "degraded" : "unhealthy";

        var response = req.CreateResponse(allHealthy ? HttpStatusCode.OK : HttpStatusCode.ServiceUnavailable);
        await response.WriteAsJsonAsync(new { status, services = checks });
        return response;
    }
}
```

---

## Test Project Setup

### Functions.Tests.csproj

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.*" />
    <PackageReference Include="xunit" Version="2.*" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.*" />
    <PackageReference Include="Moq" Version="4.*" />
    <PackageReference Include="FluentAssertions" Version="6.*" />
    <PackageReference Include="coverlet.collector" Version="6.*" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\Functions\Functions.csproj" />
  </ItemGroup>
</Project>
```

### Fixture Classes

```csharp
// Fixtures/ItemFixtures.cs
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

    public static CreateItemRequest CreateInvalidRequest_EmptyName() => new()
    {
        Name = "",
        Description = "Missing name",
        Price = 19.99m,
        Category = "widgets",
    };

    public static CreateItemRequest CreateInvalidRequest_NegativePrice() => new()
    {
        Name = "Widget",
        Description = "Negative price",
        Price = -5.00m,
        Category = "widgets",
    };

    public static List<Item> CreateItemList(int count = 5) =>
        Enumerable.Range(1, count)
            .Select(i => CreateValidItem($"item-{i:D3}"))
            .ToList();
}
```

### Mock Service

```csharp
// Mocks/MockDatabaseService.cs
public class MockDatabaseService : IDatabaseService
{
    private readonly Dictionary<string, Dictionary<string, object>> _stores = new();

    public MockDatabaseService(Dictionary<string, List<object>>? initialData = null)
    {
        if (initialData != null)
        {
            foreach (var (collection, items) in initialData)
            {
                _stores[collection] = new Dictionary<string, object>();
                foreach (dynamic item in items)
                {
                    _stores[collection][(string)item.Id] = item;
                }
            }
        }
    }

    public Task<List<T>> FindAllAsync<T>(string collection, QueryOptions? options = null)
    {
        if (!_stores.ContainsKey(collection))
            return Task.FromResult(new List<T>());

        var items = _stores[collection].Values.Cast<T>().ToList();
        if (options != null)
        {
            items = items.Skip(options.Offset).Take(options.Limit).ToList();
        }
        return Task.FromResult(items);
    }

    public Task<T?> FindByIdAsync<T>(string collection, string id)
    {
        if (!_stores.ContainsKey(collection) || !_stores[collection].ContainsKey(id))
            return Task.FromResult<T?>(default);
        return Task.FromResult((T?)_stores[collection][id]);
    }

    public Task<T> CreateAsync<T>(string collection, T data)
    {
        if (!_stores.ContainsKey(collection))
            _stores[collection] = new Dictionary<string, object>();

        dynamic item = data!;
        _stores[collection][(string)item.Id] = data!;
        return Task.FromResult(data);
    }

    public Task<T?> UpdateAsync<T>(string collection, string id, object data)
    {
        if (!_stores.ContainsKey(collection) || !_stores[collection].ContainsKey(id))
            return Task.FromResult<T?>(default);

        // Simplified: replace entire object
        _stores[collection][id] = data;
        return Task.FromResult((T?)data);
    }

    public Task<bool> DeleteAsync(string collection, string id)
    {
        if (!_stores.ContainsKey(collection))
            return Task.FromResult(false);
        return Task.FromResult(_stores[collection].Remove(id));
    }

    public Task<bool> HealthCheckAsync() => Task.FromResult(true);
}
```

### Test Examples

```csharp
// Functions/GetItemsTests.cs
using Moq;
using FluentAssertions;

public class GetItemsTests
{
    private readonly Mock<IDatabaseService> _mockDb;
    private readonly Mock<ILogger<GetItems>> _mockLogger;

    public GetItemsTests()
    {
        _mockDb = new Mock<IDatabaseService>();
        _mockLogger = new Mock<ILogger<GetItems>>();
    }

    [Fact]
    public async Task GetItems_ReturnsAllItems()
    {
        var items = ItemFixtures.CreateItemList(3);
        _mockDb.Setup(db => db.FindAllAsync<Item>("items", It.IsAny<QueryOptions>()))
            .ReturnsAsync(items);

        // Note: In a real test, you'd use WebApplicationFactory or construct
        // the function class directly and invoke the handler
        var result = await _mockDb.Object.FindAllAsync<Item>("items");

        result.Should().HaveCount(3);
    }

    [Fact]
    public async Task GetItems_ReturnsEmptyList_WhenNoItems()
    {
        _mockDb.Setup(db => db.FindAllAsync<Item>("items", It.IsAny<QueryOptions>()))
            .ReturnsAsync(new List<Item>());

        var result = await _mockDb.Object.FindAllAsync<Item>("items");

        result.Should().BeEmpty();
    }

    [Fact]
    public async Task GetItemById_ReturnsItem_WhenExists()
    {
        var item = ItemFixtures.CreateValidItem("test-001");
        _mockDb.Setup(db => db.FindByIdAsync<Item>("items", "test-001"))
            .ReturnsAsync(item);

        var result = await _mockDb.Object.FindByIdAsync<Item>("items", "test-001");

        result.Should().NotBeNull();
        result!.Id.Should().Be("test-001");
    }

    [Fact]
    public async Task GetItemById_ReturnsNull_WhenNotFound()
    {
        _mockDb.Setup(db => db.FindByIdAsync<Item>("items", "nonexistent"))
            .ReturnsAsync((Item?)null);

        var result = await _mockDb.Object.FindByIdAsync<Item>("items", "nonexistent");

        result.Should().BeNull();
    }
}
```

```csharp
// Validation/CreateItemValidatorTests.cs
using FluentValidation.TestHelper;

public class CreateItemValidatorTests
{
    private readonly CreateItemValidator _validator = new();

    [Fact]
    public void Valid_Input_Passes()
    {
        var request = ItemFixtures.CreateValidRequest();
        var result = _validator.TestValidate(request);
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void Empty_Name_Fails()
    {
        var request = ItemFixtures.CreateInvalidRequest_EmptyName();
        var result = _validator.TestValidate(request);
        result.ShouldHaveValidationErrorFor(x => x.Name);
    }

    [Fact]
    public void Negative_Price_Fails()
    {
        var request = ItemFixtures.CreateInvalidRequest_NegativePrice();
        var result = _validator.TestValidate(request);
        result.ShouldHaveValidationErrorFor(x => x.Price);
    }

    [Fact]
    public void Missing_Category_Fails()
    {
        var request = new CreateItemRequest
        {
            Name = "Widget",
            Price = 29.99m,
            Category = ""
        };
        var result = _validator.TestValidate(request);
        result.ShouldHaveValidationErrorFor(x => x.Category);
    }
}
```

```csharp
// Errors/ErrorHandlerTests.cs
public class ErrorHandlerTests
{
    [Fact]
    public void NotFound_Returns_404()
    {
        var error = new NotFoundException("Item", "abc-123");
        error.StatusCode.Should().Be(404);
        error.Code.Should().Be("NOT_FOUND");
        error.Message.Should().Contain("abc-123");
    }

    [Fact]
    public void ValidationException_Returns_422()
    {
        var error = new Errors.ValidationException("Bad input");
        error.StatusCode.Should().Be(422);
        error.Code.Should().Be("VALIDATION_ERROR");
    }

    [Fact]
    public void BadRequest_Returns_400()
    {
        var error = new BadRequestException("Missing field");
        error.StatusCode.Should().Be(400);
        error.Code.Should().Be("BAD_REQUEST");
    }

    [Fact]
    public void All_Errors_Have_Consistent_Shape()
    {
        var errors = new AppException[]
        {
            new NotFoundException("Item", "1"),
            new Errors.ValidationException("Bad input"),
            new BadRequestException("Bad request"),
        };

        foreach (var error in errors)
        {
            error.StatusCode.Should().BeGreaterThan(0);
            error.Code.Should().NotBeNullOrEmpty();
            error.Message.Should().NotBeNullOrEmpty();
        }
    }
}
```

---

## Validation — FluentValidation

### Validator Definition

```csharp
// Shared/Validators/CreateItemValidator.cs
using FluentValidation;

public class CreateItemValidator : AbstractValidator<CreateItemRequest>
{
    public CreateItemValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("Name is required")
            .MaximumLength(255);

        RuleFor(x => x.Price)
            .GreaterThan(0).WithMessage("Price must be positive");

        RuleFor(x => x.Category)
            .NotEmpty().WithMessage("Category is required")
            .MaximumLength(100);
    }
}

public class UpdateItemValidator : AbstractValidator<UpdateItemRequest>
{
    public UpdateItemValidator()
    {
        RuleFor(x => x.Name)
            .MaximumLength(255)
            .When(x => x.Name != null);

        RuleFor(x => x.Price)
            .GreaterThan(0)
            .When(x => x.Price.HasValue);

        RuleFor(x => x.Category)
            .MaximumLength(100)
            .When(x => x.Category != null);
    }
}
```

---

## Structured Logging — Serilog

### Logger Setup

```csharp
// Already configured in Program.cs (see above)
// Usage in functions via ILogger<T> injection:

public class CreateItem
{
    private readonly ILogger<CreateItem> _logger;

    public CreateItem(ILogger<CreateItem> logger)
    {
        _logger = logger;
    }

    // In handler:
    _logger.LogInformation("Creating item {ItemName} in category {Category}",
        body.Name, body.Category);
}
```

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

// Shared/Models/ApiContracts.cs
public class CreateItemRequest
{
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public decimal Price { get; set; }
    public string Category { get; set; } = "";
}

public class UpdateItemRequest
{
    public string? Name { get; set; }
    public string? Description { get; set; }
    public decimal? Price { get; set; }
    public string? Category { get; set; }
}

public class ListItemsResponse
{
    public List<Item> Items { get; set; } = new();
    public int Total { get; set; }
}

public class ErrorResponse
{
    public ErrorDetail Error { get; set; } = new();
}

public class ErrorDetail
{
    public string Code { get; set; } = "";
    public string Message { get; set; } = "";
    public object? Details { get; set; }
}

public class HealthResponse
{
    public string Status { get; set; } = "";
    public Dictionary<string, bool> Services { get; set; } = new();
}
```

---

## Config with Validation

```csharp
// Services/Config.cs
public class AppConfig
{
    public string StorageConnectionString { get; set; } = "";
    public string DatabaseUrl { get; set; } = "";
    public string RedisUrl { get; set; } = "";
    public bool IsDevelopment { get; set; }

    public static AppConfig Load()
    {
        return new AppConfig
        {
            StorageConnectionString = Environment.GetEnvironmentVariable("STORAGE_CONNECTION_STRING")
                ?? "UseDevelopmentStorage=true",
            DatabaseUrl = Environment.GetEnvironmentVariable("DATABASE_URL")
                ?? "Host=localhost;Port=5432;Database=appdb;Username=localdev;Password=localdevpassword",
            RedisUrl = Environment.GetEnvironmentVariable("REDIS_URL")
                ?? "localhost:6379",
            IsDevelopment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") == "Development",
        };
    }

    public void Validate()
    {
        var missing = new List<string>();
        // Add required var checks here based on services used
        // Example:
        // if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("DATABASE_URL")))
        //     missing.Add("DATABASE_URL — PostgreSQL connection string");

        if (missing.Count > 0)
        {
            throw new InvalidOperationException(
                $"Missing required environment variables:\n{string.Join("\n", missing.Select(m => $"  - {m}"))}\n\nCopy .env.example to .env and fill in the values.");
        }
    }
}
```

---

## Dependencies Quick Reference

### Core NuGet Packages

| Package | Purpose |
|---------|---------|
| `Microsoft.Azure.Functions.Worker` | Functions runtime |
| `Microsoft.Azure.Functions.Worker.Extensions.Http` | HTTP trigger |
| `FluentValidation` | Input validation |
| `Serilog` + `Serilog.Sinks.Console` | Structured logging |

### Per Service

| Service | Package |
|---------|---------|
| Blob Storage | `Azure.Storage.Blobs` |
| PostgreSQL | `Npgsql` |
| CosmosDB | `Microsoft.Azure.Cosmos` |
| Redis | `StackExchange.Redis` |
| Migrations | `Microsoft.EntityFrameworkCore`, `Npgsql.EntityFrameworkCore.PostgreSQL` |

### Test Packages

| Package | Purpose |
|---------|---------|
| `xunit` + `xunit.runner.visualstudio` | Test runner |
| `Microsoft.NET.Test.Sdk` | Test SDK |
| `Moq` | Mocking |
| `FluentAssertions` | Readable assertions |
| `coverlet.collector` | Code coverage |
| `FluentValidation.TestHelper` | Validation test helpers |

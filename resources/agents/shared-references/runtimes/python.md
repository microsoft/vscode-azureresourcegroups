# Python Runtime Reference

> Azure Functions v4 host with the Python v2 programming model. CPython, pytest, Pydantic validation, structlog, DI patterns.

Functions setup, manifests, handlers, and health-route examples below apply only to a service whose approved framework is Azure Functions. For a custom Python API, preserve its actual framework and reuse the environment, dependency, contract, and resilience conventions without introducing Functions files or its SDK.

---

## Azure Functions v2 Setup

### Initialization

```bash
func init services/functions --python --model V2
```

Use the actual service directory from the plan. Before restoring dependencies, select a compatible interpreter per [prerequisites.md](../prerequisites.md). Run subsequent commands with that service as `cwd`:

```text
<selected-python> -m venv .venv
<venv-python> -m pip install -r requirements.txt
<venv-python> -m pip check
```

`<venv-python>` is `.venv/bin/python` on macOS/Linux or `.venv/Scripts/python.exe` on Windows, relative to the service. Reuse an existing compatible venv; do not recreate it with whichever `python3` happens to be on PATH. Use this interpreter for every install, compile check, test, and migration. A standalone Python API does not require Node.js.

Keep `host.json`, `function_app.py`, `requirements.txt`, and every imported application package inside the Functions service root. Add `__init__.py` to application packages. Never repair missing sibling imports by mutating `sys.path` or depending on the workspace root as `PYTHONPATH`.

### Dependency manifests

Always emit service-root `requirements.txt` containing **all production imports**, including `azure-functions`, validation/logging libraries, and the chosen SDKs/drivers. Keep it consistent with `pyproject.toml`; an optional Python project manifest is not a substitute for the Functions requirements file. For Poetry/uv projects, use their native restore/export workflow and the same environment that the host will run.

Example core production requirements:

```text
azure-functions>=1.17.0
pydantic>=2.0.0
structlog>=23.0.0
```

Put lint, test, and migration-only tooling in `requirements-dev.txt` or the existing manager's dev group. Restore those separately when needed. The VS Code Functions task uses the extensions' debugger launcher; do not add `debugpy` to production requirements merely to make a terminal-only debug command work.

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
    "FUNCTIONS_WORKER_RUNTIME": "python",
    "AZURE_FUNCTIONS_ENVIRONMENT": "Development",
    "ENVIRONMENT": "development",
    "STORAGE_CONNECTION_STRING": "UseDevelopmentStorage=true",
    "DATABASE_URL": "postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5432/appdb",
    "REDIS_URL": "redis://localhost:6379"
  },
  "Host": {
    "CORS": "http://localhost:5173",
    "CORSCredentials": false
  }
}
```

> `local.settings.json`: plain JSON; **no** `${...}` interpolation.
> Replace `<POSTGRES_USER>` / `<POSTGRES_PASSWORD>` with matching discrete values from docker-compose's
> workspace-root `.env`. Never leave placeholders or paste credentials from tool output: redaction
> rewrites concrete credential URLs; masked values starting with `*` corrupt YAML/JSON config.

Match `Host.CORS` to the frontend's actual origin and port. With cookie-based login, set `CORSCredentials` to `true` and use explicit origins; **never** combine credentialed CORS with `"*"`. A same-origin dev proxy can avoid cross-origin requests. Keep the frontend's eventual debug URL and dev-server port aligned.

`UseDevelopmentStorage=true` requires Azurite's default development account and default ports. If the compose setup uses custom accounts or mapped ports, use explicit matching storage endpoints/account credentials for both the Functions host and storage client. Never configure custom `AZURITE_ACCOUNTS` while leaving default-account shorthand in the application.

### pyproject.toml

```toml
[project]
name = "functions"
version = "1.0.0"
requires-python = ">=3.11"
dependencies = [
    "azure-functions>=1.17.0",
    "pydantic>=2.0.0",
    "structlog>=23.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-asyncio>=0.21.0",
    "pytest-cov>=4.0.0",
    "ruff>=0.1.0",
    "httpx>=0.25.0",
]

# Add per-service dependencies as needed:
# "azure-storage-blob>=12.0.0",
# "psycopg2-binary>=2.9.0",
# "redis>=5.0.0",

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_functions = ["test_*"]
asyncio_mode = "auto"

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W"]
```

---

## Function Handler Pattern

### function_app.py (Registration)

```python
# function_app.py
import azure.functions as func
from services.registry import initialize_services
from functions.get_items import bp as get_items
from functions.create_item import bp as create_item
from functions.get_item_by_id import bp as get_item_by_id
from functions.health import bp as health

# Initialize services on cold start
initialize_services()

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)
app.register_functions(get_items)
app.register_functions(create_item)
app.register_functions(get_item_by_id)
app.register_functions(health)
```

Use one Blueprint per handler module and register every Blueprint explicitly in `function_app.py`. Handlers must never import `app` from `function_app`: that creates circular registration/imports. Match the registered route inventory to the plan. With the default Functions HTTP prefix, write `route="items"`, not `route="api/items"`; the host adds `/api`.

### HTTP Function (v2 Model)

```python
# functions/get_items.py
import azure.functions as func
import json
from services.registry import get_services
from errors.error_handler import handle_error
bp = func.Blueprint()

@bp.route(route="items", methods=["GET"])
async def get_items(req: func.HttpRequest) -> func.HttpResponse:
    try:
        services = get_services()
        limit = int(req.params.get("limit", "20"))
        offset = int(req.params.get("offset", "0"))

        items = await services.database.find_all("items", limit=limit, offset=offset)

        return func.HttpResponse(
            json.dumps({"items": items, "total": len(items)}),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as e:
        return handle_error(e)
```

### POST with Validation

```python
# functions/create_item.py
import azure.functions as func
import json
import uuid
from datetime import datetime, timezone
from services.registry import get_services
from errors.error_handler import handle_error
from shared.validation import CreateItemRequest
bp = func.Blueprint()

@bp.route(route="items", methods=["POST"])
async def create_item(req: func.HttpRequest) -> func.HttpResponse:
    try:
        # Validate input
        body = req.get_json()
        validated = CreateItemRequest(**body)

        services = get_services()
        now = datetime.now(timezone.utc).isoformat()

        item = {
            "id": str(uuid.uuid4()),
            **validated.model_dump(),
            "created_at": now,
            "updated_at": now,
        }

        created = await services.database.create("items", item)

        return func.HttpResponse(
            json.dumps({"item": created}),
            status_code=201,
            mimetype="application/json",
        )
    except Exception as e:
        return handle_error(e)
```

### GET by ID with 404

```python
# functions/get_item_by_id.py
import azure.functions as func
import json
from services.registry import get_services
from errors.error_handler import handle_error
from errors.error_types import NotFoundError
bp = func.Blueprint()

@bp.route(route="items/{id}", methods=["GET"])
async def get_item_by_id(req: func.HttpRequest) -> func.HttpResponse:
    try:
        services = get_services()
        item_id = req.route_params.get("id")

        item = await services.database.find_by_id("items", item_id)
        if item is None:
            raise NotFoundError("Item", item_id)

        return func.HttpResponse(
            json.dumps({"item": item}),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as e:
        return handle_error(e)
```

### Health Check

```python
# functions/health.py
import azure.functions as func
import json
from services.registry import get_services
from logger import get_logger
bp = func.Blueprint()
logger = get_logger("health")

@bp.route(route="health", methods=["GET"])
async def health(req: func.HttpRequest) -> func.HttpResponse:
    services = get_services()
    checks = {}

    try:
        checks["database"] = await services.database.health_check()
    except Exception:
        logger.exception("health_check_failed", service="database")
        checks["database"] = False

    try:
        checks["storage"] = await services.storage.health_check()
    except Exception:
        logger.exception("health_check_failed", service="storage")
        checks["storage"] = False

    try:
        checks["cache"] = await services.cache.health_check()
    except Exception:
        logger.exception("health_check_failed", service="cache")
        checks["cache"] = False

    all_healthy = all(checks.values())
    essential_healthy = checks["database"] and checks["storage"]
    status = "healthy" if all_healthy else ("degraded" if essential_healthy else "unhealthy")

    return func.HttpResponse(
        json.dumps({"status": status, "services": checks}),
        status_code=503 if status == "unhealthy" else 200,
        mimetype="application/json",
    )
```

Adapt health checks to the services actually present and their plan classifications. This example treats database/storage as Essential and cache as Enhancement: an Enhancement failure is degraded `200`; an Essential failure is unhealthy `503`. Log probe failures without exposing credentials.

---

## Python Build and Handoff Gates

Run from the service root using its selected venv:

```text
<venv-python> -m pip check
<venv-python> -m compileall -q function_app.py functions services errors middleware shared logger.py
```

Replace the source list with the actual generated files/directories. Never run bare `python -m py_compile` without filenames, compile the venv/dependency tree, or invent npm/`tsc`/`dist` gates for a Python service. Use the project's configured Ruff command when linting is present.

Scaffold owns syntax, dependency, and manifest checks. Integration owns starting the host with this venv active, verifying every Blueprint registers, applying migrations with `<venv-python> -m alembic`, and probing real endpoints. Record the interpreter version/path, venv path, restore/compile/start commands, and HTTP contract location in `.azure/integration-plan.md`.

For Python backend + JS/TS frontend, keep Python models service-local and use OpenAPI/JSON Schema as the cross-language contract. Generate or validate typed frontend request/response contracts from it, including date serialization, nullability, enum values, and error shapes. Never import Python modules into the frontend or treat the backend as an npm workspace.

---

## pytest Configuration

### conftest.py (Global Test Setup)

```python
# tests/conftest.py
import pytest
import json
from pathlib import Path
from services.registry import register_services, clear_services, ServiceRegistry
from tests.mocks.mock_database import MockDatabaseService
from tests.mocks.mock_storage import MockStorageService
from tests.mocks.mock_cache import MockCacheService

@pytest.fixture(autouse=True)
def setup_mock_services(item_fixtures):
    """Register mock services before each test, clear after."""
    register_services(
        ServiceRegistry(
            database=MockDatabaseService({"items": item_fixtures["validItems"]}),
            storage=MockStorageService(),
            cache=MockCacheService(),
        )
    )
    yield
    clear_services()

@pytest.fixture
def item_fixtures():
    fixture_path = Path(__file__).parent / "fixtures" / "items.json"
    with open(fixture_path) as f:
        return json.load(f)

@pytest.fixture
def valid_item(item_fixtures):
    return item_fixtures["validItems"][0]

@pytest.fixture
def invalid_items(item_fixtures):
    return item_fixtures["invalidItems"]

@pytest.fixture
def mock_database(item_fixtures):
    return MockDatabaseService({"items": item_fixtures["validItems"]})
```

### Test Examples

```python
# tests/test_get_items.py
import pytest
from unittest.mock import AsyncMock
from services.registry import get_services

async def test_get_items_returns_all_items(item_fixtures):
    services = get_services()
    items = await services.database.find_all("items")
    assert len(items) == len(item_fixtures["validItems"])

async def test_get_items_returns_empty_when_no_data():
    from services.registry import register_services, ServiceRegistry
    from tests.mocks.mock_database import MockDatabaseService
    from tests.mocks.mock_storage import MockStorageService
    from tests.mocks.mock_cache import MockCacheService

    register_services(
        ServiceRegistry(
            database=MockDatabaseService(),
            storage=MockStorageService(),
            cache=MockCacheService(),
        )
    )
    services = get_services()
    items = await services.database.find_all("items")
    assert items == []

async def test_get_item_by_id_returns_item(valid_item):
    services = get_services()
    item = await services.database.find_by_id("items", valid_item["id"])
    assert item is not None
    assert item["id"] == valid_item["id"]

async def test_get_item_by_id_returns_none_for_missing():
    services = get_services()
    item = await services.database.find_by_id("items", "nonexistent-id")
    assert item is None
```

```python
# tests/test_validation.py
import pytest
from pydantic import ValidationError
from shared.validation import CreateItemRequest

def test_valid_create_item():
    item = CreateItemRequest(
        name="Widget", description="A widget", price=29.99, category="widgets"
    )
    assert item.name == "Widget"
    assert item.price == 29.99

def test_empty_name_fails():
    with pytest.raises(ValidationError):
        CreateItemRequest(name="", description="A widget", price=29.99, category="widgets")

def test_negative_price_fails():
    with pytest.raises(ValidationError):
        CreateItemRequest(name="Widget", description="A widget", price=-5.0, category="widgets")

def test_missing_required_fields():
    with pytest.raises(ValidationError):
        CreateItemRequest(description="Just a description")
```

```python
# tests/test_error_handler.py
import json
from errors.error_types import NotFoundError, ValidationError, BadRequestError
from errors.error_handler import handle_error

def test_not_found_error_returns_404():
    error = NotFoundError("Item", "abc-123")
    response = handle_error(error)
    body = json.loads(response.get_body())

    assert response.status_code == 404
    assert body["error"]["code"] == "NOT_FOUND"
    assert "abc-123" in body["error"]["message"]

def test_validation_error_returns_422():
    error = ValidationError("Bad input", details=[{"field": "name", "message": "Required"}])
    response = handle_error(error)
    body = json.loads(response.get_body())

    assert response.status_code == 422
    assert body["error"]["code"] == "VALIDATION_ERROR"

def test_unknown_error_returns_500():
    error = RuntimeError("Something broke")
    response = handle_error(error)
    body = json.loads(response.get_body())

    assert response.status_code == 500
    assert body["error"]["code"] == "INTERNAL_ERROR"

def test_error_response_shape_is_consistent():
    errors = [
        NotFoundError("Item", "1"),
        ValidationError("Bad input"),
        BadRequestError("Bad request"),
        RuntimeError("Unknown"),
    ]
    for error in errors:
        response = handle_error(error)
        body = json.loads(response.get_body())
        assert "error" in body
        assert "code" in body["error"]
        assert "message" in body["error"]
```

---

## Validation — Pydantic

### Schema Definition

```python
# shared/validation.py
from pydantic import BaseModel, Field
from typing import Optional

class CreateItemRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = ""
    price: float = Field(gt=0)
    category: str = Field(min_length=1, max_length=100)

class UpdateItemRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    price: Optional[float] = Field(None, gt=0)
    category: Optional[str] = Field(None, min_length=1, max_length=100)

class PaginationParams(BaseModel):
    limit: int = Field(20, ge=1, le=100)
    offset: int = Field(0, ge=0)
```

---

## Structured Logging — structlog

### Logger Setup

```python
# logger.py
import structlog
import os
import logging

def setup_logging():
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer()
            if os.environ.get("ENVIRONMENT") == "development"
            else structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, log_level, logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

def get_logger(name: str = "app"):
    return structlog.get_logger(name)
```

### Request Logging

```python
# middleware/request_logger.py
import time
from logger import get_logger

logger = get_logger("http")

def log_request(method: str, path: str, status_code: int, start_time: float):
    duration_ms = round((time.time() - start_time) * 1000, 2)
    logger.info(
        "request_completed",
        method=method,
        path=path,
        status=status_code,
        duration_ms=duration_ms,
    )
```

---

## Shared Types

```python
# shared/types.py
from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime

class Item(BaseModel):
    id: str
    name: str
    description: str
    price: float
    category: str
    created_at: datetime
    updated_at: datetime

class ListItemsResponse(BaseModel):
    items: list[Item]
    total: int

class SingleItemResponse(BaseModel):
    item: Item

class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Optional[Any] = None

class ErrorResponse(BaseModel):
    error: ErrorDetail

class HealthResponse(BaseModel):
    status: str  # "healthy" | "degraded" | "unhealthy"
    services: dict[str, bool]
```

---

## Dependencies Quick Reference

### Core Dependencies

| Package | Purpose |
|---------|---------|
| `azure-functions` | Azure Functions v2 runtime |
| `pydantic` | Input validation + shared types |
| `structlog` | Structured logs |

### Per Service

| Service | Package |
|---------|---------|
| Blob Storage | `azure-storage-blob` |
| PostgreSQL | `psycopg[binary,pool]` or the existing compatible driver |
| CosmosDB | `azure-cosmos` |
| Redis | `redis` |
| Migrations | `alembic`, `sqlalchemy` |

For async service methods use an async-capable driver (`psycopg` async connections or `asyncpg`) and matching SQLAlchemy configuration. Never `await` synchronous `psycopg2` calls or block the Functions event loop with synchronous database I/O.

### Dev Dependencies

| Package | Purpose |
|---------|---------|
| `pytest` | Tests |
| `pytest-asyncio` | Async tests |
| `pytest-cov` | Coverage |
| `ruff` | Lint + format |
| `httpx` | Request-level test HTTP client |

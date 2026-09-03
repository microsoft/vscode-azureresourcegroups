# Project Plan

**Status**: Integrated
**Created**: 2026-08-25
**Mode**: New Project

## 1. Project Overview

**Goal**: Build a C# ticket API whose storage layer is independently testable.

**App Type**: API only

**Mode**: NEW

## 2. Backend — ASP.NET Minimal API

| Component | Technology |
|-----------|-----------|
| **Language** | C# |
| **Runtime** | .NET |
| **Package Manager** | dotnet (NuGet) |
| **Test Runner** | xUnit |
| **Mocking Library** | NSubstitute |
| **Test Command** | dotnet test |
| **Orchestration** | docker-compose |

## 3. Services Required

| Azure Service | Role in App | Environment Variable | Default Value (Local) | Classification |
|---------------|------------|---------------------|----------------------|----------------|
| Azure Database for PostgreSQL | Primary data store for tickets | DATABASE_URL | postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/tickets | Essential |

## 4. Prerequisites

### Run

| Tool | Service(s) | Installed | Version | Install |
|------|-----------|-----------|---------|---------|
| .NET SDK | * | ✅ | 9.0 | https://dotnet.microsoft.com/download |

### Debug

| Tool | Service(s) | Installed | Version | Install |
|------|-----------|-----------|---------|---------|
| Docker | api | ❓ | — | https://docs.docker.com/get-docker/ |

## 5. Project Structure

```text
services/api/Api.csproj
services/api/Program.cs
```

## 6. Route Definitions

| # | Method | Path | Description | Auth | Status Codes |
|---|--------|------|-------------|------|-------------|
| 1 | GET | `/api/health` | Report service health | None | 200 |
| 2 | GET | `/api/tickets` | List tickets | None | 200 |

## 7. Next Steps

1. Scaffold the API service.
2. Generate debug artifacts.

# Azure Debug Plan

> **Status:** Implemented
> **Execution Mode:** Auto
> **Last Updated:** 2026-08-07T00:00:00.000Z

## Prerequisites

| Tool | Installed |
|---|---|
| Node.js 22 | Yes |
| npm | Yes |

## Debug Configurations

| Generate | Debug Config Name | Service Root | Project Type | Runtime | Notes |
|---|---|---|---|---|---|
| [x] | Golden App (debug) | `.` | Backend | Node.js | Launch with CDP inspector |

## Orchestrator

| Orchestrator | Selected | Notes |
|---|---|---|
| VS Code task and launch configuration | Yes | Build before launch |

## Architecture

```text
Browser -> Node.js API and static server -> JSON file
             |
             +-> CDP inspector on port 9229
```

## Emulators

No emulators are required.

## API Test Collections

No generated API test collection is required.

## Debug Configuration Checklist

Debug Configuration Checklist:

✅ Golden App (debug) — HTTP health returned 200 and CDP inspector metadata was available.
✅ Golden Project Tracker — browser interaction and accessibility checks passed.
✅ Persistence — created project remained visible after service restart.

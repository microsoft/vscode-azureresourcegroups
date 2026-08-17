# Project Plan

**Status**: Integrated
**Created**: 2026-08-07
**Mode**: New Project

## 1. Project Overview

**App Type**: Web Application

Build a dependency-free full-stack Node.js project tracker with an accessible browser interface and durable file-backed storage.

### User Flow

A user opens the tracker, enters a project name, submits it, and sees the project after the application restarts.

### Architecture

- A Node.js HTTP service serves the API and static browser assets.
- A JSON file stores projects across service restarts.
- Browser code calls the API and updates an accessible list.

## 2. Services Required

| Name | Responsibility |
|---|---|
| Node server | Serve health, item, and static asset routes |
| Browser client | Create and render projects |
| File store | Persist project records |

## 3. Prerequisites

- Node.js 22
- npm
- A browser for acceptance testing

## 4. Project Structure

```text
src/server.js
public/index.html
public/app.js
public/styles.css
test/server.test.js
```

## 5. Route Definitions

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Report service health |
| GET | `/api/items` | List projects |
| POST | `/api/items` | Create a project |

## 6. Design System

**Component Library**: Native semantic HTML

The interface uses a high-contrast blue action, white card, dark text, and a restrained neutral background.

Native semantic HTML controls are used so the fixture has no runtime dependencies.

## 7. Next Steps

1. Scaffold the server, browser assets, and tests.
2. Integrate browser API calls.
3. Generate debug artifacts.
4. Run build, test, lint, browser, accessibility, persistence, and debugger checks.

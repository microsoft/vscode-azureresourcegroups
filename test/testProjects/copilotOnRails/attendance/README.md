# Attendance Project (Test Fixture)

A personal in-office attendance compliance app. Users define a policy of X required
office days over a Y-week period, mark in-office days on an interactive monthly
calendar, track current and historical compliance, and plan future attendance to
compare planned versus actual.

- **Backend:** TypeScript Azure Functions API (`attendance-api`)
- **Frontend:** React + Vite web app (`attendance-web`)
- **Data stores:** PostgreSQL + Blob Storage
- **Auth:** Microsoft Entra ID
- **Deploy plan:** `prepare-plan.json` is a mock deploy-agent artifact (region `westus2`, quota verified) — the scrapbook fixture covers the unverified-quota case.

## Model

- Claude Sonnet 5

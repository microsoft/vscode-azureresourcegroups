# End-to-End Wire-Up Verification

> Read at **Step 4**. Run frontend + backend together; prove communication.

---

## Run both processes concurrently (cross-platform)

Start each async in separate terminal; never use shell-specific backgrounding (`&`, `Start-Job` chains):

1. **Backend** — artifact run command, e.g. `func start` (cwd = backend folder). Wait for host confirmation: all functions registered.
2. **Frontend** — `npm --prefix services/web run dev` (cwd-independent). Wait for dev server local URL.

Step 3 frontend dev proxy forwards `/api` to backend over `localhost`.

---

## Prove the wiring

Require **at least one real `/api/...` frontend request hitting backend and returning `200` with live data** — no mock placeholder. Prove via one:

- **Logs**: backend host logs incoming `GET /api/...` → `200` from dev server, not manual curl.
- **Browser**: load page with browser tool; confirm backend data renders and network panel shows successful `/api` call. Data must match empty-schema backend response; empty list rendering "empty" state remains valid live response, unlike mock content.
- **Write path** (if app has one): create/update in UI; confirm backend receipt + UI result.

---

## Capture evidence & shut down

- Record proof: request path, method, status (e.g. `GET /api/users → 200`) showing frontend → backend wiring.
- Stop both processes cleanly; leave no servers running.

---

## Distinguishing live from mock

Page showing scaffold mock content (named demo records, lorem data) against empty backend DB means frontend **still on mock data** — return to Step 3. Correct empty-schema wiring shows empty/loading states from real empty responses, or real data created through write path.

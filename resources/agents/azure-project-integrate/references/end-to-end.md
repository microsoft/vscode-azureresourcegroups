# End-to-End Wire-Up Verification

> Read at **Step 4**. How to run the frontend and backend together and prove they communicate.

---

## Run both processes concurrently (cross-platform)

Start each in its own terminal (async), never with shell-specific backgrounding (`&`, `Start-Job` chains):

1. **Backend** — the run command from the artifact, e.g. `func start` (cwd = backend folder). Wait until the host prints that all functions registered.
2. **Frontend** — `npm --prefix services/web run dev` (cwd-independent). Wait until the dev server prints its local URL.

The frontend dev proxy (configured in Step 3) forwards `/api` to the backend, so the two talk over `localhost`.

---

## Prove the wiring

You need **at least one real `/api/...` request from the frontend that hits the backend and returns `200` with live data** — not a mock placeholder. Establish it with any one of:

- **Logs**: the backend host logs an incoming `GET /api/...` → `200` that originated from the dev server (not your manual curl).
- **Browser**: load a page with the browser tool; confirm it renders data that came from the backend (and that the network panel shows the `/api` call succeeding). The data must match what the empty-schema backend returns (often an empty list rendering the "empty" state — that is still a valid live response, distinct from mock content).
- **Write path**: perform a create/update in the UI; confirm the backend receives it and the UI reflects the result.

## Prove every mutation form

When the app has create/update forms, the read-only proof above is not enough. Exercise every distinct mutation form:

1. Submit backend-valid input. Confirm the backend receives the request and the UI reflects the created/updated value.
2. Submit input rejected by client validation. Confirm a visible field/form message appears, entered values remain,
   submitting clears, and the user can retry.
3. Exercise a standardized non-2xx API response. If the UI cannot naturally produce one, temporarily mock that
   response at the HTTP boundary. Confirm the API message is visible, entered values remain, submitting clears, and
   retry is possible, then remove the temporary mock and re-confirm the live client is active.

A click that sends no request and shows no message is a failure, not an acceptable validation outcome.

---

## Capture evidence & shut down

- Record the proof: the request path, method, and status (e.g. `GET /api/users → 200`) that demonstrates frontend → backend wiring.
- Stop both processes cleanly when done (do not leave servers running).

---

## Distinguishing live from mock

If a page still shows the scaffold's mock content (named demo records, lorem data) while the backend DB is empty, the frontend is **still on mock data** — return to Step 3. A correctly wired app against an empty schema typically shows empty/loading states populated by real (empty) responses, or real data you created via a write path.

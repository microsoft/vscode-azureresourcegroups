# reference-frontend-integrated

The frontend **after** `azure-project-integrate` has done its job: the `ApiClient` seam
points at a live client that calls the API over HTTP, and the mock layer is gone.

Its sibling is [`stage-local-dev`](../stage-local-dev), which is the same shape *before*
integration — real agent output where `src/api/index.ts` still reads
`export const api: ApiClient = mockClient;`. Between them they pin both ends of the one
change that agent exists to make.

## Why it is hand-written rather than harvested

Every other realistic fixture here is reconstructed from a run. This one could not be:
no run has ever exercised the integrate agent's seam swap, which is precisely the gap
`frontend-seam-live` was written to close. Harvesting it would have meant harvesting the
behaviour under test from a run that does not exist.

So it is written to the contract in
`resources/agents/azure-project-integrate/references/wire-live-data.md` — the live client
at `src/api/client.ts`, typed `: ApiClient`, reading `import.meta.env.VITE_API_BASE ?? '/api'`,
with the mock client, `src/mocks/` and `previewState.ts` deleted. When a real run does
produce an integrated frontend, prefer replacing this with the harvested article.

## What it deliberately keeps

`src/pages/TasksPage.tsx` imports from `../api` rather than from the client directly. That
is the property the whole seam design exists for — pages never learn which implementation
they got — and a fixture whose pages reached past the seam would certify a gate that could
not tell a wired app from a rewired one.

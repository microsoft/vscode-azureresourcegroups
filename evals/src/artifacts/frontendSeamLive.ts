/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The one thing `azure-project-integrate` exists to do: repoint the frontend's `ApiClient`
 * seam from the scaffold's mock at a live client that really talks to the API.
 *
 * ## Why this gate had to be written
 *
 * `integrate-seam.yaml` already drives the integrate agent, and it grades the
 * `integration-plan.md` artifact and the two MCP tools the agent owns. None of that
 * observes the swap. An agent that writes a perfect hand-off document, opens the right
 * view, and never touches `src/api/index.ts` passes every existing assertion — while the
 * app it just "integrated" still renders `src/mocks/data.ts`.
 *
 * `gate-health` found the same hole from the other end. `runtime-frontend-api` — "the two
 * halves of the app talk to each other" — has run 17 times and passed zero times, the
 * suite's only never-passed gate. It is wired to `phases: [local]`, and the local phase
 * runs the debug agents, not integrate. So it asks whether the halves are connected at a
 * point in the chain where the scaffold's contract says they are deliberately not: the
 * frontend is mock-backed behind the seam until integrate swaps it.
 *
 * ## The contract is the product's own
 *
 * Every rule below is quoted from `resources/agents/azure-project-integrate/references/
 * wire-live-data.md`, not invented here:
 *
 *   - "`src/api/index.ts` — the **single swap point**: `export const api: ApiClient = mockClient;`"
 *   - "**Build the live client** at `src/api/client.ts` — a second implementation of the
 *     **same `ApiClient` interface**"
 *   - "Because `liveClient` is typed `: ApiClient`, the compiler guarantees it covers every
 *     method the pages already call."
 *   - "**Remove the mock layer.** Delete `src/api/mockClient.ts` and `src/mocks/*`"
 *   - "**Remove the Mock State Switcher** (`src/api/previewState.ts` + …)"
 *   - "a search of the frontend `src/` for `mock` / `mockData` / `previewState` must find
 *     nothing that is still imported"
 *
 * ## The check that stops this being a rename test
 *
 * `liveClientIssuesNoRequests` is the load-bearing one. Renaming `mockClient` to
 * `liveClient` and pointing the seam at it satisfies every other rule here — the seam no
 * longer says "mock", the mock file is gone, nothing imports `mocks/`. It would be a green
 * gate over an app that still serves canned arrays. So the module the seam resolves to has
 * to actually issue HTTP requests, which is the difference between wiring and renaming.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ArtifactValidationIssue, ArtifactValidationResult } from './validationTypes.ts';
import { createValidationResult } from './validationTypes.ts';
import { discoverFrontendDirectory } from './frontendScaffold.ts';

export interface FrontendSeamLiveOptions {
    /** Overrides discovery; the grader passes `--frontend-dir=` straight through. */
    frontendDirectory?: string;
}

/** Directories that are never agent-authored frontend source. */
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.vite']);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs']);

/**
 * How a live client reaches the API. Deliberately a list of transports rather than a check
 * for the string "fetch": the scaffold emits `fetch`, but an agent that reaches for `axios`
 * or `ky` has still wired the app, and failing it for that would be this gate inventing a
 * house style the product never asked for.
 */
const HTTP_TRANSPORTS = /\b(?:fetch|axios|XMLHttpRequest|ky|got|superagent|\$\.ajax)\b/;

/** `src/test/x.test.tsx`, `src/__tests__/x.tsx`, `x.spec.ts` — test-only source. */
function isTestFile(relative: string): boolean {
    const posix = relative.split(path.sep).join('/');
    return /(?:^|\/)(?:__tests__|__mocks__|tests?|e2e)\//.test(posix)
        || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(posix)
        || /(?:^|\/)setupTests\.[cm]?[jt]sx?$/.test(posix);
}

/**
 * Whether this workspace is even gradeable by the seam rules.
 *
 * Exported so the grader can decline rather than fail. Both inputs are produced by the
 * *scaffold* agent, and `wire-live-data.md` says outright that integrate falls back to a
 * call-site rewrite "If the scaffold did NOT leave a `src/api/` seam". Reporting a missing
 * seam as an integrate failure would blame this agent for the previous one's output, and
 * for a fallback the product explicitly permits.
 */
export async function findApiSeam(
    workspaceRoot: string,
    options: FrontendSeamLiveOptions = {},
): Promise<{ frontendDirectory: string; seamIndex: string } | undefined> {
    const frontendDirectory = options.frontendDirectory
        ? path.resolve(workspaceRoot, options.frontendDirectory)
        : await discoverFrontendDirectory(workspaceRoot);
    if (!frontendDirectory) {
        return undefined;
    }
    for (const name of ['index.ts', 'index.tsx', 'index.js', 'index.jsx']) {
        const candidate = path.join(frontendDirectory, 'src', 'api', name);
        if (await pathExists(candidate)) {
            return { frontendDirectory, seamIndex: candidate };
        }
    }
    return undefined;
}

export async function validateFrontendSeamLive(
    workspaceRoot: string,
    options: FrontendSeamLiveOptions = {},
): Promise<ArtifactValidationResult> {
    const issues: ArtifactValidationIssue[] = [];

    const seam = await findApiSeam(workspaceRoot, options);
    if (!seam) {
        // The grader checks this first and skips, so reaching here means a caller asked for
        // a verdict anyway. Say what is missing rather than returning a vacuous pass.
        issues.push({
            code: 'apiSeamNotFound',
            path: 'src/api/index.ts',
            message: 'No frontend with a `src/api/` seam was found, so the one-file swap cannot be checked here.',
        });
        return createValidationResult(issues);
    }

    const { frontendDirectory, seamIndex } = seam;
    const relative = (target: string): string =>
        path.relative(frontendDirectory, target).split(path.sep).join('/');

    const indexSource = await readFileSafe(seamIndex) ?? '';
    const binding = readSeamBinding(indexSource);

    if (!binding) {
        issues.push({
            code: 'seamExportUnreadable',
            path: relative(seamIndex),
            message: 'Could not read an `export const api: ApiClient = <client>` binding from the seam, '
                + 'so which client the app uses cannot be determined. The swap contract names this exact shape.',
        });
        return createValidationResult(issues);
    }

    // The headline failure: integrate ran and the seam still points at the scaffold's mock.
    if (/^mock/i.test(binding.identifier)) {
        issues.push({
            code: 'seamStillMocked',
            path: relative(seamIndex),
            message: `The seam still binds \`api\` to \`${binding.identifier}\`, so the app renders mock data. `
                + 'Integration is the one-file swap at this line (`mockClient` → `liveClient`); '
                + 'nothing downstream of it is wired until this changes.',
        });
    }

    // Where the bound identifier actually comes from, so the live client can be inspected
    // rather than assumed from its name.
    const liveModule = binding.specifier
        ? await resolveModule(path.dirname(seamIndex), binding.specifier)
        : undefined;

    if (binding.specifier && !liveModule) {
        issues.push({
            code: 'liveClientUnresolved',
            path: relative(seamIndex),
            message: `The seam imports \`${binding.identifier}\` from "${binding.specifier}", which resolves to no file `
                + 'in the frontend. The app cannot build, let alone call the API.',
        });
    }

    if (liveModule && !/^mock/i.test(binding.identifier)) {
        const clientSource = await readFileSafe(liveModule) ?? '';

        // "Because `liveClient` is typed `: ApiClient`, the compiler guarantees it covers
        // every method the pages already call." Without the annotation a half-implemented
        // client type-checks and fails at runtime on the first missing method.
        const typed = new RegExp(`\\b${escapeRegExp(binding.identifier)}\\s*:\\s*ApiClient\\b`).test(clientSource);
        if (!typed) {
            issues.push({
                code: 'liveClientUntyped',
                path: relative(liveModule),
                message: `\`${binding.identifier}\` is not annotated \`: ApiClient\`. The contract relies on that `
                    + 'annotation for the compiler to prove every method the pages call is implemented.',
            });
        }

        // The anti-rename check. See the header: every other rule here is satisfied by
        // renaming the mock.
        if (!HTTP_TRANSPORTS.test(clientSource)) {
            issues.push({
                code: 'liveClientIssuesNoRequests',
                path: relative(liveModule),
                message: `\`${binding.identifier}\` issues no HTTP request of any kind, so the seam was repointed at `
                    + 'another in-process implementation rather than at the API. Renaming the mock satisfies every '
                    + 'other rule in this contract; actually calling the backend is what distinguishes them.',
            });
        }
    }

    // "Remove the mock layer. Delete `src/api/mockClient.ts` and `src/mocks/*`" and
    // "Remove the Mock State Switcher (`src/api/previewState.ts` …)".
    const sourceRoot = path.join(frontendDirectory, 'src');
    for (const [code, target, what] of [
        ['mockClientRetained', path.join(sourceRoot, 'api', 'mockClient.ts'), 'the mock client'],
        ['mockDataRetained', path.join(sourceRoot, 'mocks'), 'the mock data directory'],
        ['previewStateRetained', path.join(sourceRoot, 'api', 'previewState.ts'), 'the preview-state switcher'],
    ] as const) {
        if (await pathExists(target)) {
            issues.push({
                code,
                path: relative(target),
                message: `Integration leaves ${what} behind: \`${relative(target)}\` still exists. `
                    + 'The contract deletes the mock layer, and a lingering copy is what lets a page drift back onto it.',
            });
        }
    }

    // "a search of the frontend `src/` for mock / mockData / previewState must find nothing
    // that is still imported". Files present but unreferenced are caught above; this catches
    // the worse case — deleted from the seam, still imported by a page.
    await collectMockImports(sourceRoot, frontendDirectory, issues);

    return createValidationResult(issues);
}

interface SeamBinding {
    /** The identifier `api` is assigned from, e.g. `liveClient`. */
    identifier: string;
    /** The module specifier that identifier was imported from, when it was imported. */
    specifier?: string;
}

/**
 * Pull `export const api: ApiClient = <identifier>` and the import that supplies it.
 *
 * Regex rather than a TypeScript parse because this file is a five-line generated seam with
 * a shape the contract pins exactly, and adding a parser dependency to an offline grader
 * that must run off source in a container is a cost with no matching benefit here.
 */
function readSeamBinding(source: string): SeamBinding | undefined {
    const assignment = /export\s+const\s+api\s*(?::\s*ApiClient\s*)?=\s*([A-Za-z_$][\w$]*)/.exec(source);
    if (!assignment) {
        return undefined;
    }
    const identifier = assignment[1];
    const imported = new RegExp(
        `import\\s*\\{[^}]*\\b${escapeRegExp(identifier)}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`,
    ).exec(source)
        ?? new RegExp(`import\\s+${escapeRegExp(identifier)}\\s+from\\s*['"]([^'"]+)['"]`).exec(source);
    return { identifier, specifier: imported?.[1] };
}

async function collectMockImports(
    sourceRoot: string,
    frontendDirectory: string,
    issues: ArtifactValidationIssue[],
): Promise<void> {
    for await (const file of walkSourceFiles(sourceRoot)) {
        const relativePath = path.relative(sourceRoot, file);
        // Tests may legitimately keep fixtures; they are not part of the shipped bundle.
        if (isTestFile(relativePath)) {
            continue;
        }
        const contents = await readFileSafe(file);
        if (contents === undefined) {
            continue;
        }
        const specifiers = [...contents.matchAll(/(?:from\s*|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g)];
        const offender = specifiers.find(([, specifier]) =>
            /(?:^|\/)mockClient$|(?:^|\/)mocks(?:\/|$)|(?:^|\/)previewState$/.test(specifier));
        if (offender) {
            issues.push({
                code: 'mockStillImported',
                path: path.relative(frontendDirectory, file).split(path.sep).join('/'),
                message: `Still imports "${offender[1]}" after integration. The contract requires that a search of `
                    + '`src/` for mock / mockData / previewState finds nothing still imported.',
            });
        }
    }
}

async function* walkSourceFiles(directory: string): AsyncGenerator<string> {
    let entries: import('node:fs').Dirent[];
    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
            continue;
        }
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* walkSourceFiles(full);
        } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
            yield full;
        }
    }
}

/** Resolve a relative import to a real file, trying the extensions TypeScript would. */
async function resolveModule(fromDirectory: string, specifier: string): Promise<string | undefined> {
    if (!specifier.startsWith('.')) {
        return undefined;
    }
    const base = path.resolve(fromDirectory, specifier);
    const candidates = [
        base,
        ...[...SOURCE_EXTENSIONS].map(extension => `${base}${extension}`),
        ...[...SOURCE_EXTENSIONS].map(extension => path.join(base, `index${extension}`)),
    ];
    for (const candidate of candidates) {
        if (await isFile(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readFileSafe(file: string): Promise<string | undefined> {
    try {
        return await fs.readFile(file, 'utf8');
    } catch {
        return undefined;
    }
}

async function isFile(target: string): Promise<boolean> {
    try {
        return (await fs.stat(target)).isFile();
    } catch {
        return false;
    }
}

async function pathExists(target: string): Promise<boolean> {
    try {
        await fs.stat(target);
        return true;
    } catch {
        return false;
    }
}

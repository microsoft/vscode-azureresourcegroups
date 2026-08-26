/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Validates the frontend the scaffold agent generates.
 *
 * Two classes of promise are checked, both drawn from
 * `resources/agents/azure-project-scaffold/references/frontend-preview-steps.md`:
 *
 * 1. **Preview embeddability** — the dev server must be reachable and framable by the
 *    `open_frontend_preview_view` webview iframe. When this breaks the app still runs
 *    fine in a browser tab, so the failure is invisible to the agent, but the user can
 *    never click "Approve UI" and the whole flow stalls. That asymmetry is exactly why
 *    it needs a grader.
 * 2. **Seam integrity** — pages and hooks import the `api` object from `src/api/`, never
 *    the mock directly, which is what keeps integration the one-file swap the integrate
 *    agent's instructions assume.
 *
 * Framework-specific checks are applied per detected framework rather than skipped, so
 * a non-Vite project cannot pass the embeddability section by default.
 */

import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ArtifactValidationIssue, ArtifactValidationResult } from './validationTypes.ts';
import { createValidationResult } from './validationTypes.ts';

export interface FrontendScaffoldOptions {
    /** Frontend folder relative to the workspace root. Discovered when omitted. */
    frontendDirectory?: string;
}

type Framework = 'vite' | 'next' | 'angular' | 'unknown';

interface PackageJson {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte']);
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', '.next', 'out', 'coverage']);

export async function validateFrontendScaffold(
    workspaceRoot: string,
    options: FrontendScaffoldOptions = {},
): Promise<ArtifactValidationResult> {
    const issues: ArtifactValidationIssue[] = [];

    const frontendDirectory = options.frontendDirectory
        ? path.resolve(workspaceRoot, options.frontendDirectory)
        : await discoverFrontendDirectory(workspaceRoot);

    if (!frontendDirectory) {
        issues.push({
            code: 'frontendNotFound',
            path: 'services/web',
            message: 'No frontend project was scaffolded (looked for a folder containing package.json and index.html).',
        });
        return createValidationResult(issues);
    }

    const relativeFrontend = path.relative(workspaceRoot, frontendDirectory) || '.';
    const packageJson = await readPackageJson(frontendDirectory, relativeFrontend, issues);
    if (!packageJson) {
        return createValidationResult(issues);
    }

    const framework = detectFramework(frontendDirectory, packageJson);
    await checkDevServerIsEmbeddable(frontendDirectory, relativeFrontend, framework, packageJson, issues);
    await checkNoFrameBusting(frontendDirectory, relativeFrontend, issues);
    await checkNoCompetingDevServer(workspaceRoot, issues);
    await checkApiSeam(frontendDirectory, relativeFrontend, issues);

    return createValidationResult(issues);
}

/**
 * Locate the frontend the plan promised.
 *
 * Discovery is scored rather than first-match. A monorepo scaffold routinely contains
 * several packages that a "has package.json and a src/ folder" test cannot tell apart —
 * `services/shared` (types), `services/support-api` (Functions), `services/support-portal`
 * (the actual UI) — and an alphabetical first-match lands on the shared library, which
 * then fails every frontend check for the entirely uninteresting reason that a types
 * package is not a React app. That reports a passing agent as broken.
 *
 * So a candidate must show positive evidence of being a *browser* project, and among
 * qualifying candidates the strongest wins.
 */
export async function discoverFrontendDirectory(workspaceRoot: string): Promise<string | undefined> {
    const candidates: string[] = [workspaceRoot];
    for (const groupName of ['services', 'apps', 'packages']) {
        const group = path.join(workspaceRoot, groupName);
        for (const entry of await readDirectorySafe(group)) {
            if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
                candidates.push(path.join(group, entry.name));
            }
        }
    }

    let best: { directory: string; score: number } | undefined;
    for (const candidate of candidates) {
        const score = await scoreFrontendCandidate(candidate);
        if (score <= 0) {
            continue;
        }
        // `services/web` is the documented default, so it wins ties against a package that
        // merely looks equally frontend-ish.
        const adjusted = path.relative(workspaceRoot, candidate) === path.join('services', 'web') ? score + 1 : score;
        if (!best || adjusted > best.score) {
            best = { directory: candidate, score: adjusted };
        }
    }
    return best?.directory;
}

/**
 * Positive evidence that a package is a browser frontend. Returns 0 for "not a frontend",
 * so a shared library or a Functions backend is skipped rather than mis-graded.
 */
async function scoreFrontendCandidate(directory: string): Promise<number> {
    let packageJson: PackageJson;
    try {
        packageJson = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')) as PackageJson;
    } catch {
        return 0;
    }

    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const scripts = packageJson.scripts ?? {};
    let score = 0;

    // An index.html is the strongest signal: it is what the browser actually loads.
    if (await pathExists(path.join(directory, 'index.html'))) {
        score += 3;
    }
    if (['next', '@angular/core', 'react', 'react-dom', 'vue', 'svelte'].some(dep => dependencies[dep])) {
        score += 2;
    }
    if (dependencies['vite'] || findViteConfigName(directory)) {
        score += 2;
    }
    // A dev/start script alone is weak — plenty of backends have one — so it only ever
    // reinforces a candidate that already showed a browser signal.
    if (score > 0 && (scripts.dev || scripts.start)) {
        score += 1;
    }
    return score;
}

async function readPackageJson(
    frontendDirectory: string,
    relativeFrontend: string,
    issues: ArtifactValidationIssue[],
): Promise<PackageJson | undefined> {
    const packageJsonPath = path.join(frontendDirectory, 'package.json');
    let raw: string;
    try {
        raw = await fs.readFile(packageJsonPath, 'utf8');
    } catch {
        issues.push({
            code: 'missingFrontendPackageJson',
            path: `${relativeFrontend}/package.json`,
            message: 'The frontend project has no package.json.',
        });
        return undefined;
    }
    try {
        return JSON.parse(raw) as PackageJson;
    } catch {
        issues.push({
            code: 'invalidFrontendPackageJson',
            path: `${relativeFrontend}/package.json`,
            message: 'The frontend package.json is not valid JSON.',
        });
        return undefined;
    }
}

function detectFramework(frontendDirectory: string, packageJson: PackageJson): Framework {
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    if (dependencies['next']) {
        return 'next';
    }
    if (dependencies['@angular/core']) {
        return 'angular';
    }
    if (dependencies['vite'] || findViteConfigName(frontendDirectory)) {
        return 'vite';
    }
    return 'unknown';
}

function findViteConfigName(frontendDirectory: string): string | undefined {
    for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']) {
        if (existsSync(path.join(frontendDirectory, name))) {
            return name;
        }
    }
    return undefined;
}

/**
 * The dev server must bind a reachable interface, accept the webview/forwarded origin,
 * fall back to a free port, and actually serve. Each of those is a distinct way for the
 * preview to hang on "Starting…", so each gets its own issue code.
 */
async function checkDevServerIsEmbeddable(
    frontendDirectory: string,
    relativeFrontend: string,
    framework: Framework,
    packageJson: PackageJson,
    issues: ArtifactValidationIssue[],
): Promise<void> {
    const devScript = packageJson.scripts?.dev ?? packageJson.scripts?.start;
    if (!devScript) {
        issues.push({
            code: 'missingDevScript',
            path: `${relativeFrontend}/package.json`,
            message: 'The frontend needs a "dev" (or "start") script; the preview starts the dev server through it.',
        });
    } else if (/\bbuild\b/.test(devScript) && !/\bserve\b/.test(devScript)) {
        // `vite build --watch` recompiles but never prints a localhost URL, so the
        // preview waits for a server that will never arrive.
        issues.push({
            code: 'devScriptDoesNotServe',
            path: `${relativeFrontend}/package.json#scripts.dev`,
            message: `The dev script must start a server that prints a localhost URL, not run a build: "${devScript}".`,
        });
    }

    switch (framework) {
        case 'vite':
            await checkViteServerConfig(frontendDirectory, relativeFrontend, issues);
            break;
        case 'next':
            if (!devScript || !/-H\s+0\.0\.0\.0|--hostname\s+0\.0\.0\.0/.test(devScript)) {
                issues.push({
                    code: 'devServerNotReachable',
                    path: `${relativeFrontend}/package.json#scripts.dev`,
                    message: 'A Next.js dev script must bind all interfaces (`next dev -H 0.0.0.0`) so the webview can reach it.',
                });
            }
            break;
        case 'angular':
            if (!devScript || !/--host[= ]0\.0\.0\.0/.test(devScript)) {
                issues.push({
                    code: 'devServerNotReachable',
                    path: `${relativeFrontend}/package.json#scripts.dev`,
                    message: 'An Angular dev script must pass `--host 0.0.0.0` so the webview can reach it.',
                });
            }
            if (!devScript || !/--disable-host-check/.test(devScript)) {
                issues.push({
                    code: 'devServerRejectsWebviewOrigin',
                    path: `${relativeFrontend}/package.json#scripts.dev`,
                    message: 'An Angular dev script must pass `--disable-host-check` or it 403s the forwarded origin.',
                });
            }
            break;
        default:
            issues.push({
                code: 'unknownFrontendFramework',
                path: `${relativeFrontend}/package.json`,
                message: 'Could not identify the frontend framework, so preview embeddability cannot be verified.',
            });
    }
}

async function checkViteServerConfig(
    frontendDirectory: string,
    relativeFrontend: string,
    issues: ArtifactValidationIssue[],
): Promise<void> {
    const configName = findViteConfigName(frontendDirectory);
    if (!configName) {
        issues.push({
            code: 'missingViteConfig',
            path: `${relativeFrontend}/vite.config.ts`,
            message: 'A Vite frontend needs a vite.config file carrying the preview-embeddable server settings.',
        });
        return;
    }

    const config = await fs.readFile(path.join(frontendDirectory, configName), 'utf8');
    const settings: Array<{ pattern: RegExp; code: string; message: string }> = [
        {
            pattern: /host\s*:\s*(?:true|['"]0\.0\.0\.0['"])/,
            code: 'devServerNotReachable',
            message: 'vite.config server must set `host: true` so the webview / forwarded port can reach the dev server.',
        },
        {
            pattern: /allowedHosts\s*:\s*(?:true|\[)/,
            code: 'devServerRejectsWebviewOrigin',
            message: 'vite.config server must set `allowedHosts: true` or the dev server 403-blocks the webview origin.',
        },
        {
            pattern: /strictPort\s*:\s*false/,
            code: 'devServerStrictPort',
            message: 'vite.config server must set `strictPort: false` so the preview can bind a free port.',
        },
    ];
    for (const setting of settings) {
        if (!setting.pattern.test(config)) {
            issues.push({ code: setting.code, path: `${relativeFrontend}/${configName}`, message: setting.message });
        }
    }
}

/**
 * Frame-busting is the "works in my browser, blank in the preview" trap: a top-level tab
 * loads fine while the webview iframe is refused.
 */
async function checkNoFrameBusting(
    frontendDirectory: string,
    relativeFrontend: string,
    issues: ArtifactValidationIssue[],
): Promise<void> {
    const indexPath = path.join(frontendDirectory, 'index.html');
    const html = await readFileSafe(indexPath);
    if (html === undefined) {
        return;
    }
    if (/frame-ancestors/i.test(html)) {
        issues.push({
            code: 'previewFrameBusting',
            path: `${relativeFrontend}/index.html`,
            message: 'index.html sets a `frame-ancestors` CSP, which blocks the preview webview from embedding the app.',
        });
    }
    if (/X-Frame-Options/i.test(html)) {
        issues.push({
            code: 'previewFrameBusting',
            path: `${relativeFrontend}/index.html`,
            message: 'index.html sets `X-Frame-Options`, which blocks the preview webview from embedding the app.',
        });
    }
}

/**
 * The preview tool owns the single dev server. A task that auto-starts another one
 * contends for the port, and the survivor is usually not the preview's.
 */
async function checkNoCompetingDevServer(workspaceRoot: string, issues: ArtifactValidationIssue[]): Promise<void> {
    const tasks = await readFileSafe(path.join(workspaceRoot, '.vscode', 'tasks.json'));
    if (tasks === undefined) {
        return;
    }
    if (/folderOpen/.test(tasks) && /\bdev\b|\bserve\b/.test(tasks)) {
        issues.push({
            code: 'competingDevServerTask',
            path: '.vscode/tasks.json',
            message: 'A task auto-starts a dev server on folder open; it contends for the port the preview needs.',
        });
    }
}

/**
 * The seam is what makes integration a one-file swap, so it is checked structurally:
 * the entry, the interface, the mock impl, the state switcher, and — most importantly —
 * that nothing outside `src/api/` reaches around it.
 */
async function checkApiSeam(
    frontendDirectory: string,
    relativeFrontend: string,
    issues: ArtifactValidationIssue[],
): Promise<void> {
    const apiDirectory = path.join(frontendDirectory, 'src', 'api');
    if (!await pathExists(apiDirectory)) {
        issues.push({
            code: 'missingApiSeam',
            path: `${relativeFrontend}/src/api/`,
            message: 'The frontend must expose the `src/api/` seam the integrate agent swaps to reach live data.',
        });
        return;
    }

    // `index.ts` is the one file the integrate agent repoints, so its name is part of
    // the contract. The rest is graded by content across `src/api/**`: agents routinely
    // split the seam as `types.ts` (domain types) + `client.ts` (the interface), which
    // keeps integration a one-file swap just as well as the documented layout.
    if (!await pathExists(path.join(apiDirectory, 'index.ts'))) {
        issues.push({
            code: 'missingApiSeamEntry',
            path: `${relativeFrontend}/src/api/index.ts`,
            message: 'src/api/index.ts is the single file the integrate agent repoints from mock to live.',
        });
    }

    const seamSources: string[] = [];
    for await (const file of walkSourceFiles(apiDirectory)) {
        const contents = await readFileSafe(file);
        if (contents !== undefined) {
            seamSources.push(contents);
        }
    }

    const declaresApiClient = seamSources.some(s => /(?:interface|type)\s+ApiClient\b/.test(s));
    if (!declaresApiClient) {
        issues.push({
            code: 'missingApiClientInterface',
            path: `${relativeFrontend}/src/api/`,
            message: 'The seam must declare an `ApiClient` type both the mock and the live client implement.',
        });
    }

    // The mock is what makes the preview render without a backend; it must be typed as
    // the seam contract so the live client is a drop-in replacement. Match the binding
    // itself — `export const api: ApiClient = mockClient` in the entry file is the swap
    // wiring, not the implementation, and must not stand in for it.
    const mockBinding = /(?:const|let|var|class)\s+\w*(?:[Mm]ock|[Ss]tub|[Ff]ake)\w*\s*(?::\s*ApiClient\b|[^\n]*\b(?:implements|satisfies)\s+ApiClient\b)/;
    const providesMockClient = seamSources.some(s => mockBinding.test(s));
    if (!providesMockClient) {
        issues.push({
            code: 'missingMockClient',
            path: `${relativeFrontend}/src/api/`,
            message: 'The seam must provide a scaffold-time `ApiClient` implementation backed by mock data.',
        });
    }

    const providesPreviewState = seamSources.some(s => /PreviewDataState|previewState/.test(s));
    if (!providesPreviewState) {
        issues.push({
            code: 'missingPreviewStateSwitcher',
            path: `${relativeFrontend}/src/api/`,
            message: 'The seam must expose the Mock State Switcher (data/loading/empty/error).',
        });
    }

    await checkSeamNotBypassed(frontendDirectory, issues);
}

/** `src/test/x.test.tsx`, `src/__tests__/x.tsx`, `x.spec.ts` — all test-only source. */
function isTestFile(relative: string): boolean {
    const posix = relative.split(path.sep).join('/');
    return /(?:^|\/)(?:__tests__|__mocks__|tests?|e2e)\//.test(posix)
        || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(posix)
        || /(?:^|\/)setupTests\.[cm]?[jt]sx?$/.test(posix);
}

async function checkSeamNotBypassed(    frontendDirectory: string,
    issues: ArtifactValidationIssue[],
): Promise<void> {
    const sourceRoot = path.join(frontendDirectory, 'src');
    const seamRoot = path.join(sourceRoot, 'api');
    const mockRoot = path.join(sourceRoot, 'mocks');

    for await (const file of walkSourceFiles(sourceRoot)) {
        if (file.startsWith(seamRoot + path.sep) || file.startsWith(mockRoot + path.sep)) {
            continue;
        }
        // Tests are supposed to reach for fixtures directly, and they are not part of the
        // shipped bundle the integrate agent repoints — flagging them would penalise the
        // agent for testing its own mock data.
        if (isTestFile(path.relative(sourceRoot, file))) {
            continue;
        }
        const contents = await readFileSafe(file);
        if (contents === undefined) {
            continue;
        }
        // Only import/require specifiers count — a page may legitimately mention "mock" in prose.
        const specifiers = [...contents.matchAll(/(?:from\s*|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g)];
        const bypass = specifiers.find(([, specifier]) => /(?:^|\/)mockClient$|(?:^|\/)mocks(?:\/|$)/.test(specifier));
        if (bypass) {
            issues.push({
                code: 'apiSeamBypassed',
                path: path.relative(frontendDirectory, file).split(path.sep).join('/'),
                message: `Imports "${bypass[1]}" directly instead of the \`src/api/\` seam, which breaks the one-file swap at integrate time.`,
            });
        }
    }
}

async function* walkSourceFiles(directory: string): AsyncGenerator<string> {
    for (const entry of await readDirectorySafe(directory)) {
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

async function readDirectorySafe(directory: string): Promise<import('node:fs').Dirent[]> {
    try {
        return await fs.readdir(directory, { withFileTypes: true });
    } catch {
        return [];
    }
}

async function readFileSafe(file: string): Promise<string | undefined> {
    try {
        return await fs.readFile(file, 'utf8');
    } catch {
        return undefined;
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

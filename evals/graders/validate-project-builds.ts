/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades the one property no document check can stand in for: the project the scaffold
 * agent generated actually installs and builds.
 *
 * The artifact validators in `../src/artifacts` read files, so they can only confirm a
 * project *looks* right — a frontend with a plausible `vite.config.ts` and a broken import
 * graph passes every one of them. Building is what makes the difference observable, which
 * is why this grader runs the real package manager rather than inspecting more text.
 *
 * Every workspace package is built, not just the frontend. An API-only scaffold has no
 * frontend at all, and for that shape this grader is the only evidence that the agent
 * emitted a working project.
 *
 * Discovery is shared with `validateFrontendScaffold` so a plan that names something other
 * than `services/web` cannot pass the scaffold contract and then fail here with a confusing
 * "no package.json" — the two graders resolve the same folder.
 *
 * Tests are *not* run by default. Writing tests belongs to `azure-project-test`, a separate
 * agent, so failing the scaffold agent for an untested package grades the wrong contract —
 * and a scaffolded-but-empty vitest project exits 1 with "No test files found", which would
 * fail this grader for doing exactly what the scaffold agent was asked to do.
 *
 * Flags:
 *   --require-frontend   fail when no frontend package was found (plans that promise a UI)
 *   --with-tests         additionally run each package's test script
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { discoverPackages, type ProjectPackage, validateProjectPackages } from '../src/artifacts/projectPackages.ts';
import { discoverFrontendDirectory } from '../src/artifacts/frontendScaffold.ts';
import { fail, failWithIssues, runGraderAsync, workspacePath } from './graderHarness.ts';

/**
 * Package discovery and the pre-build checks live in src/artifacts/projectPackages.ts,
 * shared with grader certification so the certified path and the executed path cannot drift.
 */

/** Run one package script, returning the combined output when it fails. */
function run(label: string, pkg: ProjectPackage, args: string[], timeoutMs: number): string | undefined {
    process.stderr.write(`[project-builds] ${pkg.relative}: ${label}\n`);
    const result = spawnSync('npm', args, {
        cwd: pkg.directory,
        encoding: 'utf8',
        timeout: timeoutMs,
        // npm resolves its own config relative to cwd; inheriting the eval's env is enough.
        env: { ...process.env, CI: '1' },
    });
    if (result.error) {
        return `${label} could not start: ${result.error.message}`;
    }
    if (result.status !== 0) {
        const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
        // npm dumps its entire config reference after a usage error, so a tail-only
        // excerpt shows help text instead of the cause. Drop the reference block, then
        // keep both ends: npm reports usage errors first, builds report them last.
        const lines = output
            .split('\n')
            .filter(line => !/^npm error\s{4,}/.test(line) && !/^npm error\s+--/.test(line));
        const excerpt = lines.length > 40
            ? [...lines.slice(0, 15), `… ${lines.length - 35} lines omitted …`, ...lines.slice(-20)]
            : lines;
        return `${label} exited ${result.status ?? 'via signal ' + result.signal}\n${excerpt.join('\n').trim()}`;
    }
    return undefined;
}

void runGraderAsync('scaffolded project installs and builds', async () => {
    const flags = process.argv.slice(2);
    const requireFrontend = flags.includes('--require-frontend');
    const withTests = flags.includes('--with-tests');

    const workspaceRoot = workspacePath('.');

    // Everything decidable without installing anything: is there a project here at all, are
    // its manifests readable, and does it contain the frontend the plan promised.
    const preBuild = await validateProjectPackages(workspaceRoot, { requireFrontend });
    if (!preBuild.valid) {
        failWithIssues('the scaffolded project cannot be built:', preBuild.issues);
    }
    const { packages } = discoverPackages(workspaceRoot);
    if (requireFrontend) {
        const frontend = await discoverFrontendDirectory(workspaceRoot);
        process.stderr.write(`[project-builds] frontend: ${frontend ? path.relative(workspaceRoot, frontend) || '.' : '<none>'}\n`);
    }

    // An npm-workspaces root installs every child from its own lockfile, and a child install
    // run first would fight it over the shared node_modules. Install from the root only.
    const workspacesRoot = packages.find(pkg => pkg.relative === '.' && pkg.delegatesToWorkspaces);

    const failures: string[] = [];
    for (const pkg of packages) {
        if (workspacesRoot && pkg !== workspacesRoot) {
            // Already installed as part of the root's workspace install.
        } else {
            // `npm ci` is the deterministic path, but it hard-fails when a lockfile the
            // agent generated mid-scaffold has drifted from the final package.json. That
            // is a lockfile-freshness nit, not "the project does not build", so fall back
            // to `npm install` and only report a failure when that fails too.
            const hasLockfile = existsSync(path.join(pkg.directory, 'package-lock.json'));
            let installFailure = hasLockfile
                ? run('npm ci', pkg, ['ci', '--no-audit', '--no-fund'], 10 * 60_000)
                : undefined;
            if (installFailure) {
                process.stderr.write(`[project-builds] ${pkg.relative}: npm ci failed, retrying with npm install\n`);
                const retryFailure = run('npm install', pkg, ['install', '--no-audit', '--no-fund'], 10 * 60_000);
                installFailure = retryFailure && `${installFailure}\n--- retry ---\n${retryFailure}`;
            } else if (!hasLockfile) {
                installFailure = run('npm install', pkg, ['install', '--no-audit', '--no-fund'], 10 * 60_000);
            }
            if (installFailure) {
                // A failed install makes every later step meaningless for this package.
                failures.push(`${pkg.relative}: ${installFailure}`);
                if (pkg === workspacesRoot) {
                    break;
                }
                continue;
            }
        }

        if (pkg.scripts.build) {
            const buildFailure = run('npm run build', pkg, ['run', 'build'], 10 * 60_000);
            if (buildFailure) {
                failures.push(`${pkg.relative}: ${buildFailure}`);
            }
        }

        // A workspaces root's `test` fans out to the children this loop already visits, so
        // running both double-runs every suite and misattributes a child's failure to `.`.
        const test = pkg.scripts.test;
        const delegates = pkg.delegatesToWorkspaces && /--workspaces/.test(test ?? '');
        if (withTests && test && !delegates && !/no test specified/.test(test)) {
            const testFailure = run('npm test', pkg, ['test'], 10 * 60_000);
            if (testFailure) {
                failures.push(`${pkg.relative}: ${testFailure}`);
            }
        }
    }

    if (failures.length > 0) {
        fail(`the scaffolded project does not build:\n${failures.map(f => `  • ${f}`).join('\n')}`);
    }

    process.stderr.write(`[project-builds] built ${packages.length} package(s): ${packages.map(p => p.relative).join(', ')}\n`);
});

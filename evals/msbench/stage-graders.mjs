#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Stage the Vally graders into the MSBench agent assets, so `exec:` assertions can
 * run the *real* validators inside the container instead of a SQL lookalike.
 *
 * Everything under `assets/` is copied to `/agent/assets` in the container, so the
 * graders are the same kind of payload as the VSIX. They are copied rather than
 * checked in: a second copy in the repo is exactly the drift this eval exists to
 * catch, so the tree is generated on every run and gitignored.
 *
 * The graders import across two roots — `evals/` and the extension's own `src/`:
 *
 *   evals/graders/validate-requirements.ts
 *     -> evals/src/artifacts/requirements.ts
 *          -> src/webviews/copilotOnRails/views/utils/parseRequirements.ts
 *     -> evals/graders/graderHarness.ts
 *
 * so the repo-relative layout is preserved verbatim under `assets/graders/` and the
 * relative specifiers resolve unchanged. Rather than hardcode that list, walk the
 * import graph from the entrypoints. Two failure modes are then caught here, on a
 * developer machine in milliseconds, instead of 4 minutes into a container run:
 *
 *   - a missing file (someone moved a validator), and
 *   - a *bare* specifier reachable from a grader (e.g. `vscode-nls`), which would
 *     need node_modules that the container does not have.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const DEST = join(HERE, 'assets', 'graders');

/**
 * The graders an `exec:` assertion may invoke. All three are staged even though only
 * the requirements validator is wired up today, because the marginal cost is a few
 * kilobytes and it keeps the multi-turn stimuli a config change rather than a code one.
 */
const ENTRYPOINTS = [
    'evals/graders/validate-requirements.ts',
    'evals/graders/validate-project-plan.ts',
    'evals/graders/validate-webview-parseable.ts',
];

// Matches the specifier in `from '...'`, `import '...'` and `import('...')`. Type-only
// imports are erased at runtime, but they are followed anyway: over-staging costs a
// few kilobytes, while reasoning about which imports survive erasure costs correctness.
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;

/** @param {string} repoRelative */
function collect(repoRelative, seen, trail) {
    if (seen.has(repoRelative)) {
        return seen;
    }
    const absolute = join(REPO_ROOT, repoRelative);
    if (!existsSync(absolute)) {
        throw new Error(`${repoRelative} does not exist (imported by ${trail})`);
    }
    seen.add(repoRelative);

    const source = readFileSync(absolute, 'utf8');
    for (const [, specifier] of source.matchAll(SPECIFIER)) {
        if (specifier.startsWith('node:')) {
            continue;
        }
        if (!specifier.startsWith('.')) {
            throw new Error(
                `${repoRelative} imports '${specifier}' from node_modules.\n` +
                `The container stages source files only, with no install step, so a grader\n` +
                `reachable from a bare specifier cannot run there. Inline it, make the import\n` +
                `type-only, or teach this script to stage node_modules.`
            );
        }
        const target = relative(REPO_ROOT, resolve(dirname(absolute), specifier));
        collect(toPosix(target), seen, repoRelative);
    }
    return seen;
}

/** @param {string} p */
function toPosix(p) {
    return p.split(/[\\/]/).join(posix.sep);
}

function main() {
    const files = new Set();
    for (const entrypoint of ENTRYPOINTS) {
        collect(entrypoint, files, '<entrypoint>');
    }

    rmSync(DEST, { recursive: true, force: true });
    for (const file of [...files].sort()) {
        const target = join(DEST, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(join(REPO_ROOT, file)));
    }

    // The graders are ESM. Without a `type` the nearest package.json lookup walks out
    // of the staged tree and Node falls back to CommonJS detection, so declare it at
    // the staged root. `evals/package.json` is deliberately not copied — it carries
    // dependencies that do not exist in the container.
    writeFileSync(
        join(DEST, 'package.json'),
        JSON.stringify({ name: 'msbench-graders', private: true, type: 'module' }, null, 2) + '\n'
    );

    console.log(`Staged ${files.size} grader source files to ${relative(REPO_ROOT, DEST)}`);
    for (const file of [...files].sort()) {
        console.log(`  ${file}`);
    }
}

main();

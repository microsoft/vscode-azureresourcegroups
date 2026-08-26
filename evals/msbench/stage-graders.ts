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
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findImportSpecifiers } from './importScanner.ts';

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
    'evals/graders/validate-integration-plan.ts',
    'evals/graders/validate-frontend-scaffold.ts',
    'evals/graders/validate-no-scaffold.ts',
    'evals/graders/validate-project-builds.ts',
    'evals/graders/validate-debug-plan.ts',
    'evals/graders/validate-debug-config.ts',
    'evals/graders/validate-debug-gate.ts',
    'evals/graders/validate-debug-artifacts.ts',
];

// Import specifiers are found by a small tokenizer in `importScanner.ts`, not by a
// regex over raw source. The regex that used to live here did not know what a comment
// was, so a doc comment reading `turns a red from "mysterious failure" into ...` was
// read as an import of a package by that name and failed the build on a sentence.
// See importScanner.ts for why the TypeScript compiler's own scanner cannot be used.
//
// Type-only imports are erased at runtime, but they are followed anyway: over-staging
// costs a few kilobytes, while reasoning about which imports survive erasure costs
// correctness.

/**
 * Bare specifiers a grader may import, staged from `evals/node_modules` alongside the
 * sources. The container has no install step, so anything not listed here is a hard
 * error rather than a runtime surprise four minutes into a run.
 *
 * Kept to genuinely dependency-free packages on purpose. `launch.json` is JSON with
 * comments and trailing commas, and a hand-rolled tolerant reader is a few dozen lines
 * of subtle escape handling whose failure mode is a *silent* mis-parse — so the real
 * parser travels with the graders instead. Transitive dependencies are not resolved;
 * a package that declares any is rejected below rather than staged incompletely.
 */
const STAGED_PACKAGES = new Set(['jsonc-parser']);

/**
 * Walk the import graph from `repoRelative`, adding every reachable repo-relative
 * source file to `seen`. `trail` names the importer, so a missing file reports who
 * asked for it rather than just that it is absent.
 */
function collect(repoRelative: string, seen: Set<string>, trail: string, packages: Set<string>): Set<string> {
    if (seen.has(repoRelative)) {
        return seen;
    }
    const absolute = join(REPO_ROOT, repoRelative);
    if (!existsSync(absolute)) {
        throw new Error(`${repoRelative} does not exist (imported by ${trail})`);
    }
    seen.add(repoRelative);

    const source = readFileSync(absolute, 'utf8');
    for (const specifier of findImportSpecifiers(source)) {
        if (specifier.startsWith('node:')) {
            continue;
        }
        if (!specifier.startsWith('.')) {
            const packageName = specifier.startsWith('@')
                ? specifier.split('/').slice(0, 2).join('/')
                : specifier.split('/')[0];
            if (STAGED_PACKAGES.has(packageName)) {
                packages.add(packageName);
                continue;
            }
            throw new Error(
                `${repoRelative} imports '${specifier}' from node_modules.\n` +
                `The container stages source files only, with no install step, so a grader\n` +
                `reachable from a bare specifier cannot run there. Inline it, make the import\n` +
                `type-only, or add the package to STAGED_PACKAGES if it has no dependencies.`
            );
        }
        const target = relative(REPO_ROOT, resolve(dirname(absolute), specifier));
        collect(toPosix(target), seen, repoRelative, packages);
    }
    return seen;
}

/**
 * Copy one dependency-free package into the staged tree's `node_modules`, so a grader's
 * bare import resolves there exactly as it does locally.
 */
/**
 * Where a staged package may be found, in order.
 *
 * Both are searched because `jsonc-parser` is a declared runtime dependency of the
 * *extension* (`package.json` at the repo root) as well as of `evals/`, so the copy at
 * the repo root is not a fallback — it is the package's primary home. Requiring the
 * `evals/` copy specifically was an unnecessary constraint, and it broke
 * `check-clean-machine.ts`, which hides `evals/node_modules` to prove `run.sh` still
 * works on a host where nothing has been installed into `evals/`.
 *
 * Note what this does NOT claim. Staging is a copy, so it cannot succeed if the package
 * is absent from every location — you cannot stage what does not exist on disk. That is
 * a data dependency of the operation, not an eager import by this script, which has no
 * bare imports at all.
 */
const PACKAGE_ROOTS = [
    join(REPO_ROOT, 'evals', 'node_modules'),
    join(REPO_ROOT, 'node_modules'),
];

function stagePackage(name: string): void {
    const source = PACKAGE_ROOTS.map(root => join(root, name)).find(candidate => existsSync(candidate));
    if (!source) {
        throw new Error(
            `${name} is staged for the container but is not installed anywhere.\n` +
            `Looked in:\n${PACKAGE_ROOTS.map(root => `  ${relative(REPO_ROOT, root)}/${name}`).join('\n')}\n` +
            `Staging copies the package into the staged tree, so one of these must exist.\n` +
            `Run 'npm ci' at the repo root or in evals/.`
        );
    }
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
    };
    if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
        throw new Error(
            `${name} declares dependencies (${Object.keys(manifest.dependencies).join(', ')}).\n` +
            `Only dependency-free packages can be staged, because this script does not walk\n` +
            `the node_modules graph — a partial copy would fail inside the container instead.`
        );
    }
    cpSync(source, join(DEST, 'node_modules', name), { recursive: true });
}

function toPosix(p: string): string {
    return p.split(/[\\/]/).join(posix.sep);
}

function main(): void {
    const files = new Set<string>();
    const packages = new Set<string>();
    for (const entrypoint of ENTRYPOINTS) {
        collect(entrypoint, files, '<entrypoint>', packages);
    }

    rmSync(DEST, { recursive: true, force: true });
    for (const file of [...files].sort()) {
        const target = join(DEST, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(join(REPO_ROOT, file)));
    }
    for (const name of [...packages].sort()) {
        stagePackage(name);
    }

    // The graders are ESM. Without a `type` the nearest package.json lookup walks out
    // of the staged tree and Node falls back to CommonJS detection, so declare it at
    // the staged root. `evals/package.json` is deliberately not copied — it carries
    // dependencies that do not exist in the container.
    writeFileSync(
        join(DEST, 'package.json'),
        JSON.stringify({ name: 'msbench-graders', private: true, type: 'module' }, null, 2) + '\n'
    );

    console.log(`Staged ${files.size} grader source files and ${packages.size} package(s) to ${relative(REPO_ROOT, DEST)}`);
    for (const file of [...files].sort()) {
        console.log(`  ${file}`);
    }
}

main();

#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Prove that `run.sh` still works on a machine with nothing installed.
 *
 * ## Why this exists, stated against its author
 *
 * `run.sh` promises that "a clean machine with `az login` already done should be
 * able to execute this unmodified", and the MSBench `eval` job depends on it:
 * checkout, setup-node, download the VSIX artifact, `run.sh --skip-build`.
 * **Nothing installs anything on that host** — no `node_modules` at the repo
 * root, none in `evals/`. A script `run.sh` invokes that statically imports a
 * third-party package therefore fails there, on the one path where failure costs
 * money.
 *
 * That constraint was written down, in prose, as the reason `stage-graders.ts`
 * could not use `ts.preProcessFile`. The very next change to that file family —
 * by the same author, the same night — added four static imports of a
 * YAML-parsing module to `build-config.ts` and turned the build red.
 *
 * **Knowing the rule and writing it down did not enforce it. CI did.** So the
 * rule stops being prose here and becomes a mechanism.
 *
 * ## Two halves, because either alone is fooled
 *
 * 1. **Static** — walk the eagerly-imported graph of each entrypoint and reject
 *    any bare specifier. Deterministic and instant, and it names the offending
 *    file and its import chain rather than a stack trace. Dynamic `import()` is
 *    deliberately allowed to reach third-party code: it runs only when that path
 *    is taken, which is exactly how `--stack` is offered without burdening the
 *    stimulus path.
 * 2. **Executed** — actually run the entrypoints with `evals/node_modules`
 *    hidden. The static walk cannot see a dependency acquired some other way (a
 *    `require`, a transitive package resolved at runtime), and "it should work"
 *    has been wrong once already today.
 *
 * The second half is what the first would miss; the first is what makes the
 * second's failures legible.
 *
 * ## A negative control
 *
 * A guard that cannot fail is worse than no guard, so the static walker is also
 * pointed at a synthetic file containing a real bare import and must reject it.
 * Without that, a walker broken to return nothing would report success forever.
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 *
 * Usage: npm run clean-machine:check
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findImportReferences } from './importScanner.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVALS_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(EVALS_ROOT, '..');
const NODE_MODULES = join(EVALS_ROOT, 'node_modules');

/**
 * Where `node_modules` is parked while the executed half runs.
 *
 * A fixed, self-describing name rather than a random one, so that a run killed
 * halfway leaves something a human can identify — and so this script can restore
 * it automatically on the next invocation instead of leaving a broken checkout.
 */
const PARKED = join(EVALS_ROOT, 'node_modules.parked-by-clean-machine-check');

/**
 * Everything `run.sh` invokes with `node`. Keep this in step with `run.sh`; a
 * script added there and not here is unguarded.
 */
const ENTRYPOINTS = [
    // `stagesPackages` marks the one entrypoint the executed half cannot hold to
    // the letter, and says why rather than quietly dropping it.
    //
    // The static half — no eagerly imported bare specifiers — still applies and is
    // what this check is really protecting: it is what decides whether the script
    // can *run* at all on a bare host. Staging is a different thing. It COPIES an
    // allowlisted, dependency-free package (`jsonc-parser`, which the debug graders
    // import because launch.json is JSON with comments) into the staged tree,
    // because the container has no install step. A copy needs a source, so with
    // every node_modules hidden there is nothing to copy and no implementation can
    // succeed. That is a data dependency of the operation, not an import by the
    // script.
    //
    // run.sh handles the real case: it installs only when neither the repo root nor
    // evals/ has the package, so a bare host works and an installed one still pays
    // nothing. What is asserted here instead is that the failure is a clean,
    // diagnostic error rather than a crash — see runEntrypoints.
    { script: 'evals/msbench/stage-graders.ts', args: [] as string[], stagesPackages: true },
    { script: 'evals/msbench/build-config.ts', args: ['photo-app-requirements'] },
    { script: 'evals/msbench/verify-run.ts', args: ['--self-test'] },
    // Doubles as this suite's harvest coverage: the self-test needs no credentials and
    // touches no real seed, so the one place it can run is exactly here.
    { script: 'evals/msbench/harvest-seed.ts', args: ['--self-test'] },
];

const failures: string[] = [];

function fail(message: string): void {
    failures.push(message);
    console.error(`  ✖ ${message}`);
}

/**
 * Collect every file reachable from `entry` through **eager** imports only,
 * rejecting any bare specifier found on the way.
 *
 * `trail` carries the import chain so a failure says how the dependency was
 * reached, which is the difference between a fix and an investigation.
 */
function walkEagerGraph(entry: string, seen: Set<string>, trail: string[], report: (message: string) => void): void {
    if (seen.has(entry)) {
        return;
    }
    seen.add(entry);

    const absolute = join(REPO_ROOT, entry);
    if (!existsSync(absolute)) {
        report(`${entry} does not exist (imported by ${trail.at(-1) ?? '<entrypoint>'})`);
        return;
    }

    for (const reference of findImportReferences(readFileSync(absolute, 'utf8'))) {
        // Dynamic imports run only on the path that opts in; type-only imports are
        // erased before anything runs. Neither can make a clean machine fail, and
        // counting them produced a false failure against `build-config.ts` for
        // importing a *type* from a module that happens to parse YAML.
        if (reference.dynamic || reference.typeOnly || reference.specifier.startsWith('node:')) {
            continue;
        }
        if (!reference.specifier.startsWith('.')) {
            report(
                `${entry} statically imports '${reference.specifier}' from node_modules.\n`
                + `      chain: ${[...trail, entry].join(' -> ')}\n`
                + `      run.sh invokes this on hosts with no node_modules. Defer it behind a dynamic\n`
                + `      import() on the path that needs it, as build-config.ts does for --stack.`,
            );
            continue;
        }
        walkEagerGraph(
            toPosix(relative(REPO_ROOT, resolve(dirname(absolute), reference.specifier))),
            seen,
            [...trail, entry],
            report,
        );
    }
}

function toPosix(value: string): string {
    return value.split(/[\\/]/).join('/');
}

function checkStaticGraphs(): void {
    console.error('Static import graphs');
    for (const { script } of ENTRYPOINTS) {
        const before = failures.length;
        walkEagerGraph(script, new Set(), [], message => fail(message));
        if (failures.length === before) {
            console.error(`  ✔ ${script} — no eagerly imported package dependency`);
        }
    }
}

/**
 * Point the walker at a file that really does import a package, and require it
 * to complain. A walker that silently returns nothing would otherwise report
 * every entrypoint clean forever.
 */
function checkWalkerCanFail(): void {
    console.error('\nNegative control');
    const directory = mkdtempSync(join(tmpdir(), 'clean-machine-'));
    try {
        const file = join(directory, 'offender.ts');
        writeFileSync(file, "import { parse } from 'yaml';\nexport const x = parse;\n");

        const complaints: string[] = [];
        walkEagerGraph(toPosix(relative(REPO_ROOT, file)), new Set(), [], message => complaints.push(message));

        if (complaints.length === 0) {
            fail('the static walker accepted a file that statically imports `yaml`; it cannot fail, so it proves nothing');
        } else {
            console.error('  ✔ a real bare import is rejected, so the walker can fail');
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

/**
 * Run each entrypoint for real with `evals/node_modules` moved aside.
 *
 * The parked directory is restored in a `finally`, and a leftover from a killed
 * run is restored on the next invocation, because a check that can leave a
 * developer's checkout broken will be deleted rather than fixed.
 */
function checkExecutesWithoutDependencies(): void {
    console.error('\nExecuted with evals/node_modules hidden');

    if (!existsSync(NODE_MODULES)) {
        // Nothing installed at all: the executed half is exactly what CI does
        // anyway, so run it directly rather than skipping and reporting green.
        runEntrypoints();
        return;
    }

    renameSync(NODE_MODULES, PARKED);
    try {
        runEntrypoints();
    } finally {
        renameSync(PARKED, NODE_MODULES);
        console.error('  ✔ evals/node_modules restored');
    }
}

function runEntrypoints(): void {
    for (const entry of ENTRYPOINTS) {
        const { script, args } = entry;
        const result = spawnSync(
            process.execPath,
            ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(REPO_ROOT, script), ...args],
            { encoding: 'utf8', cwd: REPO_ROOT },
        );

        // A staging entrypoint may legitimately fail here — it has nothing to copy —
        // but it must fail *legibly*. A clean diagnostic naming the package and the
        // places searched is the difference between "install something" and a stack
        // trace on a host where nobody can tell what went wrong. Anything else,
        // including a crash or a silent exit, is still a failure.
        if ('stagesPackages' in entry && result.status !== 0) {
            const stderr = `${result.stderr ?? ''}`;
            const diagnostic = /is staged for the container but is not installed anywhere/.test(stderr)
                && /Looked in:/.test(stderr);
            if (diagnostic) {
                console.error(`  ✔ ${script} — no package to copy, and says so legibly`);
                continue;
            }
            fail(`${script} failed without a usable diagnostic:\n        ${stderr.trim().split('\n').slice(0, 6).join('\n        ')}`);
            continue;
        }

        if (result.status === 0) {
            console.error(`  ✔ ${script} ${args.join(' ')} — exit 0`);
            continue;
        }
        const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(0, 6).join('\n        ');
        fail(`${script} ${args.join(' ')} exited ${result.status} with no node_modules:\n        ${output}`);
    }
}

function main(): void {
    // Restore a checkout left broken by a previous run that was killed.
    if (existsSync(PARKED) && !existsSync(NODE_MODULES)) {
        renameSync(PARKED, NODE_MODULES);
        console.error('Recovered evals/node_modules parked by an interrupted earlier run.\n');
    }

    checkStaticGraphs();
    checkWalkerCanFail();
    checkExecutesWithoutDependencies();

    console.error('');
    if (failures.length > 0) {
        console.error(`FAIL: ${failures.length} problem(s) above.`);
        process.exit(1);
    }
    console.error(`PASS: ${ENTRYPOINTS.length} entrypoints run on a clean machine.`);
}

main();

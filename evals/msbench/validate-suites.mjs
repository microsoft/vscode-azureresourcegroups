/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Checks the MSBench suite configs without submitting a run.
//
// These files are only ever parsed inside a container after a VSIX build and an
// Azure login, so an ordinary typo is expensive to find: a suite that fails to
// parse looks identical to a suite that failed the eval. This catches the class
// of mistake that has actually happened rather than validating the whole schema:
//
//   - YAML that does not parse. An unquoted `exec: grep -q '**Status**: Planning'`
//     parses as a nested mapping and takes the whole run down.
//   - A `files` table query while `snapshotWorkspace` is off. MSBench fails the
//     run fast in that case, and the scaffold suites must keep snapshotting off.
//   - Negative assertions with no liveness sentinel. `COUNT(*) = 0` is trivially
//     true against an empty table, so a run that dies before the session database
//     is written scores partial credit instead of failing.
//   - A suite in `suites/` that `stage.mjs` cannot stage, or vice versa.
//   - A grader referenced by an `exec` assertion that stage.mjs does not bundle.

import { readdirSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename, resolve } from 'path';
import { parse as parseYaml } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const suitesDir = join(here, 'suites');
const gradersDir = join(here, '..', 'graders');

const problems = [];
const note = (file, msg) => problems.push(`${file}: ${msg}`);

const { SUITES } = await import('./stage.mjs');

const configs = new Map();
const loadConfig = (label, file) => {
    if (configs.has(label) || !existsSync(file)) {
        return;
    }
    try {
        configs.set(label, parseYaml(readFileSync(file, 'utf8')));
    } catch (err) {
        note(label, `does not parse as YAML -- ${err.message.split('\n')[0]}`);
        configs.set(label, undefined);
    }
};

// Check the union: every file in suites/, plus whatever SUITES points at. The
// default suite's config lives in assets/, so neither source covers both.
for (const entry of readdirSync(suitesDir).filter((f) => f.endsWith('.yaml'))) {
    loadConfig(entry, join(suitesDir, entry));
}
for (const suite of Object.values(SUITES)) {
    loadConfig(basename(suite.config), resolve(here, suite.config));
}

// Every suite config should be reachable through stage.mjs, and every suite
// stage.mjs offers should have a config. Either half alone is a dead end.
const staged = new Set(Object.values(SUITES).map((s) => basename(s.config)));
for (const entry of configs.keys()) {
    if (!staged.has(entry)) {
        note(entry, 'is not referenced by any suite in stage.mjs SUITES, so it can never be staged');
    }
}
for (const [name, suite] of Object.entries(SUITES)) {
    // stage.mjs stores absolute paths; resolve leaves those alone.
    if (!existsSync(resolve(here, suite.config))) {
        note(name, `stage.mjs points at ${suite.config}, which does not exist`);
    }
}

for (const [entry, config] of configs) {
    if (!config || typeof config !== 'object') {
        note(entry, 'is empty or is not a mapping');
        continue;
    }

    const steps = config.promptSteps ?? [];
    if (steps.length === 0) {
        note(entry, 'has no promptSteps, so the agent would never be prompted');
    }

    const assertions = steps.flatMap((step) => step.assertions ?? []);
    if (assertions.length === 0) {
        note(entry, 'has no assertions, so it can never fail');
    }

    // A `COUNT(*) = 0` assertion cannot distinguish "the agent did not do this"
    // from "nothing was recorded at all", so a suite that relies on them needs at
    // least one positive query proving the session database was populated.
    const negatives = assertions.filter((a) => a.query && /count\(\s*\*\s*\)\s*=\s*0/i.test(a.query));
    const hasSentinel = assertions.some((a) => a.query && /count\(\s*\*\s*\)\s*>\s*0/i.test(a.query));
    if (negatives.length > 0 && !hasSentinel) {
        note(entry, `has ${negatives.length} 'COUNT(*) = 0' assertion(s) but no positive liveness assertion; `
            + 'an aborted run would leave the tables empty and score partial credit');
    }

    for (const assertion of assertions) {
        if (!assertion.comment) {
            note(entry, 'has an assertion with no comment; failures would be unattributable');
        }

        // Snapshotting is what populates the `files` table. With it off the run
        // fails fast, so the two settings have to agree.
        if (config.snapshotWorkspace === false && assertion.query && /\bfrom\s+files\b/i.test(assertion.query)) {
            note(entry, `queries the files table while snapshotWorkspace is false -- ${assertion.comment}`);
        }

        // An exec assertion naming a grader only works if stage.mjs bundles it.
        const grader = assertion.exec?.match(/\/agent\/assets\/graders\/(validate-[\w-]+)\.mjs/)?.[1];
        if (grader && !existsSync(join(gradersDir, `${grader}.ts`))) {
            note(entry, `runs ${grader}.mjs, but evals/graders/${grader}.ts does not exist`);
        }
    }
}

if (problems.length > 0) {
    console.error(`MSBench suite validation failed (${problems.length} problem(s)):\n`);
    for (const problem of problems) {
        console.error(`  - ${problem}`);
    }
    process.exit(1);
}

console.log(`MSBench suite validation passed: ${configs.size} config(s) checked.`);

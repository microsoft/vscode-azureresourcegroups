#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Decide whether a finished MSBench run's assertions actually *passed*, and make
 * that the process exit code.
 *
 * This exists because a run whose assertions failed was reporting green. Run
 * 2026082668713928 finished with 4 assertions passing and 2 failing, and:
 *
 *   msbench-cli exit   0
 *   run.sh exit        0
 *   GitHub eval job    success
 *
 * Nothing downstream contradicted any of that. A red run reporting green is the
 * worst direction for this failure to point, because nobody investigates green —
 * the same asymmetry that decided the NOT_APPLICABLE exit-code ruling.
 *
 * WHY THIS IS NOT PART OF verify-run.ts
 *
 * `verify-run.ts` answers a different question — *is this run a result at all*,
 * i.e. was the agent throttled (75) or did a different model answer (65). Its
 * header is explicit that "a genuinely red run must keep reporting as a red run,
 * because a detector for false reds is worthless if it also hides true ones". It
 * did its job on that run: the run WAS a result. It just happened to be a failing
 * one, and nothing was asking that question.
 *
 * Folding "did it pass" into it would blur the distinction that makes 75 and 65
 * meaningful. Two questions, two scripts, two exit codes.
 *
 * THE SHAPE OF eval.json, WHICH IS ITSELF A TRAP
 *
 *   { "<instance>": { "resolved": false, "details": [ { comment, query, passed, error } ] } }
 *
 * `resolved` is nested PER INSTANCE. Reading it at the top level yields
 * `undefined`, which is falsy, which an incautious check would report as "not
 * resolved" for the right answer by the wrong route — or, worse, a check written
 * the other way round would see no `passed: false` at the top level and report a
 * pass. This script reads the instance objects, and fails loudly when it cannot
 * find any rather than treating an unreadable report as a pass.
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface AssertionDetail {
    readonly comment?: string;
    readonly query?: string;
    readonly exec?: string;
    readonly passed?: boolean;
    readonly error?: string | null;
}

interface InstanceResult {
    readonly resolved?: boolean;
    readonly details?: AssertionDetail[];
}

/** `0` all assertions passed. `1` a genuine red run. `70` the report could not be read. */
const EXIT_OK = 0;
const EXIT_RED = 1;
const EXIT_UNREADABLE = 70; // EX_SOFTWARE

function findEvalJson(root: string): string | undefined {
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop()!;
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = join(dir, entry);
            let isDirectory: boolean;
            try {
                isDirectory = statSync(full).isDirectory();
            } catch {
                continue;
            }
            if (isDirectory) {
                stack.push(full);
            } else if (entry === 'eval.json') {
                return full;
            }
        }
    }
    return undefined;
}

function main(): void {
    const root = process.argv[2];
    if (!root || !existsSync(root)) {
        console.error(`check-assertions.ts: no such directory: ${root ?? '(none given)'}`);
        process.exit(EXIT_UNREADABLE);
    }

    const path = findEvalJson(root);
    if (!path) {
        // Deliberately not a pass. An unreadable report is the same epistemic
        // position as an unrun check, and this whole script exists because that
        // position was being reported as green.
        console.error(
            `check-assertions.ts: no eval.json under ${root}.\n` +
            `Cannot tell whether the assertions passed, so this is NOT reported as a pass.`
        );
        process.exit(EXIT_UNREADABLE);
    }

    let report: Record<string, InstanceResult>;
    try {
        report = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
        console.error(`check-assertions.ts: ${path} is not readable JSON: ${(err as Error).message}`);
        process.exit(EXIT_UNREADABLE);
    }

    const instances = Object.entries(report).filter(([, value]) => value && typeof value === 'object');
    if (instances.length === 0) {
        console.error(`check-assertions.ts: ${path} contains no instances.`);
        process.exit(EXIT_UNREADABLE);
    }

    const failures: string[] = [];
    let total = 0;

    for (const [name, instance] of instances) {
        const details = instance.details ?? [];
        total += details.length;

        for (const detail of details) {
            if (detail.passed !== true) {
                const label = detail.comment ?? detail.query ?? detail.exec ?? '(unnamed assertion)';
                failures.push(`  ${name}: ${label}${detail.error ? ` [${detail.error}]` : ''}`);
            }
        }

        // `resolved` is checked as well as the details, not instead of them. They
        // are computed from the same data, so they should never disagree — and if
        // they ever do, that disagreement is itself worth failing on rather than
        // silently trusting whichever one this script happened to read.
        if (instance.resolved !== true) {
            const anyDetailFailed = details.some(d => d.passed !== true);
            if (!anyDetailFailed) {
                failures.push(
                    `  ${name}: resolved is ${JSON.stringify(instance.resolved)} while every assertion passed — ` +
                    `report is internally inconsistent`
                );
            }
        }
    }

    if (failures.length > 0) {
        console.error(
            `\n${failures.length} of ${total} assertion(s) FAILED:\n${failures.join('\n')}\n\n` +
            `This run is a genuine red. It is reported as a failure so it cannot be read as a\n` +
            `pass — an MSBench job that succeeds only tells you the job ran, not that the\n` +
            `assertions held. Read the transcript before concluding it is a product\n` +
            `regression: see README.md, "Is this run a result?".`
        );
        process.exit(EXIT_RED);
    }

    console.log(`✔ all ${total} assertion(s) passed across ${instances.length} instance(s).`);
    process.exit(EXIT_OK);
}

main();

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Audits the evaluation instrument rather than the product.
 *
 * A gate that has never once passed is far more likely to be broken than the product is to be
 * uniformly incapable of exactly that one thing. The `worker` gate recorded 16 failures and zero
 * passes across every run ever executed before anyone noticed that the storage probe signed its
 * Azurite requests with a corrupted account key — Azurite answered 403 to every request, so no
 * generated app could have passed regardless of quality. Ten percent of the corpus was being
 * charged for a harness defect.
 *
 * Three signals matter, and each maps to a distinct instrument failure:
 *   never-passed  — the gate may be impossible to satisfy (broken probe, wrong credential, bad fixture)
 *   never-failed  — the gate may be vacuous; it has never discriminated between good and bad output
 *   always-n/a    — the gate is dead weight; no scenario has ever exercised it
 *
 * None of these are proof of a defect. All of them are reasons to go look before quoting a score.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

interface GateTally {
    passed: number;
    /** Failures where the gate actually ran and rendered a verdict. */
    failed: number;
    /** "Failures" that are really upstream cascade — the gate never executed. */
    notAttempted: number;
    notApplicable: number;
    runs: Set<string>;
    exampleFailure?: string;
}

type Verdict = 'never-passed' | 'never-failed' | 'always-not-applicable' | 'never-attempted' | 'healthy';

/**
 * A cascade failure means an upstream gate stopped the run before this gate executed. The executor
 * records it with status `failed`, which is misleading: the gate rendered no verdict at all. Rolled
 * into a pass rate it manufactures failures the product never earned, so it is tallied separately.
 */
function isCascade(reason: string): boolean {
    return /Not attempted because|stopped dependent validation/u.test(reason);
}

const RESULTS_ROOT = join(__dirname, '..', 'results');

function collectValidationFiles(root: string): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
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
                walk(full);
            } else if (entry === 'cor-validation.json') {
                found.push(full);
            }
        }
    };
    walk(root);
    return found;
}

function classify(tally: GateTally): Verdict {
    if (tally.passed === 0 && tally.failed === 0 && tally.notAttempted === 0) {
        return 'always-not-applicable';
    }
    // Distinguish "ran and never succeeded" from "never got the chance to run". The first
    // indicts the gate; the second indicts everything upstream of it.
    if (tally.passed === 0 && tally.failed === 0) {
        return 'never-attempted';
    }
    if (tally.passed === 0) {
        return 'never-passed';
    }
    if (tally.failed === 0) {
        return 'never-failed';
    }
    return 'healthy';
}

export function analyzeGateHealth(root: string = RESULTS_ROOT, onlyRuns?: Set<string>): Map<string, GateTally> {
    const tallies = new Map<string, GateTally>();
    for (const file of collectValidationFiles(root)) {
        if (onlyRuns && !onlyRuns.has(relative(root, file).split(sep)[1] ?? '')) {
            continue;
        }
        let parsed: { gates?: Record<string, { status?: string; reason?: string; evidence?: string[] }> };
        try {
            parsed = JSON.parse(readFileSync(file, 'utf8')) as typeof parsed;
        } catch {
            continue;
        }
        const runName = relative(root, file).split(sep)[1] ?? 'unknown';
        for (const [gate, node] of Object.entries(parsed.gates ?? {})) {
            let tally = tallies.get(gate);
            if (!tally) {
                tally = { passed: 0, failed: 0, notAttempted: 0, notApplicable: 0, runs: new Set() };
                tallies.set(gate, tally);
            }
            tally.runs.add(runName);
            if (node.status === 'passed') {
                tally.passed++;
            } else if (node.status === 'failed') {
                // Result schemas have drifted: older runs carry the explanation in `evidence`
                // with no `reason` at all. Reading only `reason` misclassified those as real
                // verdicts when several were upstream cascade.
                const reason = [node.reason ?? '', ...(node.evidence ?? [])].join(' ').trim();
                if (isCascade(reason)) {
                    tally.notAttempted++;
                } else {
                    tally.failed++;
                    tally.exampleFailure ??= reason.split('\n')[0].slice(0, 120);
                }
            } else {
                tally.notApplicable++;
            }
        }
    }
    return tallies;
}

function main(): void {
    // Gate implementations change. A gate that never passed in a run predating its current
    // implementation says nothing about the gate today, so allow scoping to named runs.
    const runArgs = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
    const onlyRuns = runArgs.length > 0 ? new Set(runArgs) : undefined;
    if (onlyRuns) {
        console.log(`Scoped to run(s): ${[...onlyRuns].join(', ')}`);
    }
    const tallies = analyzeGateHealth(RESULTS_ROOT, onlyRuns);
    if (tallies.size === 0) {
        console.log('No cor-validation.json results found; nothing to audit.');
        return;
    }

    const rows = [...tallies.entries()].map(([gate, tally]) => ({ gate, tally, verdict: classify(tally) }));
    const width = Math.max(...rows.map(r => r.gate.length)) + 2;

    console.log('\nGate health — auditing the instrument, not the product\n');
    console.log(`${'GATE'.padEnd(width)}${'pass'.padStart(6)}${'fail'.padStart(6)}${'cascade'.padStart(9)}${'n/a'.padStart(6)}${'runs'.padStart(6)}  VERDICT`);
    for (const { gate, tally, verdict } of rows.sort((a, b) => a.gate.localeCompare(b.gate))) {
        console.log(
            `${gate.padEnd(width)}${String(tally.passed).padStart(6)}${String(tally.failed).padStart(6)}` +
            `${String(tally.notAttempted).padStart(9)}${String(tally.notApplicable).padStart(6)}` +
            `${String(tally.runs.size).padStart(6)}  ${verdict}`,
        );
    }

    const suspect = rows.filter(r => r.verdict === 'never-passed');
    const vacuous = rows.filter(r => r.verdict === 'never-failed');
    const dead = rows.filter(r => r.verdict === 'always-not-applicable');
    const starved = rows.filter(r => r.verdict === 'never-attempted');

    if (suspect.length > 0) {
        console.log('\nNEVER PASSED — investigate the gate before trusting any score that includes it:');
        for (const { gate, tally } of suspect) {
            console.log(`  ${gate}: ${tally.failed} failures, 0 passes across ${tally.runs.size} run(s)`);
            if (tally.exampleFailure) {
                console.log(`    e.g. ${tally.exampleFailure}`);
            }
        }
    }
    if (vacuous.length > 0) {
        console.log('\nNEVER FAILED — has never discriminated; it may not be measuring anything:');
        for (const { gate, tally } of vacuous) {
            console.log(`  ${gate}: ${tally.passed} passes, 0 failures`);
        }
    }
    if (dead.length > 0) {
        console.log('\nALWAYS NOT-APPLICABLE — no scenario has ever exercised this gate:');
        for (const { gate } of dead) {
            console.log(`  ${gate}`);
        }
    }

    if (starved.length > 0) {
        console.log('\nNEVER ATTEMPTED — always blocked by an upstream gate, so it has produced no signal:');
        for (const { gate, tally } of starved) {
            console.log(`  ${gate}: ${tally.notAttempted} cascade block(s), 0 real verdicts`);
        }
    }

    if (suspect.length > 0) {
        console.log(`\nFAIL: ${suspect.length} gate(s) ran and never once passed.`);
        process.exitCode = 1;
        return;
    }
    console.log('\nOK: every gate has both passed and failed at least once.');
}

if (require.main === module) {
    main();
}

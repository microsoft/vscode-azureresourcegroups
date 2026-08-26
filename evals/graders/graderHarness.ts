/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared plumbing for the eval graders.
 *
 * Every grader is a thin adapter: read the artifact, hand it to the validator in
 * `evals/src/artifacts`, map the returned issues to an exit code. The validators
 * are the same code `graderCertification` certifies, so the certified path and
 * the executed path cannot drift.
 *
 * Exit codes are the contract with whatever invokes a grader — `exec:` assertions
 * in the MSBench config, and `program` graders in the Vally specs:
 *   0 — the artifact satisfies the contract
 *   1 — the product produced a bad artifact (a real, reportable failure)
 *   3 — the grader itself could not run (harness fault, never blamed on the agent)
 */

import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { ArtifactValidationIssue } from '../src/artifacts/validationTypes.ts';

export const EXIT_PASS = 0;
export const EXIT_PRODUCT_FAILURE = 1;
export const EXIT_GRADER_ERROR = 3;

/**
 * A gate that has no opinion about this workspace exits **3**, and says why on stderr.
 *
 * The earlier design exited 0 on the grounds that the marker below made the verdict
 * detectable. It is detectable — but detection is not correction. MSBench writes
 * `exitCode = 0` as `passed: true`, `resolved` is computed from it, and the run-analysis
 * site and the Kusto `resolved` rate publish that number. A separate report saying "not
 * applicable" cannot correct a headline that says green, because nobody investigates green.
 *
 * So the choice is between two kinds of wrong: exit 3 makes the raw score **pessimistic and
 * recoverable** — a red run carrying a `NOT_APPLICABLE` marker is explainable in seconds —
 * while exit 0 makes it **optimistic and unrecoverable**. A permanently-green gate is the
 * vacuous-gate failure wearing a new hat, and an inflated green is permanent and invisible.
 *
 * The objection that exit 3 makes a gate costly to wire broadly is real but points the other
 * way: applicability is a *wiring-time* decision, declared in `stacks/<id>.yaml`, not
 * something a runtime verdict should be used to paper over.
 *
 * Which makes the marker more load-bearing, not less: red is now the not-applicable path, so
 * the marker is what turns a red from "mysterious failure" into "known gap, here is the fix".
 */
export const NOT_APPLICABLE_EXIT_CODE = EXIT_GRADER_ERROR;

/**
 * What kind of gap a not-applicable verdict describes. `class=` answers exactly one
 * question — **is this gate dead weight, or a hole worth closing?** — because that is the
 * question that changes what someone does about it. The test for a new reason code is: does
 * this get fixed by *unwiring the gate*, or by *closing a hole*?
 *
 * - `outOfScope` — the scenario has nothing for this gate to test. Under exit 3 an
 *   `outOfScope` red is a complaint about the **wiring**: this gate should not be attached
 *   to this stack, and the fix is in configuration. This must stay reachable — a gate that
 *   is out of scope on every stack we run should be deleted, and saying so is half the point
 *   of measuring gate health at all.
 * - `coverageGap` — the gate applies here and could not run. A `coverageGap` red is a true
 *   statement that we are not testing something we claim to test, and is *correct* to stay
 *   red until it is fixed.
 *
 * `coverageGap` deliberately does not say *who* closes the gap. Its predecessor was called
 * `environmentGap`, which implied the machine was at fault; for a missing analyser the fix
 * is unwritten code in this repository, so whoever triaged the red would go inspect the
 * container, find nothing wrong, and conclude the marker was broken. A name that sends the
 * reader to the wrong place suppresses its own investigation. The owner — install a binary
 * versus write an analyser — is a difference of backlog, and `reason=` already carries it as
 * a closed, groupable vocabulary.
 *
 * Note what is deliberately absent: "we tried and it did not work" is neither of these. That
 * is a product failure and must exit 1. A reason code that quietly means "the thing was
 * supposed to work and did not" makes a real bug self-suppressing, and files it under "no
 * scenario ever exercised this" — which is the most expensive way to lose a defect.
 */
export type NotApplicableClass = 'outOfScope' | 'coverageGap';

/** Raised for a bad artifact — anything else thrown is treated as a harness fault. */
export class ProductFailure extends Error { }

/**
 * The stable identity of the running gate, used as `gate=` on every verdict line.
 *
 * Derived from the grader's filename (`validate-service-fidelity.ts` → `service-fidelity`)
 * rather than from its prose description, because the description is editorial: reword it
 * and the gate silently becomes a *different* gate to anything aggregating history, which
 * has already been observed splitting one real gate's record into two partial ones. A
 * filename is renamed deliberately and rarely, and it already matches the validator id in
 * `grader-certification/manifest.json` — so the same token joins run rows to certification
 * results without anyone maintaining a mapping.
 */
export function gateId(): string {
    const entry = process.argv[1];
    return entry ? basename(entry).replace(/\.ts$/, '').replace(/^validate-/, '') : 'unknown';
}

/**
 * The directory being graded. Vally runs a grader with its cwd already set to the
 * workspace, so cwd is a legitimate fallback — but when someone runs a grader by hand
 * and forgets `EVALUATE_WORKSPACE`, that fallback silently grades the wrong tree.
 * `describeWorkspaceSource` exists so the failure says which one was used.
 */
export function workspacePath(relativePath: string): string {
    return resolve(process.env.EVALUATE_WORKSPACE || process.cwd(), relativePath);
}

function describeWorkspaceSource(): string {
    return process.env.EVALUATE_WORKSPACE
        ? 'workspace from EVALUATE_WORKSPACE'
        : 'workspace defaulted to the current directory because EVALUATE_WORKSPACE is not set';
}

/** Read an artifact the agent was contracted to produce; a missing file is a product failure. */
export function readArtifact(relativePath: string): string {
    const absolute = workspacePath(relativePath);
    try {
        return readFileSync(absolute, 'utf8');
    } catch {
        throw new ProductFailure(`${absolute} does not exist (${describeWorkspaceSource()})`);
    }
}

export function fail(message: string): never {
    throw new ProductFailure(message);
}

export function failWithIssues(summary: string, issues: ArtifactValidationIssue[]): never {
    throw new ProductFailure(`${summary}\n${issues.map(i => `  • [${i.code}] ${i.path}: ${i.message}`).join('\n')}`);
}

/** Thrown to end a grader with a not-applicable verdict; see `NOT_APPLICABLE_EXIT_CODE`. */
export class NotApplicable extends Error {
    readonly gate: string;
    readonly classification: NotApplicableClass;
    readonly reason: string;
    readonly detail: string;

    constructor(gate: string, classification: NotApplicableClass, reason: string, detail: string) {
        super(detail);
        this.gate = gate;
        this.classification = classification;
        this.reason = reason;
        this.detail = detail;
    }
}

/**
 * End the grader with a not-applicable verdict.
 *
 * `classification` is a required argument rather than something looked up from a shared
 * table, so a new reason code cannot be introduced without deciding what should be done
 * about it — and so that each family of gates owns its own reason vocabulary instead of the
 * several sessions adding codes all editing one registry line.
 */
export function skipAsNotApplicable(
    gate: string,
    classification: NotApplicableClass,
    reason: string,
    detail: string,
): never {
    throw new NotApplicable(gate, classification, reason, detail);
}

/**
 * Run a grader body, mapping its outcome onto the exit-code contract above.
 * An unexpected throw (TypeError, ReferenceError, …) exits 3 rather than 1 so a
 * broken grader is never reported as a product regression.
 *
 * Synchronous only, deliberately. An `async` body passed here would return a
 * promise that is never awaited, so PASS would print — and the process exit 0 —
 * before a single check had run. Graders that must touch the filesystem use
 * `runGraderAsync` instead.
 */
export function runGrader(name: string, body: () => void): void {
    try {
        body();
    } catch (error) {
        exitForError(name, error);
    }
    console.error(`PASS: gate=${gateId()} — ${name}`);
    process.exit(EXIT_PASS);
}

/**
 * Same contract as `runGrader`, for graders that must inspect the workspace on disk
 * and therefore await filesystem reads.
 */
export async function runGraderAsync(name: string, body: () => Promise<void>): Promise<void> {
    try {
        await body();
    } catch (error) {
        exitForError(name, error);
    }
    console.error(`PASS: gate=${gateId()} — ${name}`);
    process.exit(EXIT_PASS);
}

function exitForError(name: string, error: unknown): never {
    const gate = gateId();
    if (error instanceof NotApplicable) {
        // `detail` is JSON-encoded rather than quote-substituted so the field survives a
        // parser: JSON.stringify supplies the surrounding quotes and escapes embedded quotes
        // and newlines, where rewriting `"` to `'` silently corrupts any detail that contains
        // one — and details legitimately carry shell commands. "This field is never parsed"
        // is true right up until someone writes the reader, which is happening now.
        console.error(`NOT_APPLICABLE gate=${error.gate} class=${error.classification} reason=${error.reason} detail=${JSON.stringify(error.detail)}`);
        console.error(`SKIP: gate=${error.gate} — ${name} did not apply here.`);
        console.error(error.classification === 'coverageGap'
            ? '  This gate applies here but could not run, so we are not testing something we claim to test. This is a gap to close, not a gate to unwire.'
            : '  This project has nothing for this gate to test, which is a question about how the gate is wired.');
        // Under exit 3 a human reads this on a red run, and the expensive mistake is
        // concluding the red says something about the agent's output. It says nothing.
        console.error('  Nothing here is evidence about the generated app.');
        process.exit(NOT_APPLICABLE_EXIT_CODE);
    }
    if (error instanceof ProductFailure) {
        console.error(`FAIL: gate=${gate} — ${name} — ${error.message}`);
        process.exit(EXIT_PRODUCT_FAILURE);
    }
    console.error(`GRADER ERROR: gate=${gate} — ${name} threw ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(EXIT_GRADER_ERROR);
}

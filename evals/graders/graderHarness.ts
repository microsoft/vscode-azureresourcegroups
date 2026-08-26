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
 * A gate that has no opinion about this workspace exits **0**, not 3.
 *
 * Exit 3 means "do not trust this result — the harness broke". A not-applicable verdict is
 * the opposite: the gate ran, understood the input, and confidently concluded the property
 * it grades is absent here. Collapsing the two would spend the only signal that isolates
 * harness faults on cases that are working correctly, and would turn every gate red on
 * every stack it does not yet cover — which makes the rational move "wire each gate only
 * where it definitely applies", defeating the point of having a not-applicable path at all.
 *
 * The safety mechanism is therefore NOT the exit code, it is `NOT_APPLICABLE:` on stderr.
 * A gate that returns not-applicable *without* emitting the marker is worse than either
 * exit code, because it is then genuinely undetectable — it reports a pass forever and
 * nobody investigates a passing gate. Emitting the marker is part of every gate's contract.
 */
export const NOT_APPLICABLE_EXIT_CODE = EXIT_PASS;

/**
 * Why a not-applicable verdict happened, in the only distinction that changes what someone
 * should *do* about it:
 *
 * - `outOfScope` — the subject genuinely lacks the property being graded (a backend-only
 *   project has no frontend to check). A gate that is always `outOfScope` is dead weight:
 *   delete it or re-target it.
 * - `notAttempted` — the gate wanted to run and could not (missing tool, unstaged tree,
 *   analyser not written yet). A gate that is always `notAttempted` is a **coverage hole**,
 *   not dead weight: fix the environment or implement the analyser. Deleting it would be
 *   exactly the wrong response.
 *
 * The two demand opposite remedies, so a reason code that lands in the wrong bucket sends
 * whoever reads the health report in the wrong direction.
 */
export type NotApplicableClass = 'outOfScope' | 'notAttempted';

/**
 * Every reason code, with its class.
 *
 * A registry rather than a free string because a reason code must not be able to *default*
 * into a bucket: `emitNotApplicable` rejects an unregistered code, so classifying a new
 * reason is a required step rather than something you can forget. It is a plain object
 * rather than a union type deliberately — adding a member is a new line, which merges
 * cleanly across the several sessions adding codes, where a one-line union would conflict.
 */
export const NOT_APPLICABLE_REASONS: Record<string, NotApplicableClass> = {
    /** The tree has manifests, but only for an ecosystem no analyser covers yet. */
    ecosystemNotSupported: 'notAttempted',
    /**
     * No project manifest of any recognised ecosystem anywhere in the tree.
     *
     * For a gate that has *not* already read an artifact out of the same workspace, this most
     * likely means the tree was never staged, which is a harness fault. A gate that reached
     * this point after successfully reading, say, `.azure/project-plan.md` from that same
     * workspace knows the tree is staged, so for it the same observation means the agent
     * shipped nothing — a product failure, and it should say so rather than use this code.
     */
    noProjectManifestFound: 'notAttempted',
};

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
    readonly reason: string;
    readonly detail: string;
    /** Extra structured `key=value` pairs, e.g. `{ ecosystem: 'go' }`. Never prose. */
    readonly facts: Record<string, string>;

    constructor(reason: string, detail: string, facts: Record<string, string> = {}) {
        super(detail);
        this.reason = reason;
        this.detail = detail;
        this.facts = facts;
    }
}

/**
 * End the grader with a not-applicable verdict.
 *
 * `reason` must be registered in `NOT_APPLICABLE_REASONS`; an unregistered code throws,
 * which surfaces as a grader error rather than being quietly emitted with a guessed class.
 */
export function notApplicable(reason: string, detail: string, facts: Record<string, string> = {}): never {
    throw new NotApplicable(reason, detail, facts);
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
        const classification = NOT_APPLICABLE_REASONS[error.reason];
        if (!classification) {
            console.error(`GRADER ERROR: gate=${gate} — ${name} reported unregistered not-applicable reason "${error.reason}"`);
            process.exit(EXIT_GRADER_ERROR);
        }
        const facts = Object.entries(error.facts).map(([key, value]) => ` ${key}=${value}`).join('');
        console.error(`NOT_APPLICABLE: gate=${gate} reason=${error.reason} class=${classification}${facts} detail="${error.detail.replace(/"/g, "'")}"`);
        process.exit(NOT_APPLICABLE_EXIT_CODE);
    }
    if (error instanceof ProductFailure) {
        console.error(`FAIL: gate=${gate} — ${name} — ${error.message}`);
        process.exit(EXIT_PRODUCT_FAILURE);
    }
    console.error(`GRADER ERROR: gate=${gate} — ${name} threw ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(EXIT_GRADER_ERROR);
}

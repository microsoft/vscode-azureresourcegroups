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
 * Exit codes are a contract with `generate-report.cjs`:
 *   0 — the artifact satisfies the contract
 *   1 — the product produced a bad artifact (a real, reportable failure)
 *   3 — the grader itself could not run (harness fault, never blamed on the agent)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ArtifactValidationIssue } from '../src/artifacts/validationTypes.ts';

export const EXIT_PASS = 0;
export const EXIT_PRODUCT_FAILURE = 1;
export const EXIT_GRADER_ERROR = 3;

/** Raised for a bad artifact — anything else thrown is treated as a harness fault. */
export class ProductFailure extends Error { }

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

/**
 * Run a grader body, mapping its outcome onto the exit-code contract above.
 * An unexpected throw (TypeError, ReferenceError, …) exits 3 rather than 1 so a
 * broken grader is never reported as a product regression.
 */
export function runGrader(name: string, body: () => void): void {
    try {
        body();
    } catch (error) {
        exitForError(name, error);
    }
    console.error(`PASS: ${name}`);
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
    console.error(`PASS: ${name}`);
    process.exit(EXIT_PASS);
}

function exitForError(name: string, error: unknown): never {
    if (error instanceof ProductFailure) {
        console.error(`FAIL: ${name} — ${error.message}`);
        process.exit(EXIT_PRODUCT_FAILURE);
    }
    console.error(`GRADER ERROR: ${name} threw ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(EXIT_GRADER_ERROR);
}

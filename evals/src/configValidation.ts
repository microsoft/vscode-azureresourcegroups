/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The rejection contract shared by the stack schema and the container inventory.
 *
 * `src/scenario.ts` is the precedent for hand-written validation here, and this
 * follows it in every respect but one: a rejection carries a **stable `code`**
 * alongside its prose.
 *
 * That is not decoration. The house rule is that a check is not done until a
 * deliberately broken fixture makes it fail, and a fixture asserting only "it
 * threw" is satisfied by a validator that throws for the wrong reason — a typo
 * in the validator that rejects every file would pass such a test suite
 * completely. `npm run stacks:check` asserts the *code*, so each fixture proves
 * the specific rule it was written for, and a rule that stops working is a red
 * naming itself rather than a silence.
 *
 * The prose still matters, and is written for the person who hits it: it says
 * what to do, not merely what is wrong. A validator that only says "invalid"
 * has moved the investigation rather than removed it.
 */

/** A configuration file was rejected. `code` is the stable identity of the rule. */
export class ConfigValidationError extends Error {
    readonly code: string;
    readonly file: string;

    constructor(code: string, file: string, message: string) {
        super(`[${code}] ${file}: ${message}`);
        this.name = 'ConfigValidationError';
        this.code = code;
        this.file = file;
    }
}

export function reject(code: string, file: string, message: string): never {
    throw new ConfigValidationError(code, file, message);
}

/** Narrow an unknown parsed YAML document to a plain object, or reject. */
export function requireObject(value: unknown, code: string, file: string, what: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        reject(code, file, `${what} must be a YAML mapping.`);
    }
    return value as Record<string, unknown>;
}

export function requireString(value: unknown, code: string, file: string, what: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        reject(code, file, `${what} must be a non-empty string.`);
    }
    return value;
}

/**
 * Reject any key the schema does not define.
 *
 * Deliberately strict, and the reason is specific to this suite: an unrecognised
 * key is almost always a typo, and a typo in a *permissive* schema is silent —
 * `frontent: none` would leave `frontend` at its default and quietly change
 * which gates are wired. That failure is invisible in review and expensive in a
 * paid run, so it is spelled as an error while it still costs nothing.
 */
export function rejectUnknownKeys(
    object: Record<string, unknown>,
    known: readonly string[],
    code: string,
    file: string,
    what: string,
): void {
    const unknown = Object.keys(object).filter(key => !known.includes(key));
    if (unknown.length > 0) {
        reject(
            code,
            file,
            `${what} has ${unknown.length === 1 ? 'an unrecognised key' : 'unrecognised keys'}: ${unknown.join(', ')}. `
            + `Known keys are: ${[...known].sort().join(', ')}. An unrecognised key is usually a typo, and a typo that `
            + `is tolerated here changes which gates are wired without saying so.`,
        );
    }
}

export function requireEnum<T extends string>(
    value: unknown,
    allowed: readonly T[],
    code: string,
    file: string,
    what: string,
): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        reject(code, file, `${what} must be one of: ${allowed.join(', ')}. Found: ${JSON.stringify(value)}.`);
    }
    return value as T;
}

#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Fail if two assertions that do the same thing describe themselves differently.
 *
 * ── Why comment text is load-bearing, which is genuinely surprising ───────────
 *
 * A `program` grader has a filename, so trend analysis across runs keys on
 * `validate-no-scaffold.ts` and survives any amount of rewording. A **SQL
 * assertion has no such handle**: `comment` is the only stable identifier it
 * carries into stored results. So for SQL assertions — and only for them — the
 * comment string is an identifier, not documentation.
 *
 * That is the opposite of the normal rule, which is why it broke. A comment is
 * the one place where rephrasing is expected to be harmless, so anyone adding a
 * stimulus will reword one to fit their case and nothing objects. The result is
 * silent: the assertion still runs, still passes, still reports — it has simply
 * become a *different gate* with no history, while the original appears to have
 * stopped being evaluated. Neither shows up as an error anywhere, and it cannot
 * be repaired afterwards, because runs are stored with the strings they had.
 *
 * ── Why this groups by query instead of checking a list of known gates ───────
 *
 * The first version of this file carried a hand-written rule per known gate. It
 * passed clean, and it was still wrong: it did not know about the
 * `open_plan_view` gate, which had already forked into two wordings. A checker
 * that only knows the gates someone remembered to teach it is exactly as
 * reliable as remembering — and not relying on memory is the entire point.
 *
 * So the rule is mechanical and needs no list. **Two assertions with the same
 * normalised query are the same gate** — not a heuristic, but what "gate" means
 * here — and must therefore carry the same comment. A newly duplicated gate is
 * covered the moment it is duplicated, without anyone updating this file.
 *
 * The one pinned string is the liveness sentinel, because it is the gate whose
 * uniformity matters most, and grouping alone would let all sixteen copies drift
 * together.
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { SENTINEL_COMMENT, SENTINEL_QUERY, TURN_SUFFIX } from './assertionIdentity.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const STIMULI = join(HERE, 'config', 'stimuli');
const STACKS = join(HERE, 'config', 'stacks');

interface Assertion {
    comment?: string;
    query?: string;
    exec?: string;
}

interface Occurrence {
    readonly file: string;
    readonly comment: string;
}

function assertionsOf(document: unknown): Assertion[] {
    const doc = document as { promptSteps?: { assertions?: Assertion[] }[]; preConditions?: Assertion[] };
    return [
        ...(doc.preConditions ?? []),
        ...(doc.promptSteps ?? []).flatMap(step => step.assertions ?? []),
    ];
}

/** Whitespace and case are formatting; they must not be able to create a second gate. */
function normalise(text: string): string {
    return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The generated stimuli cannot be parsed the way the hand-written ones are.
 *
 * `build-config.ts` writes its output to `assets/user-overrides.yaml`, which is
 * shared mutable state that `run.sh` holds a lock on for the duration of a run.
 * A checker that invoked the generator to inspect its output would clobber the
 * config of an in-flight submission — trading a drift bug for a
 * grades-the-wrong-prompt bug, which is strictly worse.
 *
 * So the generator is checked at the source level instead: no assertion comment
 * may be a bare string literal there. Every one must come from
 * `assertionIdentity.ts` or from `config/gates.yaml`, both of which are shared
 * with the hand-written path. That is weaker than parsing real output — it
 * cannot tell whether a `gates.yaml` summary collides with a hand-written
 * comment — but it closes the hole that actually occurred: a second copy of a
 * canonical string, drifting silently, in the one path that creates stimuli.
 */
function checkGeneratorSource(failures: string[]): number {
    const source = readFileSync(join(HERE, 'build-config.ts'), 'utf8');
    const literals = [...source.matchAll(/- comment: (?!\$\{)([^`'"\n]+)/g)];

    for (const [, text] of literals) {
        failures.push(
            `build-config.ts\n` +
            `  gate     generated stimulus assertion\n` +
            `  found    hardcoded comment literal: ${text.trim()}\n` +
            `  fix      import the canonical string from assertionIdentity.ts instead`
        );
    }
    return literals.length;
}

function main(): void {
    const files = readdirSync(STIMULI).filter(name => name.endsWith('.yaml')).sort();
    const stacks = readdirSync(STACKS).filter(name => name.endsWith('.yaml'));

    /** normalised query/exec -> every comment seen for it. */
    const gates = new Map<string, Occurrence[]>();
    const failures: string[] = [];

    for (const file of files) {
        for (const assertion of assertionsOf(parse(readFileSync(join(STIMULI, file), 'utf8')))) {
            const body = assertion.query ?? assertion.exec;
            if (!body) {
                continue;
            }
            const comment = assertion.comment ?? '';

            if (assertion.query && SENTINEL_QUERY.test(assertion.query.trim()) && comment !== SENTINEL_COMMENT) {
                failures.push(
                    `${file}\n` +
                    `  gate     liveness sentinel (pinned)\n` +
                    `  expected ${SENTINEL_COMMENT}\n` +
                    `  found    ${comment}`
                );
            }

            const key = normalise(body);
            gates.set(key, [...(gates.get(key) ?? []), { file, comment }]);
        }
    }

    for (const [key, occurrences] of gates) {
        const distinct = new Set(occurrences.map(o => o.comment.replace(TURN_SUFFIX, '')));
        if (distinct.size > 1) {
            failures.push(
                `${occurrences.length} assertions share one query but describe it ${distinct.size} different ways:\n` +
                `  query    ${key.slice(0, 100)}\n` +
                occurrences.map(o => `  ${o.file.padEnd(32)} ${o.comment}`).join('\n')
            );
        }
    }

    checkGeneratorSource(failures);

    if (failures.length) {
        console.error(
            `${failures.length} gate identity problem(s).\n\n` +
            failures.join('\n\n') + '\n\n' +
            `Two assertions with the same query are the same gate. A SQL assertion has no\n` +
            `grader filename, so its \`comment\` is the only stable identifier it carries into\n` +
            `stored run results — rewording one does not annotate a gate, it forks that gate\n` +
            `into a second identity with no history, silently, while the original appears to\n` +
            `stop being evaluated. Pick one wording and use it verbatim in every place.`
        );
        process.exit(1);
    }

    const shared = [...gates.values()].filter(occurrences => occurrences.length > 1).length;
    console.log(
        `✔ gate identity consistent: ${gates.size} distinct assertions across ${files.length} stimuli, ` +
        `${shared} of them shared by more than one stimulus.\n` +
        `✔ build-config.ts hardcodes no assertion comment, so the ${stacks.length} generated ` +
        `stack stimuli cannot fork a gate the hand-written ones share.`
    );
}

main();

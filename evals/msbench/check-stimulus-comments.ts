#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Fail if a stimulus paraphrases the comment of a shared assertion.
 *
 * ── Why comment text is load-bearing, which is genuinely surprising ───────────
 *
 * A `program` grader has a filename, so trend analysis across runs can key on
 * `validate-no-scaffold.ts` and survive any amount of rewording. A **SQL
 * assertion has no such handle**: `comment` is the only stable identifier it
 * carries into stored results. So for SQL assertions — and only for them — the
 * comment string is an identifier, not documentation.
 *
 * That is the opposite of the normal rule. A comment is the one place where
 * rephrasing is expected to be harmless, so anyone adding a stimulus will
 * naturally reword one to fit their case, and nothing about the YAML suggests
 * they shouldn't. The result is silent: the assertion still runs, still passes,
 * still reports — it has simply become a *different gate* with no history, while
 * the original gate appears to have stopped being evaluated. Neither shows up as
 * an error anywhere.
 *
 * It happened. The liveness sentinel from PR #1706 was carried into eleven
 * stimuli in **ten different wordings**, and the divergence was only noticed
 * when gate-health analysis reported the sentinel as declared-everywhere and
 * observed-nowhere. No identity scheme can repair that retroactively: the runs
 * are stored with the strings they had.
 *
 * ── Why this keys on the assertion, not on the comment ───────────────────────
 *
 * The obvious implementation — collect comments and complain when two look
 * similar — cannot work, because it has no way to tell a paraphrase of a shared
 * gate from a legitimately new assertion that happens to read alike.
 *
 * So each rule identifies its assertions by **what they do** (the query or exec
 * they run) and then requires the canonical comment for that class. A new
 * stimulus that copies the sentinel query and reworders its comment is caught,
 * because the query is what makes it the sentinel. An unrelated assertion is
 * never in scope, because its query does not match.
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const STIMULI = join(HERE, 'config', 'stimuli');

/**
 * The liveness sentinel. One canonical string, no per-turn variants.
 *
 * Turn attribution is deliberately NOT encoded here, even though the multi-turn
 * stimuli carry one of these per turn and the earlier wordings named the turn.
 * The `assertions` table stores a `stepIndex` column alongside the comment, so
 * which turn a sentinel belongs to is already recorded and recoverable. Encoding
 * it in the comment as well would buy nothing and would fork the gate into one
 * history per turn index — the exact failure this file exists to prevent.
 *
 * The wording is turn-scoped ("this turn") rather than session-scoped ("session
 * data must exist") because the implied `stepIndex` filter means every sentinel
 * only ever sees its own turn. The session-scoped phrasing was the more common
 * of the two, and was wrong for six of the thirteen places it appeared.
 */
const SENTINEL_COMMENT = 'Sentinel; this turn must have produced a response or its checks are vacuous';

/** Recorded, never asserted — see any stimulus. */
const FINGERPRINT_COMMENT = 'Environment fingerprint for triage';

/**
 * The `constraints.reject_tools` port.
 *
 * This one keeps an optional ` (turn N)` suffix, unlike the sentinel, and the
 * difference is not arbitrary. A whole-conversation constraint is duplicated per
 * turn precisely so the failing assertion names the turn that misbehaved, which
 * is its stated reason for existing. The suffix is therefore load-bearing where
 * the sentinel's would have been redundant. A gate-identity scheme can strip a
 * fixed trailing pattern; it cannot un-paraphrase free text.
 */
const REJECT_TOOLS_COMMENT = 'Agent should not fall back to the chat question tool';
const REJECT_TOOLS_PATTERN = new RegExp(`^${REJECT_TOOLS_COMMENT}( \\(turn \\d+\\))?$`);

interface Assertion {
    comment?: string;
    query?: string;
    exec?: string;
    assertZeroExitCode?: boolean;
}

interface Rule {
    readonly name: string;
    /** Identify the assertion by what it does, never by what it says. */
    readonly matches: (assertion: Assertion) => boolean;
    readonly accepts: (comment: string) => boolean;
    readonly expected: string;
}

const RULES: Rule[] = [
    {
        name: 'liveness sentinel',
        matches: a => /^\s*SELECT\s+COUNT\(\*\)\s*>\s*0\s+FROM\s+llm_responses\s*$/i.test(a.query ?? ''),
        accepts: comment => comment === SENTINEL_COMMENT,
        expected: SENTINEL_COMMENT,
    },
    {
        name: 'environment fingerprint',
        matches: a => (a.exec ?? '').includes('uname -sm'),
        accepts: comment => comment === FINGERPRINT_COMMENT,
        expected: FINGERPRINT_COMMENT,
    },
    {
        name: 'reject_tools (chat questions)',
        matches: a => /FROM\s+toolCalls\b/i.test(a.query ?? '') && /askQuestion/i.test(a.query ?? ''),
        accepts: comment => REJECT_TOOLS_PATTERN.test(comment),
        expected: `${REJECT_TOOLS_COMMENT}[ (turn N)]`,
    },
];

function assertionsOf(document: unknown): Assertion[] {
    const doc = document as { promptSteps?: { assertions?: Assertion[] }[]; preConditions?: Assertion[] };
    const steps = doc.promptSteps ?? [];
    return [...(doc.preConditions ?? []), ...steps.flatMap(step => step.assertions ?? [])];
}

function main(): void {
    const failures: string[] = [];
    let checked = 0;

    for (const file of readdirSync(STIMULI).filter(name => name.endsWith('.yaml')).sort()) {
        const document = parse(readFileSync(join(STIMULI, file), 'utf8'));
        for (const assertion of assertionsOf(document)) {
            for (const rule of RULES) {
                if (!rule.matches(assertion)) {
                    continue;
                }
                checked++;
                const comment = assertion.comment ?? '';
                if (!rule.accepts(comment)) {
                    failures.push(
                        `${file}\n` +
                        `  gate     ${rule.name}\n` +
                        `  expected ${rule.expected}\n` +
                        `  found    ${comment}`
                    );
                }
            }
        }
    }

    if (failures.length) {
        console.error(
            `${failures.length} shared assertion(s) use a non-canonical comment.\n\n` +
            failures.join('\n\n') + '\n\n' +
            `A SQL assertion has no grader filename, so its \`comment\` is the only stable\n` +
            `identifier it carries into stored run results. Rewording one does not annotate a\n` +
            `gate — it forks that gate into a second identity with no history, silently, while\n` +
            `the original appears to stop being evaluated. Copy the canonical string verbatim.`
        );
        process.exit(1);
    }

    console.log(`✔ ${checked} shared assertion comments are canonical across ${readdirSync(STIMULI).filter(n => n.endsWith('.yaml')).length} stimuli.`);
}

main();

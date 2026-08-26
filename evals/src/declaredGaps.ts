/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Join what the stacks *declare* will be red against what the runs actually did.
 *
 * `gate-health.ts` reconstructs expectations from stderr: it groups always-N/A
 * gates by `reason=` so that five missing-binary reds read as one actionable
 * line instead of five mysterious gates. That grouping is the right shape, but
 * it can only say *what happened* — it cannot say whether anyone had already
 * decided that was acceptable.
 *
 * The stacks now carry that decision in machine-readable form. `knownGaps` says
 * "this gate, for this reason, is expected red, and here is where the work to
 * close it is tracked". Joining the two splits one undifferentiated pile into
 * two piles with different owners:
 *
 *   **declared**   — somebody looked at this, wrote down why, and named the
 *                    follow-up. It is a bill we agreed to pay, not a surprise.
 *   **undeclared** — nobody has accounted for this. Go and look.
 *
 * That distinction is the difference between a report you skim and one you act
 * on, and it is also the only mechanical pressure on `knownGaps` to stay honest:
 * a declaration whose reason never actually appears is reported as stale.
 *
 * ## What this deliberately does NOT claim
 *
 * There is no run-to-stack linkage. MSBench artifacts do not record which stack
 * produced them, so this cannot say "the stack this run used declared it". It
 * says "**some** stack declares this gate red for this reason", and every string
 * it emits is worded to mean exactly that and no more. Overstating it would be
 * worse than not joining at all: a red that some other stack declared is not
 * accounted for on the stack that actually produced it.
 */

import type { Stack } from './stack.ts';

export interface DeclaredGap {
    gate: string;
    reason: string;
    /** Stack ids declaring this pair, sorted. */
    stacks: string[];
    /** The `tracking` note from each declaration, in stack order. */
    tracking: string[];
}

/**
 * Key on **gate and reason together**, never gate alone.
 *
 * A stack declaring `runtime-crud` red for `datastoreRequiresContainer` has said
 * nothing about `runtime-crud` failing for some other reason — and treating it
 * as blanket cover for that gate would let a genuine, unrelated failure hide
 * behind an accepted one. That is the accounted-for-by-accident failure, and it
 * is exactly what a declaration must not buy.
 */
function keyOf(gate: string, reason: string): string {
    return `${gate}\t${reason}`;
}

export function collectDeclaredGaps(stacks: Stack[]): Map<string, DeclaredGap> {
    const declared = new Map<string, DeclaredGap>();
    for (const stack of [...stacks].sort((a, b) => a.id.localeCompare(b.id))) {
        for (const gap of stack.knownGaps) {
            for (const gate of gap.gates) {
                const key = keyOf(gate, gap.reason);
                const existing = declared.get(key);
                if (existing) {
                    existing.stacks.push(stack.id);
                    existing.tracking.push(gap.tracking);
                    continue;
                }
                declared.set(key, { gate, reason: gap.reason, stacks: [stack.id], tracking: [gap.tracking] });
            }
        }
    }
    return declared;
}

export function lookupDeclaredGap(
    declared: Map<string, DeclaredGap>,
    gate: string,
    reason: string,
): DeclaredGap | undefined {
    return declared.get(keyOf(gate, reason));
}

/**
 * Declarations whose reason never actually appeared for a gate the corpus did
 * observe.
 *
 * The `observed` guard is the load-bearing half. A declaration for a gate that
 * never ran at all is not stale — the runs simply never exercised it, which is a
 * statement about the corpus rather than about the declaration. Reporting those
 * would bury the real signal under every gap for every phase nobody has run yet,
 * and a report that is mostly noise gets ignored, which is how the thing it was
 * meant to catch survives.
 */
export function findStaleDeclarations(
    declared: Map<string, DeclaredGap>,
    observedReasonsByGate: Map<string, Set<string>>,
): DeclaredGap[] {
    const stale: DeclaredGap[] = [];
    for (const gap of declared.values()) {
        const observed = observedReasonsByGate.get(gap.gate);
        if (!observed || observed.size === 0) {
            continue;
        }
        if (!observed.has(gap.reason)) {
            stale.push(gap);
        }
    }
    return stale.sort((a, b) => keyOf(a.gate, a.reason).localeCompare(keyOf(b.gate, b.reason)));
}

/**
 * What a report should say about one red, if anything.
 *
 * A pure decision so the guard that matters most has a regression test. The
 * first real run of this feature printed *"no stack declares ... red for
 * reason=X_MODEL_NOT_FOUND_ERROR"* four times — against rate limits and model
 * resolution faults, which no `knownGaps` entry could ever declare, because the
 * schema only accepts codes from the closed NOT_APPLICABLE vocabulary.
 *
 * That is the alarm-fatigue failure: four confident, useless lines are enough to
 * teach a reader to skip the section, and then the one line that matters is
 * skipped with them. It was caught by running the tool against the real corpus
 * and reading the output, which is not a repeatable safeguard — so the decision
 * moved here, where a case can hold it.
 */
export type GapAnnotation = 'skip' | 'undeclared' | 'declared';

export function annotationFor(
    gap: DeclaredGap | undefined,
    reason: string,
    reasonCodes: Set<string>,
): GapAnnotation {
    if (!reasonCodes.has(reason)) {
        return 'skip';
    }
    return gap ? 'declared' : 'undeclared';
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

type Case = { name: string; run: () => string | undefined };

function stackWith(id: string, gaps: Array<{ gates: string[]; reason: string; tracking: string }>): Stack {
    // Only the fields the join reads. Typed through `Stack` so a schema change
    // that renames `knownGaps` breaks this at compile time rather than silently
    // making every case pass against a field that no longer exists.
    return { id, knownGaps: gaps } as unknown as Stack;
}

const REASON_CODES = new Set(['functionsHostUnavailable', 'ecosystemNotSupported', 'datastoreRequiresContainer']);

const CASES: Case[] = [
    {
        name: 'an instance fault is not annotated at all — no stack could declare it',
        run: () => annotationFor(undefined, 'X_MODEL_NOT_FOUND_ERROR', REASON_CODES) === 'skip'
            ? undefined
            : 'a cause outside the NOT_APPLICABLE vocabulary must produce no line; four such lines shipped once',
    },
    {
        name: 'a grader error is not annotated either',
        run: () => annotationFor(undefined, 'graderError', REASON_CODES) === 'skip'
            ? undefined
            : 'graderError is not a reason a stack can declare',
    },
    {
        name: 'a real reason code with no declaration is reported undeclared',
        run: () => annotationFor(undefined, 'functionsHostUnavailable', REASON_CODES) === 'undeclared'
            ? undefined
            : 'an unaccounted-for red must say so',
    },
    {
        name: 'a real reason code with a declaration is reported declared',
        run: () => {
            const gap: DeclaredGap = { gate: 'g', reason: 'functionsHostUnavailable', stacks: ['a'], tracking: ['t'] };
            return annotationFor(gap, 'functionsHostUnavailable', REASON_CODES) === 'declared'
                ? undefined
                : 'a declared red must be labelled as such';
        },
    },
    {
        name: 'a declared gate+reason pair is found, with its tracking note',
        run: () => {
            const declared = collectDeclaredGaps([
                stackWith('a', [{ gates: ['runtime-crud'], reason: 'datastoreRequiresContainer', tracking: 'needs a database server' }]),
            ]);
            const hit = lookupDeclaredGap(declared, 'runtime-crud', 'datastoreRequiresContainer');
            return hit?.tracking[0] === 'needs a database server' ? undefined : `expected the tracking note, got ${JSON.stringify(hit)}`;
        },
    },
    {
        name: 'the same reason on a DIFFERENT gate does not match',
        run: () => {
            const declared = collectDeclaredGaps([
                stackWith('a', [{ gates: ['runtime-crud'], reason: 'ecosystemNotSupported', tracking: 't' }]),
            ]);
            return lookupDeclaredGap(declared, 'runtime-health', 'ecosystemNotSupported')
                ? 'a declaration for one gate must not cover another'
                : undefined;
        },
    },
    {
        name: 'the same gate with a DIFFERENT reason does not match',
        run: () => {
            // The failure this prevents: a real, unrelated red hiding behind an
            // accepted one because the gate name happened to be declared.
            const declared = collectDeclaredGaps([
                stackWith('a', [{ gates: ['runtime-crud'], reason: 'datastoreRequiresContainer', tracking: 't' }]),
            ]);
            return lookupDeclaredGap(declared, 'runtime-crud', 'functionsHostUnavailable')
                ? 'a declaration for one reason must not cover a different failure of the same gate'
                : undefined;
        },
    },
    {
        name: 'two stacks declaring the same pair are merged, both named',
        run: () => {
            const declared = collectDeclaredGaps([
                stackWith('b', [{ gates: ['runtime-app-starts'], reason: 'functionsHostUnavailable', tracking: 'tb' }]),
                stackWith('a', [{ gates: ['runtime-app-starts'], reason: 'functionsHostUnavailable', tracking: 'ta' }]),
            ]);
            const hit = lookupDeclaredGap(declared, 'runtime-app-starts', 'functionsHostUnavailable');
            return JSON.stringify(hit?.stacks) === JSON.stringify(['a', 'b']) ? undefined : `expected both stacks sorted, got ${JSON.stringify(hit?.stacks)}`;
        },
    },
    {
        name: 'an empty declaration set matches nothing',
        run: () => {
            // The negative control. A join broken so that it matches everything
            // would relabel every red in the corpus as "declared, tracked" — the
            // most expensive possible failure of this feature, and invisible.
            const declared = collectDeclaredGaps([]);
            return lookupDeclaredGap(declared, 'runtime-crud', 'datastoreRequiresContainer')
                ? 'an empty declaration set must not match anything'
                : undefined;
        },
    },
    {
        name: 'a declaration whose reason never appeared for an observed gate is stale',
        run: () => {
            const declared = collectDeclaredGaps([
                stackWith('a', [{ gates: ['runtime-health'], reason: 'functionsHostUnavailable', tracking: 't' }]),
            ]);
            const observed = new Map([['runtime-health', new Set(['noHealthPathDeclared'])]]);
            const stale = findStaleDeclarations(declared, observed);
            return stale.length === 1 && stale[0].gate === 'runtime-health' ? undefined : `expected one stale declaration, got ${stale.length}`;
        },
    },
    {
        name: 'a declaration for a gate the corpus never observed is NOT stale',
        run: () => {
            // Otherwise every gap for a phase nobody has run yet is reported, and
            // a report that is mostly noise gets ignored.
            const declared = collectDeclaredGaps([
                stackWith('a', [{ gates: ['runtime-health'], reason: 'functionsHostUnavailable', tracking: 't' }]),
            ]);
            const stale = findStaleDeclarations(declared, new Map());
            return stale.length === 0 ? undefined : 'a gate the corpus never observed says nothing about its declaration';
        },
    },
    {
        name: 'a declaration whose reason did appear is not stale',
        run: () => {
            const declared = collectDeclaredGaps([
                stackWith('a', [{ gates: ['runtime-health'], reason: 'functionsHostUnavailable', tracking: 't' }]),
            ]);
            const observed = new Map([['runtime-health', new Set(['functionsHostUnavailable'])]]);
            return findStaleDeclarations(declared, observed).length === 0 ? undefined : 'a declaration that matched an observation is not stale';
        },
    },
];

/** Returns the number of failing cases; 0 is a pass. */
export function selfTestDeclaredGaps(report: (line: string) => void): number {
    let failed = 0;
    for (const testCase of CASES) {
        const problem = testCase.run();
        if (problem) {
            failed++;
            report(`  ✖ ${testCase.name} — ${problem}`);
        } else {
            report(`  ✔ ${testCase.name}`);
        }
    }
    return failed;
}

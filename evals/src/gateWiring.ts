/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Decide which gates a stack runs — the derivation the whole schema exists for.
 *
 * A pure function of (stack facts x gate table x phase). No filesystem, no
 * environment, no runtime probing: given the same three inputs it always
 * produces the same wiring, which is what makes it reviewable as a diff and
 * testable without a container.
 *
 * ## The claim this implements
 *
 * A gate is wired only when the stack declares the thing it looks at. So an
 * `outOfScope` NOT_APPLICABLE verdict — "this gate should not have been wired
 * here" — is unreachable through this path by construction, and an `outOfScope`
 * marker appearing in a real run is a **bug report against the schema**: either
 * a gate's `requires:` is wrong, or a stack lied about its project.
 *
 * That is deliberately falsifiable. If such markers keep arriving from correct
 * stacks, this design is wrong.
 *
 * ## What is deliberately NOT here
 *
 * No per-stack override. The design sketched a `gateOverrides:` escape hatch for
 * a gate whose applicability is not derivable; nothing has needed it yet, and an
 * escape hatch added before its first use is a place for stale exceptions to
 * accumulate. It can be added the day a gate cannot be expressed.
 */

import { basename } from 'node:path';
import { reject } from './configValidation.ts';
import type { Gate, GatePredicate, GateTable } from './gateTable.ts';
import type { Stack } from './stack.ts';

export interface WiredGate {
    gate: Gate;
    /** Flags derived from the stack's facts, in table order. */
    args: string[];
    /** Set when the stack declares this gate will be red for a known reason. */
    knownGapReason?: string;
}

export interface PhaseWiring {
    phase: string;
    wired: WiredGate[];
    /** Gates in this phase the stack's facts excluded, with the fact that did it. */
    excluded: Array<{ gate: Gate; because: string }>;
}

/**
 * Read a stack fact by its dotted path.
 *
 * Returns `undefined` for an unset optional field, which is the whole point:
 * `project.healthPath` being unset is what unwires the health gate.
 */
function readFact(stack: Stack, fact: string): string | undefined {
    switch (fact) {
        case 'ecosystem': return stack.ecosystem;
        case 'project.frontend': return stack.project.frontend;
        case 'project.api': return stack.project.api;
        case 'project.datastore': return stack.project.datastore;
        case 'project.hosting': return stack.project.hosting;
        case 'project.healthPath': return stack.project.healthPath;
        case 'project.collectionRoute': return stack.project.collectionRoute;
        // Unreachable: `gateTable.ts` rejects any fact not in its closed list.
        default: return undefined;
    }
}

/**
 * Evaluate a predicate, returning the fact that failed rather than a boolean.
 *
 * The reason is reporting, not style. "runtime-frontend is not wired" is not
 * reviewable; "runtime-frontend is not wired because project.frontend is none"
 * can be checked against the prompt by someone who has never read the gate.
 */
export function evaluatePredicate(stack: Stack, predicate: GatePredicate): { matched: true } | { matched: false; because: string } {
    for (const [fact, condition] of Object.entries(predicate)) {
        const value = readFact(stack, fact);
        if (condition === 'present') {
            if (value === undefined) {
                return { matched: false, because: `${fact} is not declared` };
            }
            continue;
        }
        if (!Array.isArray(condition)) {
            if (value !== undefined && condition.not.includes(value)) {
                return { matched: false, because: `${fact} is ${value}` };
            }
            continue;
        }
        if (value === undefined || !condition.includes(value)) {
            return { matched: false, because: describeMiss(fact, value, condition) };
        }
    }
    return { matched: true };
}

/**
 * Say *which kind* of exclusion this is, because the two have opposite remedies.
 *
 * Every fact except `ecosystem` describes the project: "this app has no
 * frontend" means there is nothing to grade and nothing to build. `ecosystem` is
 * different — it describes what the *grader* can handle, and a Python project
 * has a perfectly real "does it build?" question that we simply cannot ask yet.
 *
 * Both unwire the gate, so neither can produce a misleading verdict. But an
 * ecosystem exclusion is a **coverage gap that happens to be invisible**: no red
 * appears, because wiring the gate would make it exit 1 and blame the agent for
 * a project the grader cannot read, which is a fabricated failure and worse. So
 * the snapshot says so in words, and the gap is legible to anyone reading it
 * rather than silently absent.
 */
function describeMiss(fact: string, value: string | undefined, allowed: string[]): string {
    if (fact === 'ecosystem') {
        return `this gate only supports ecosystem ${allowed.join(' or ')}, and this stack is ${value ?? 'undeclared'} `
            + '— a coverage gap in the gate, not a property of the project';
    }
    return `${fact} is ${value ?? 'not declared'}, not ${allowed.join(' or ')}`;
}

/** Derive the wiring for one stack in one phase. */
export function deriveWiring(stack: Stack, table: GateTable, phase: string): PhaseWiring {
    const wired: WiredGate[] = [];
    const excluded: Array<{ gate: Gate; because: string }> = [];

    for (const gate of table.gates) {
        if (!gate.phases.includes(phase)) {
            continue;
        }
        const verdict = evaluatePredicate(stack, gate.requires);
        if (!verdict.matched) {
            excluded.push({ gate, because: verdict.because });
            continue;
        }
        const args = gate.args
            .filter(argument => evaluatePredicate(stack, argument.when).matched)
            .map(argument => argument.value);
        wired.push({ gate, args, knownGapReason: findKnownGap(stack, gate.id) });
    }
    return { phase, wired, excluded };
}

function findKnownGap(stack: Stack, gateId: string): string | undefined {
    return stack.knownGaps.find(gap => gap.gates.includes(gateId))?.reason;
}

/**
 * Every gate this stack could ever wire, across every phase in the table.
 *
 * Judged against the table's full phase set rather than the phases the stack
 * currently declares, because a `knownGaps` entry describes the *project*, not
 * today's configuration. Only `plan` has a phase file so far; scoping staleness
 * to declared phases would make every runtime gap look stale now and un-stale
 * itself later, which trains people to ignore the check.
 */
export function everWiredGateIds(stack: Stack, table: GateTable): Set<string> {
    const ids = new Set<string>();
    for (const phase of table.phases) {
        for (const { gate } of deriveWiring(stack, table, phase).wired) {
            ids.add(gate.id);
        }
    }
    return ids;
}

/**
 * True when every gate this phase would run is already declared to be red.
 *
 * Such a run is pre-determined to teach us nothing: it costs a slot and returns
 * only verdicts we could have written down beforehand. It is a **warning and not
 * an error** on purpose — someone may want the run for a gate outside this
 * phase, or as a control — but it is computable before the money is spent, so it
 * gets said out loud.
 */
export function teachesNothing(wiring: PhaseWiring): boolean {
    return wiring.wired.length > 0 && wiring.wired.every(entry => entry.knownGapReason !== undefined);
}

/**
 * Cross-check a stack's `knownGaps` against the wiring it actually produces.
 *
 * Deferred from the schema PR because it needs the derivation. Both rules catch
 * the same slow failure: a declaration that no longer describes anything. A gap
 * naming a gate this stack never wires cannot explain any red, so it can only
 * mislead the person reading the report — and it will outlive the fact it was
 * written for.
 */
export function checkKnownGapsAgainstTable(stack: Stack, table: GateTable): void {
    const known = new Set(table.gates.map(gate => gate.id));
    const everWired = everWiredGateIds(stack, table);

    for (const [index, gap] of stack.knownGaps.entries()) {
        for (const gateId of gap.gates) {
            if (!known.has(gateId)) {
                reject(
                    'stackKnownGapUnknownGate',
                    stack.sourcePath,
                    `knownGaps[${index}] names gate '${gateId}', which is not in ${basename(table.sourcePath)}. `
                    + `A gap for a gate that does not exist explains nothing; check the spelling against the gate ids there.`,
                );
            }
            if (!everWired.has(gateId)) {
                reject(
                    'stackKnownGapNeverWired',
                    stack.sourcePath,
                    `knownGaps[${index}] declares a gap for '${gateId}', but this stack's facts never wire that gate in `
                    + `any phase. Nothing here could ever be red for that reason, so the declaration only misleads — `
                    + `delete it, or fix the fact that should have wired the gate.`,
                );
            }
        }
    }
}

/**
 * Render the full wiring of a stack as text, for the checked-in snapshot.
 *
 * The snapshot is the review artifact: a change to a `requires:` line shows up
 * as a diff naming every gate it moved, so "this refactor changes no wiring" is
 * a claim the reviewer can see rather than one they have to believe.
 */
export function explainWiring(stack: Stack, table: GateTable): string {
    const lines: string[] = [
        `# ${stack.id}`,
        '',
        'GENERATED by `npm run stacks:check`. Do not edit — change the stack or the gate',
        'table and re-run. This file exists so a wiring change is visible in review.',
        '',
        `- name: ${stack.name}`,
        `- ecosystem: ${stack.ecosystem}`,
        `- project: frontend=${stack.project.frontend} api=${stack.project.api} `
        + `datastore=${stack.project.datastore} hosting=${stack.project.hosting}`,
        `- healthPath: ${stack.project.healthPath ?? '(none)'}`,
        `- collectionRoute: ${stack.project.collectionRoute ?? '(none)'}`,
        `- phases configured for this stack: ${stack.phases.join(', ')}`,
        '',
    ];

    for (const phase of table.phases) {
        const wiring = deriveWiring(stack, table, phase);
        const configured = stack.phases.includes(phase) ? '' : ' (phase not configured for this stack)';
        lines.push(`## phase: ${phase}${configured}`, '');

        if (wiring.wired.length === 0) {
            lines.push('wired: none', '');
        } else {
            lines.push('wired:');
            for (const entry of wiring.wired) {
                const args = entry.args.length > 0 ? ` ${entry.args.join(' ')}` : '';
                const gap = entry.knownGapReason ? `  [known gap: ${entry.knownGapReason}]` : '';
                lines.push(`  ${entry.gate.id}${args}${gap}`);
            }
            lines.push('');
        }

        if (wiring.excluded.length > 0) {
            lines.push('not wired:');
            for (const entry of wiring.excluded) {
                lines.push(`  ${entry.gate.id} — ${entry.because}`);
            }
            lines.push('');
        }

        if (teachesNothing(wiring)) {
            lines.push('! every gate this phase would run is a declared known gap — such a run can', '  produce no new information.', '');
        }
    }
    return lines.join('\n');
}

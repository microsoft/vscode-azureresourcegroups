#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Check the stack schema — and, more importantly, check that the check works.
 *
 * The house rule this is built to satisfy: **a validator is not done until a
 * deliberately broken fixture makes it fail.** This suite has repeatedly shipped
 * things that looked fine and tested nothing — a timeout that could not fire, a
 * `COUNT(*) = 0` trivially true against an empty table, a gate 0-for-16 while
 * reporting healthy. A schema validator is an easy addition to that list: one
 * that accepts everything passes every test written only against good files.
 *
 * So there are two halves, and the second is the real one:
 *
 *   1. Every real stack, and the container inventory, must load.
 *   2. Every file under `config/__fixtures__/` must be **rejected with the exact
 *      code it declares** in its `# expect:` header.
 *
 * Asserting the code rather than merely "it threw" is what makes each fixture
 * prove its own rule. A validator broken so that it rejects everything would
 * sail through a suite that only checked for a throw; here it fails on every
 * fixture at once and names each one.
 *
 * ## Three vacuity traps, closed explicitly
 *
 * Each of these has bitten this repo:
 *
 *   - An empty fixture directory makes "every fixture was rejected" trivially
 *     true, so the count is asserted non-zero *and* equal to the files present.
 *   - An empty stacks directory makes "every stack is valid" trivially true, so
 *     that is asserted non-zero too.
 *   - A fixture with no `# expect:` header would be silently skipped, so a
 *     missing header is itself a failure.
 *
 * ## The ratchet
 *
 * A rule with no fixture is unproven, and unproven is indistinguishable from
 * broken. Rather than claim otherwise, this reports how many of the validators'
 * error codes are actually exercised, lists the ones that are not, and refuses
 * to let that number fall (`MIN_PROVEN_CODES`). Not every code will ever have a
 * fixture — several are plain type checks — but the count may only go up, so
 * deleting a fixture is a failure rather than a silence.
 *
 * And one process trap: nothing here is piped. A pipe discards the exit status
 * of its left-hand side, which is how a broken check came to report success.
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 *
 * Usage: npm run stacks:check
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigValidationError } from './src/configValidation.ts';
import { countAsserted, loadContainerInventory } from './src/containerInventory.ts';
import { loadGateTable } from './src/gateTable.ts';
import type { GateTable } from './src/gateTable.ts';
import { checkKnownGapsAgainstTable, deriveWiring, explainWiring, teachesNothing } from './src/gateWiring.ts';
import { loadStack } from './src/stack.ts';
import type { Stack, StackLoadOptions } from './src/stack.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(HERE, 'msbench', 'config');
const STACKS = join(CONFIG, 'stacks');
const FIXTURES = join(CONFIG, '__fixtures__');
const PHASES = join(CONFIG, 'phases');
const CONTAINER = join(CONFIG, 'container.yaml');
const GATES = join(CONFIG, 'gates.yaml');
const SNAPSHOTS = join(CONFIG, '__snapshots__');
const REPO_ROOT = resolve(HERE, '..');

/** `--update` rewrites the wiring snapshots instead of asserting them. */
const UPDATE_SNAPSHOTS = process.argv.includes('--update');

/** The validator sources whose error codes the fixtures are measured against. */
const VALIDATOR_SOURCES = ['src/stack.ts', 'src/containerInventory.ts', 'src/gateTable.ts', 'src/gateWiring.ts'];

/**
 * The floor for proven error codes. **This number may only ever go up.**
 *
 * A ratchet rather than a target: it does not demand a fixture for every code
 * (several are plain type checks whose fixture would prove little), but it does
 * mean that deleting a fixture — or adding a judgment-carrying rule and
 * forgetting to prove it — fails here instead of passing quietly.
 */
const MIN_PROVEN_CODES = 34;

/** `# expect: <code>` in a fixture header — the rule that fixture exists to prove. */
const EXPECT_DIRECTIVE = /^#\s*expect:\s*([A-Za-z][A-Za-z0-9]*)\s*$/m;

/**
 * Error codes as they appear in the validator sources.
 *
 * Codes reach `ConfigValidationError` by several paths — `reject(...)` directly,
 * and as an argument to `requireObject` / `requireString` / `requireEnum` /
 * `rejectUnknownKeys` — so matching call shapes one at a time would miss some.
 * What every path has in common is that the code literal is immediately followed
 * by the file argument, which is what this matches.
 *
 * A looser match on the prefix alone was tried first and was wrong: it counted
 * `'containerApps'` (a hosting kind) and `'stackDeclaration'` (a discovery-chain
 * source) as error codes, inflating the denominator and putting two names on the
 * unproven list that no fixture could ever remove. A coverage number that cannot
 * reach its own ceiling teaches people to ignore it.
 */
const CODE_LITERAL = /'([A-Za-z][A-Za-z0-9]*)',\s*(?:filePath|file)\b/g;

const failures: string[] = [];

function fail(message: string): void {
    failures.push(message);
    console.error(`  ✖ ${message}`);
}

function yamlFilesIn(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.yaml'))
        .map(entry => entry.name)
        .sort();
}

/**
 * Load a fixture and assert it is rejected with the code its header declares.
 * Returns the proven code, or undefined when the fixture did not do its job.
 */
function expectRejection(directory: string, name: string, load: (path: string) => unknown): string | undefined {
    const path = join(directory, name);
    const expected = EXPECT_DIRECTIVE.exec(readFileSync(path, 'utf8'))?.[1];
    if (!expected) {
        fail(`${name} has no '# expect: <code>' header, so nothing about it is being checked`);
        return undefined;
    }
    try {
        load(path);
        fail(`${name} was ACCEPTED; it must be rejected with ${expected}`);
        return undefined;
    } catch (error) {
        if (!(error instanceof ConfigValidationError)) {
            fail(`${name} threw something other than a validation error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            return undefined;
        }
        if (error.code !== expected) {
            // The subtle failure this catches: a fixture rejected for the wrong
            // reason proves the wrong rule, and would keep passing while the rule
            // it was written for quietly stopped working.
            fail(`${name} was rejected as ${error.code}, but exists to prove ${expected}`);
            return undefined;
        }
        console.error(`  ✔ ${name} → ${error.code}`);
        return error.code;
    }
}

function checkFixtureDirectory(label: string, directory: string, load: (path: string) => unknown): string[] {
    console.error(`\n${label}`);
    const fixtures = yamlFilesIn(directory);
    if (fixtures.length === 0) {
        fail(`${label}: no fixtures found — the validator is unproven, which is the same as broken`);
        return [];
    }

    const proven = fixtures
        .map(name => expectRejection(directory, name, load))
        .filter((code): code is string => code !== undefined);

    // Equality, not `> 0`. "At least one fixture was rejected" is the same shape
    // as the `COUNT(*) = 0` assertion that passed against an empty table.
    if (proven.length !== fixtures.length) {
        fail(`${label}: ${proven.length} of ${fixtures.length} fixtures were rejected as declared; every one must be`);
    }
    return proven;
}

/**
 * Assert the checked-in wiring snapshots still describe what the derivation does.
 *
 * The snapshot is the review artifact for the part of this system that is
 * otherwise invisible. A one-line change to a gate's `requires:` can silently
 * unwire a gate across every stack, and a gate wired nowhere reads as a clean
 * run — so "this change moves no wiring" has to be something a reviewer can
 * *see* rather than something they take on trust. Regenerate with `--update`.
 *
 * It also prints the derivation working in both directions, which is the only
 * evidence that the schema does anything at all: the same gate table must wire
 * a different set of gates for two different stacks.
 */
function checkWiringSnapshots(stacks: Stack[], table: GateTable): void {
    console.error('\nWiring');
    if (!existsSync(SNAPSHOTS)) {
        mkdirSync(SNAPSHOTS, { recursive: true });
    }

    for (const stack of stacks) {
        const snapshotPath = join(SNAPSHOTS, `${stack.id}.wiring.md`);
        const rendered = explainWiring(stack, table);

        if (UPDATE_SNAPSHOTS) {
            writeFileSync(snapshotPath, rendered);
            console.error(`  ↻ ${stack.id}.wiring.md written`);
        } else if (!existsSync(snapshotPath)) {
            fail(`${stack.id} has no wiring snapshot. Run \`npm run stacks:check -- --update\`.`);
        } else if (readFileSync(snapshotPath, 'utf8') !== rendered) {
            fail(
                `${stack.id}.wiring.md is out of date — the derivation now produces different wiring. `
                + `Review the change, then run \`npm run stacks:check -- --update\`.`,
            );
        }

        // A per-phase summary, so the both-directions property is legible in the
        // log and not only in a file nobody opens.
        for (const phase of table.phases) {
            const wiring = deriveWiring(stack, table, phase);
            if (wiring.wired.length === 0 && wiring.excluded.length === 0) {
                continue;
            }
            const warning = teachesNothing(wiring) ? '  ! every wired gate is a known gap' : '';
            console.error(
                `  ${stack.id} / ${phase}: ${wiring.wired.length} wired, ${wiring.excluded.length} not applicable${warning}`,
            );
        }
    }

    // The claim the schema rests on. Two stacks that wire an identical gate set
    // would mean the facts are not reaching the derivation, and every "this is
    // derived" statement in the tree would be decoration.
    if (stacks.length >= 2) {
        const signatures = stacks.map(stack => table.phases
            .flatMap(phase => deriveWiring(stack, table, phase).wired.map(entry => `${phase}:${entry.gate.id}`))
            .join(','));
        if (new Set(signatures).size === 1) {
            fail(
                'every stack derives an identical gate set, so the derivation is not discriminating between them. '
                + 'Either the stacks do not actually differ, or their facts are not reaching the gate table.',
            );
        }
    }
}

/**
 * Exercise the derivation branches no config fixture reaches.
 *
 * `teachesNothing` decides whether to warn that a run is pre-determined to
 * produce no information. No real stack triggers it today, which is exactly the
 * condition under which a branch quietly stops working — so it is driven here
 * with a synthetic stack rather than left to be right by assumption.
 *
 * The third case is the one that matters: an *empty* wired set must NOT warn.
 * "every gate is a known gap" over zero gates is vacuously true, which is the
 * same shape as the `COUNT(*) = 0` assertion that passed against an empty table.
 */
function checkDerivationBranches(stacks: Stack[], table: GateTable): void {
    console.error('\nDerivation branches');
    const stack = stacks[0];
    if (!stack) {
        fail('no stack to exercise the derivation with');
        return;
    }

    const real = deriveWiring(stack, table, 'plan');
    if (teachesNothing(real)) {
        fail(`${stack.id}/plan wires ${real.wired.length} gates and none should be a known gap, but it warns`);
    } else {
        console.error(`  ✔ a stack with real gates to run does not warn (${real.wired.length} wired)`);
    }

    // Same stack, but every gate the phase runs is declared as a known gap.
    const allGapped: Stack = {
        ...stack,
        knownGaps: [{ gates: real.wired.map(entry => entry.gate.id), reason: 'ecosystemNotSupported', tracking: 'synthetic' }],
    };
    if (!teachesNothing(deriveWiring(allGapped, table, 'plan'))) {
        fail('a phase whose every wired gate is a declared known gap must warn, and did not');
    } else {
        console.error('  ✔ a run whose every wired gate is a known gap warns');
    }

    // A phase with nothing wired must not warn: there is no run to describe.
    const emptyWiring = { phase: 'plan', wired: [], excluded: [] };
    if (teachesNothing(emptyWiring)) {
        fail('an empty wired set must not warn — "every gate is a gap" over zero gates is vacuously true');
    } else {
        console.error('  ✔ an empty wired set does not warn vacuously');
    }
}

/** Every error code the validators can emit, scanned from their sources. */
function declaredCodes(): Set<string> {
    const codes = new Set<string>();
    for (const source of VALIDATOR_SOURCES) {
        const text = readFileSync(join(HERE, source), 'utf8');
        for (const match of text.matchAll(CODE_LITERAL)) {
            codes.add(match[1]);
        }
    }
    return codes;
}

function main(): void {
    // ---- The container inventory -------------------------------------------
    console.error('Container inventory');
    const inventory = loadContainerInventory(CONTAINER);
    const asserted = countAsserted(inventory);
    console.error(`  ✔ ${inventory.binaries.size} binaries, verified ${inventory.verifiedOn}`);
    // Printed on every run rather than buried in a comment. Most of that file is
    // documentation repeated between humans, and a number that shows up each time
    // is harder to keep believing than a sentence nobody rereads.
    console.error(`  ! ${asserted} of ${inventory.binaries.size} rows are asserted, not measured — see container.yaml`);

    const options: StackLoadOptions = { inventory, phasesDirectory: PHASES };

    // ---- The gate table ----------------------------------------------------
    console.error('\nGate table');
    const table = loadGateTable(GATES, REPO_ROOT);
    console.error(`  ✔ ${table.gates.length} gates across phases: ${table.phases.join(', ')}`);
    for (const phase of table.phases) {
        const count = table.gates.filter(gate => gate.phases.includes(phase)).length;
        console.error(`      ${phase}: ${count}`);
    }

    // ---- Half one: the real stacks must load -------------------------------
    console.error('\nStacks');
    const stackFiles = yamlFilesIn(STACKS);
    if (stackFiles.length === 0) {
        fail('no stacks found — "every stack is valid" is vacuously true with nothing to check');
    }
    const stacks: Stack[] = [];
    for (const name of stackFiles) {
        try {
            const stack = loadStack(join(STACKS, name), options);
            // Deferred from the schema PR because it needs the derivation: a gap
            // naming a gate this stack never wires cannot explain any red.
            checkKnownGapsAgainstTable(stack, table);
            stacks.push(stack);
            const gaps = stack.knownGaps.length === 0
                ? 'no known gaps'
                : `${stack.knownGaps.length} known gap(s): ${stack.knownGaps.map(gap => gap.reason).join(', ')}`;
            console.error(`  ✔ ${stack.id} — ${stack.ecosystem}, ${gaps}`);
        } catch (error) {
            fail(`${name} should be valid but was rejected: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    checkWiringSnapshots(stacks, table);
    checkDerivationBranches(stacks, table);

    // ---- Half two: the broken fixtures must be rejected, by name -----------
    const provenStack = checkFixtureDirectory(
        'Stack rejection fixtures',
        join(FIXTURES, 'stacks-invalid'),
        // The cross-check runs here too, so the rules that need the gate table —
        // a gap for a gate that does not exist, or one this stack never wires —
        // are provable by a fixture like every other rule.
        path => {
            const stack = loadStack(path, options);
            checkKnownGapsAgainstTable(stack, table);
        },
    );
    const provenContainer = checkFixtureDirectory(
        'Container rejection fixtures',
        join(FIXTURES, 'container-invalid'),
        path => loadContainerInventory(path),
    );
    const provenGates = checkFixtureDirectory(
        'Gate table rejection fixtures',
        join(FIXTURES, 'gates-invalid'),
        path => loadGateTable(path, REPO_ROOT),
    );

    // ---- The ratchet -------------------------------------------------------
    const proven = new Set([...provenStack, ...provenContainer, ...provenGates]);
    const declared = declaredCodes();
    const unproven = [...declared].filter(code => !proven.has(code)).sort();
    console.error(`\nRule coverage: ${proven.size} of ${declared.size} error codes proven by a fixture.`);
    if (unproven.length > 0) {
        console.error(`  Unproven (mostly plain type checks; raising this is follow-up work):`);
        console.error(`    ${unproven.join('\n    ')}`);
    }
    if (proven.size < MIN_PROVEN_CODES) {
        fail(`rule coverage fell to ${proven.size}; MIN_PROVEN_CODES is ${MIN_PROVEN_CODES} and may only go up`);
    }

    console.error('');
    if (failures.length > 0) {
        console.error(`FAIL: ${failures.length} problem(s) above.`);
        process.exit(1);
    }
    console.error(`PASS: ${stackFiles.length} stack(s) valid, ${proven.size} rules proven by ${provenStack.length + provenContainer.length + provenGates.length} fixtures.`);
}

main();

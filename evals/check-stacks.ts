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

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigValidationError } from './src/configValidation.ts';
import { countAsserted, loadContainerInventory } from './src/containerInventory.ts';
import { loadStack } from './src/stack.ts';
import type { StackLoadOptions } from './src/stack.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(HERE, 'msbench', 'config');
const STACKS = join(CONFIG, 'stacks');
const FIXTURES = join(CONFIG, '__fixtures__');
const PHASES = join(CONFIG, 'phases');
const CONTAINER = join(CONFIG, 'container.yaml');

/** The validator sources whose error codes the fixtures are measured against. */
const VALIDATOR_SOURCES = ['src/stack.ts', 'src/containerInventory.ts'];

/**
 * The floor for proven error codes. **This number may only ever go up.**
 *
 * A ratchet rather than a target: it does not demand a fixture for every code
 * (several are plain type checks whose fixture would prove little), but it does
 * mean that deleting a fixture — or adding a judgment-carrying rule and
 * forgetting to prove it — fails here instead of passing quietly.
 */
const MIN_PROVEN_CODES = 24;

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

    // ---- Half one: the real stacks must load -------------------------------
    console.error('\nStacks');
    const stackFiles = yamlFilesIn(STACKS);
    if (stackFiles.length === 0) {
        fail('no stacks found — "every stack is valid" is vacuously true with nothing to check');
    }
    for (const name of stackFiles) {
        try {
            const stack = loadStack(join(STACKS, name), options);
            const gaps = stack.knownGaps.length === 0
                ? 'no known gaps'
                : `${stack.knownGaps.length} known gap(s): ${stack.knownGaps.map(gap => gap.reason).join(', ')}`;
            console.error(`  ✔ ${stack.id} — ${stack.ecosystem}, ${gaps}`);
        } catch (error) {
            fail(`${name} should be valid but was rejected: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // ---- Half two: the broken fixtures must be rejected, by name -----------
    const provenStack = checkFixtureDirectory(
        'Stack rejection fixtures',
        join(FIXTURES, 'stacks-invalid'),
        path => loadStack(path, options),
    );
    const provenContainer = checkFixtureDirectory(
        'Container rejection fixtures',
        join(FIXTURES, 'container-invalid'),
        path => loadContainerInventory(path),
    );

    // ---- The ratchet -------------------------------------------------------
    const proven = new Set([...provenStack, ...provenContainer]);
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
    console.error(`PASS: ${stackFiles.length} stack(s) valid, ${proven.size} rules proven by ${provenStack.length + provenContainer.length} fixtures.`);
}

main();

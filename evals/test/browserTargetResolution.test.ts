/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserProbeScript } from '../src/SandboxLocalRuntimeValidator';

/**
 * `localBrowserFailed` was the single largest local-runtime failure code (28 of 74 historical
 * failures). A replay of two saved workspaces showed why: the app renders "Create first ticket"
 * from its `EmptyState` component, and the evaluator always boots against an empty database
 * because the integrate agent forbids seed data. The probe demanded the populated-state label
 * "Create ticket", matched nothing, and spent the full 30s click timeout before failing a create
 * flow that actually worked.
 */
const build = (actions: unknown[]): string => createBrowserProbeScript('http://127.0.0.1:5173', {
    expectedText: 'ticket',
    actions,
    assertions: [{ kind: 'text', selector: 'body', value: 'Browser acceptance ticket' }],
} as never);

const clickCreate = [{ kind: 'click', selectorType: 'role', role: 'button', selector: 'Create ticket' }];

void test('an absent click target falls back to an intent-equivalent control', () => {
    const script = build(clickCreate);

    assert.match(script, /const findIntentEquivalent = async \(role, name\)/);
    // The absent case must be distinguished from the ambiguous case; returning the empty locator
    // is what produced the 30s timeout.
    assert.match(script, /if \(count === 0\) \{/);
});

void test('the click action forwards its role and accessible name to the resolver', () => {
    const script = build(clickCreate);

    assert.match(script, /resolveClickTarget\(page\.getByRole\("button".*"button", "Create ticket"\)/);
});

void test('a non-role selector does not attempt intent matching', () => {
    const script = build([{ kind: 'click', selector: '#submit' }]);

    // With no accessible name there is nothing to match on, and guessing from a CSS selector
    // would be the kind of silent substitution this probe must never do.
    assert.match(script, /resolveClickTarget\(page\.locator\("#submit"\), [^)]*"", ""\)/);
});

void test('intent matching requires every meaningful word, so it cannot select an opposite action', () => {
    const script = build(clickCreate);

    // "Create ticket" must never resolve to "Delete ticket".
    assert.match(script, /if \(matched !== words\.length\) \{ continue; \}/);
    assert.match(script, /\.isVisible\(\)/);
    assert.match(script, /\.isEnabled\(\)/);
});

void test('an adapted target is recorded as evidence rather than silently substituted', () => {
    const script = build(clickCreate);

    assert.match(script, /adaptedTargets\.push\(\{ requested: name, resolved: bestName \}\)/);
    // Evidence is only useful if it reaches the caller on both the success and failure paths.
    assert.equal(script.match(/invalidFields, ambiguousTargets, adaptedTargets,/g)?.length, 2);
});

void test('assertions stay strict so an adapted click cannot mask a broken app', () => {
    const script = build(clickCreate);

    const assertionLines = script.split('\n').filter(line => line.includes('assertionsCompleted++'));
    assert.ok(assertionLines.length > 0, 'expected at least one assertion line');
    for (const line of assertionLines) {
        assert.ok(
            !/catch\(\(\) => false\)/.test(line),
            `assertion must not swallow failures: ${line}`,
        );
    }
});

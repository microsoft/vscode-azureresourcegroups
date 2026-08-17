/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserProbeScript } from '../src/SandboxLocalRuntimeValidator';
import type { LocalAcceptanceProbe } from '../src/scenario';

type BrowserContract = NonNullable<LocalAcceptanceProbe['browser']>;

function contract(overrides: Partial<BrowserContract> = {}): BrowserContract {
    return {
        expectedText: 'ticket',
        requireInteractiveElements: true,
        actions: [
            { kind: 'click', selectorType: 'role', role: 'button', selector: 'Create ticket' },
            { kind: 'fillForm', values: { Subject: 'Browser acceptance ticket' } },
        ],
        assertions: [
            { kind: 'text', selectorType: 'css', selector: 'body', value: 'Browser acceptance ticket' },
        ],
        ...overrides,
    } as BrowserContract;
}

void test('the load contract is asserted before the journey drives the UI', () => {
    const script = createBrowserProbeScript('http://localhost:5173', contract());
    const loadAssertion = script.indexOf('Rendered page does not include expected text');
    const interactive = script.indexOf('Rendered page has no interactive elements');
    const firstAction = script.indexOf('await (await resolveClickTarget(');
    assert.ok(loadAssertion > 0 && interactive > 0 && firstAction > 0);
    assert.ok(
        loadAssertion < firstAction && interactive < firstAction,
        'a mis-resolved selector must never prevent the load contract from being evaluated',
    );
});

void test('an advisory journey records its failure instead of failing the probe', () => {
    const script = createBrowserProbeScript('http://localhost:5173', contract({ journeySeverity: 'advisory' }));
    assert.match(script, /journeyStatus = 'failed'/u);
    assert.match(script, /Browser journey did not complete \(advisory\)/u);
    assert.doesNotMatch(
        script,
        /journeyError = [^\n]*\n\s*throw error;/u,
        'an advisory journey must not rethrow into the probe-level failure path',
    );
});

void test('a required journey keeps failing the probe', () => {
    const required = createBrowserProbeScript('http://localhost:5173', contract({ journeySeverity: 'required' }));
    const omitted = createBrowserProbeScript('http://localhost:5173', contract());
    for (const script of [required, omitted]) {
        assert.match(script, /journeyStatus = 'failed';\njourneyError = [^\n]*\nthrow error;/u);
    }
    assert.equal(required, omitted, 'omitting journeySeverity must keep the enforcing behaviour');
});

void test('a form fill that filled nothing is not counted as a completed action', () => {
    const script = createBrowserProbeScript('http://localhost:5173', contract());
    assert.match(script, /if \(formFieldsFilled\.length === before\)/u);
    assert.match(script, /no form field was filled/u);
    assert.match(script, /throw new Error\('Form fill completed without filling any field\.'\)/u);
    const fillBlock = script.slice(script.indexOf('await fillDiscoveredForm'));
    const guard = fillBlock.indexOf('formFieldsFilled.length === before');
    const increment = fillBlock.indexOf('actionsCompleted++');
    assert.ok(guard >= 0 && increment > guard, 'the count must come after the guard, never before it');
});

void test('every action records whether it observably changed the page', () => {
    const script = createBrowserProbeScript('http://localhost:5173', contract());
    assert.match(script, /const pageSignature = async \(\)/u);
    assert.match(script, /const recordEffect = async \(action, before\)/u);
    assert.match(script, /the page did not change/u);
    assert.match(script, /await recordEffect\(/u);
});

void test('the emitted payload carries the load and journey verdicts separately', () => {
    const script = createBrowserProbeScript('http://localhost:5173', contract({ journeySeverity: 'advisory' }));
    for (const field of ['loadPassed', 'journeyStatus', 'journeyError', 'actionsEffective', 'actionLedger']) {
        assert.ok(script.includes(field), `payload must report ${field}`);
    }
    assert.equal(
        script.match(/journeySeverity: "advisory"/gu)?.length,
        2,
        'both the success and the failure payload must state which contract was enforced',
    );
});

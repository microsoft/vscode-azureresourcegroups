/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserProbeScript } from '../src/SandboxLocalRuntimeValidator';

/**
 * The browser probe used to hard-code a form shape the scenario prompt never specified, so a
 * generated app that added its own required field (a `Customer` input, in the observed run) was
 * scored as a product failure. Discovery must happen at runtime instead.
 */
const build = (actions: unknown[]): string => createBrowserProbeScript('http://127.0.0.1:5173', {
    expectedText: 'ticket',
    actions,
    assertions: [{ kind: 'text', selector: 'body', value: 'Browser acceptance ticket' }],
} as never);

void test('a fillForm action compiles to runtime discovery, not a fixed field list', () => {
    const script = build([{ kind: 'fillForm', values: { Subject: 'Browser acceptance ticket' } }]);
    assert.match(script, /await fillDiscoveredForm\(/u);
    assert.match(script, /discoverFields/u);
    // The scenario's own value must still be honoured.
    assert.match(script, /"Subject":"Browser acceptance ticket"/u);
});

void test('discovery fills required fields the scenario never named', () => {
    const script = build([{ kind: 'fillForm', values: {} }]);
    assert.match(script, /if \(match === undefined && !field\.required\) continue;/u);
    assert.match(script, /synthesizeValue/u);
});

void test('the generated script is syntactically valid JavaScript', () => {
    const script = build([
        { kind: 'click', selector: 'Create ticket', selectorType: 'role', role: 'button' },
        { kind: 'fillForm', values: { Subject: 'A "quoted" \'value\'' } },
    ]);
    // The probe is assembled by string concatenation, so escaping errors are a real risk.
    assert.doesNotThrow(() => new Function(script));
});

void test('unsatisfiable and invalid fields are reported for diagnosis', () => {
    const script = build([{ kind: 'fillForm', values: {} }]);
    assert.match(script, /formFieldsUnsatisfiable/u);
    assert.match(script, /collectInvalidFields/u);
    assert.match(script, /validationMessage/u);
    // Both the success and failure payloads must carry the evidence.
    assert.equal(script.match(/formFieldsFilled, formFieldsUnsatisfiable, invalidFields/gu)?.length, 2);
});

void test('a field constrained by a pattern is satisfied before being reported', () => {
    const script = build([{ kind: 'fillForm', values: {} }]);
    assert.match(script, /applyPattern/u);
    assert.match(script, /no value satisfies pattern/u);
});

void test('assertions remain strict and are never made optional', () => {
    // Adaptive filling must not leak into the outcome check, or the gate stops proving anything.
    const script = build([{ kind: 'fillForm', values: {} }]);
    const assertionLine = script.split('\n').find(line => line.includes('hasText'));
    assert.ok(assertionLine);
    assert.doesNotMatch(assertionLine, /catch\(\(\) => false\)/u);
});

void test('explicit fill and click actions still compile unchanged', () => {
    const script = build([
        { kind: 'fill', selector: 'Subject', selectorType: 'label', value: 'x' },
        { kind: 'click', selector: 'Create ticket', selectorType: 'role', role: 'button' },
    ]);
    assert.match(script, /page\.getByLabel\("Subject"\)\.fill\("x"\)/u);
    // Clicks now route through resolveClickTarget so a label shared by a header CTA and a form
    // submit button no longer trips Playwright strict mode on an otherwise working app.
    assert.match(
        script,
        /resolveClickTarget\(page\.getByRole\("button", \{ name: "Create ticket", exact: true \}\), [^)]+\)\)\.click\(\)/u,
    );
});

void test('ambiguous clicks prefer the filled form’s own submit control', () => {
    const script = build([
        { kind: 'fillForm', values: {} },
        { kind: 'click', selector: 'Create ticket', selectorType: 'role', role: 'button' },
    ]);
    // The scoring must consider form membership, submit type, and only usable candidates.
    // formFieldsFilled is an array, so the guard must test its length: comparing the array itself
    // to 0 is always false, which silently disabled the form-membership preference entirely.
    assert.match(script, /formFieldsFilled\.length > 0 && inForm \? 4 : 0/u);
    assert.match(script, /isSubmit \? 2 : 0/u);
    assert.match(script, /el\.closest\('form'\)/u);
    // Ambiguity must be recorded as evidence rather than silently resolved.
    assert.match(script, /ambiguousTargets\.push\(\{ target: label, matches: count \}\)/u);
    assert.match(script, /ambiguousTargets,/u);
});

void test('assertions remain strict after the click fix', () => {
    const script = build([{ kind: 'click', selector: 'Create ticket', selectorType: 'role', role: 'button' }]);
    const assertionLines = script.split('\n').filter(line => line.includes('assertionsCompleted++'));
    assert.ok(assertionLines.length > 0, 'expected at least one assertion line');
    for (const line of assertionLines) {
        assert.ok(!line.includes('catch(() => false)'), `assertion must not swallow failures: ${line}`);
    }
});

void test('checkbox, radio, and file controls are left alone', () => {
    // These need a different interaction and are rarely the subject of a create-entity journey.
    const script = build([{ kind: 'fillForm', values: {} }]);
    assert.match(script, /'checkbox', 'radio', 'file'/u);
});

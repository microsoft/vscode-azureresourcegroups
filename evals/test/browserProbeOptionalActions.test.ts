/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { createBrowserProbeScript } from '../src/SandboxLocalRuntimeValidator';

void test('a required fill action compiles to an unguarded call', () => {
    const script = createBrowserProbeScript('http://127.0.0.1:5173/', {
        actions: [{ kind: 'fill', selector: 'Subject', selectorType: 'label', value: 'Ticket' }],
    });

    assert.match(script, /await page\.getByLabel\("Subject"\)\.fill\("Ticket"\); actionsCompleted\+\+;/);
    assert.ok(!script.includes('actionsSkipped.push("fill Subject")'));
});

void test('an optional fill action is skipped when the control is not editable', () => {
    // Reproduces the observed false negative: with mock authentication the requester is the
    // signed-in user, so the generated app renders a disabled dropdown. That is a valid design
    // the prompt never constrained, and it must not be recorded as a product failure.
    const script = createBrowserProbeScript('http://127.0.0.1:5173/', {
        actions: [{ kind: 'fill', selector: 'Requester', selectorType: 'label', value: 'Evaluation User', optional: true }],
    });

    assert.match(script, /isEditable\(\{ timeout: 2000 \}\)\.catch\(\(\) => false\)/);
    assert.match(script, /actionsSkipped\.push\("fill Requester"\)/);
});

void test('an optional click action probes enablement rather than editability', () => {
    const script = createBrowserProbeScript('http://127.0.0.1:5173/', {
        actions: [{ kind: 'click', selector: 'Archive', selectorType: 'role', role: 'button', optional: true }],
    });

    assert.match(script, /isEnabled\(\{ timeout: 2000 \}\)/);
    assert.ok(!script.includes('isEditable'));
});

void test('skipped actions are reported on both the success and failure paths', () => {
    const script = createBrowserProbeScript('http://127.0.0.1:5173/', {
        actions: [{ kind: 'fill', selector: 'Requester', selectorType: 'label', value: 'x', optional: true }],
    });

    const occurrences = script.split('actionsSkipped,').length - 1;
    assert.equal(occurrences, 2, 'both stdout payloads should report skipped actions');
    assert.match(script, /const actionsSkipped = \[\];/);
});

void test('assertions stay strict regardless of optional actions', () => {
    // Making an action optional must not weaken the acceptance criteria the prompt does require.
    const script = createBrowserProbeScript('http://127.0.0.1:5173/', {
        actions: [{ kind: 'fill', selector: 'Requester', selectorType: 'label', value: 'x', optional: true }],
        assertions: [{ kind: 'visible', selector: 'text=Ticket details' }],
    });

    assert.match(script, /Expected text=Ticket details to be visible\./);
    assert.ok(!script.includes('actionsSkipped.push("visible'));
});

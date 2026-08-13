/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { describeBrowserFormFailure } from '../src/vallyRunDiagnostics';

function payload(evidence: Record<string, unknown>): string {
    return `some stderr\n${JSON.stringify({ title: 'Support tickets', ...evidence })}\n`;
}

void test('a probe that never filled the form is not described as having submitted it', () => {
    // The shape recorded by the 2026-08-13 run: three actions reported complete while the fill
    // list was empty, which sent readers looking for an application defect that did not exist.
    const message = describeBrowserFormFailure(payload({
        formFieldsFilled: [],
        assertionsCompleted: 0,
        actionsCompleted: 3,
        actionLedger: [
            { action: 'click Create ticket', effective: false, reason: 'the page did not change' },
        ],
    }));
    assert.ok(message);
    assert.doesNotMatch(message, /was filled and submitted/u);
    assert.match(message, /could not drive the UI/u);
    assert.match(message, /not necessarily an application defect/u);
});

void test('an empty fill list is called out even without a ledger', () => {
    const message = describeBrowserFormFailure(payload({
        formFieldsFilled: [],
        assertionsCompleted: 0,
    }));
    assert.ok(message);
    assert.doesNotMatch(message, /was filled and submitted/u);
    assert.match(message, /No form field was filled/u);
});

void test('a genuinely submitted form that produced nothing still reads as an app defect', () => {
    const message = describeBrowserFormFailure(payload({
        formFieldsFilled: ['Subject=Browser acceptance ticket'],
        assertionsCompleted: 0,
        actionLedger: [{ action: 'fillForm Subject', effective: true }],
    }));
    assert.equal(message, 'The form was filled and submitted, but the expected result never appeared on the page.');
});

void test('browser-rejected fields keep priority over the interaction narrative', () => {
    const message = describeBrowserFormFailure(payload({
        invalidFields: ['Subject: Please fill out this field.'],
        formFieldsFilled: [],
        assertionsCompleted: 0,
        actionLedger: [{ action: 'click Create ticket', effective: false }],
    }));
    assert.match(message ?? '', /the browser rejected a field/u);
});

void test('a fully effective run produces no form diagnosis', () => {
    assert.equal(
        describeBrowserFormFailure(payload({
            formFieldsFilled: ['Subject=x'],
            assertionsCompleted: 1,
            actionLedger: [{ action: 'fillForm Subject', effective: true }],
        })),
        undefined,
    );
});

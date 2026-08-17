/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { browserJourneyVerdict, browserLoadVerdict, persistenceVerdict } from '../src/vallyAcaExecutor';

void test('the browser gate reads the load contract, not the journey', () => {
    assert.deepEqual(
        browserLoadVerdict([{ success: true, loadPassed: true }]),
        { passed: true, present: true },
        'a failed journey must not claim the app did not load',
    );
    assert.deepEqual(
        browserLoadVerdict([{ success: false, loadPassed: false }]),
        { passed: false, present: true },
    );
});

void test('evidence predating the split is read as a load result', () => {
    assert.equal(browserLoadVerdict([{ success: true }]).passed, true);
    assert.equal(browserLoadVerdict([{ success: false }]).passed, false);
});

void test('one probe that never loaded fails the gate even when another did', () => {
    assert.equal(browserLoadVerdict([{ loadPassed: true }, { loadPassed: false }]).passed, false);
});

void test('the journey gate is absent when no journey was recorded', () => {
    assert.deepEqual(
        browserJourneyVerdict([{}]),
        { passed: false, present: false },
        'a probe that never reported a journey must not synthesise one',
    );
});

void test('the journey gate reports its recorded status', () => {
    assert.equal(browserJourneyVerdict([{ journeyStatus: 'passed' }]).passed, true);
    assert.equal(browserJourneyVerdict([{ journeyStatus: 'failed' }]).passed, false);
    assert.equal(browserJourneyVerdict([{ journeyStatus: 'not-attempted' }]).passed, false);
    assert.equal(browserJourneyVerdict([{ journeyStatus: 'not-attempted' }]).present, true);
});

void test('a skipped persistence check is absent rather than failed', () => {
    assert.deepEqual(
        persistenceVerdict([{ success: false, skipped: true }]),
        { passed: false, present: false },
        'an unattempted check is not evidence of a persistence defect',
    );
});

void test('a real persistence failure still fails', () => {
    assert.deepEqual(persistenceVerdict([{ success: false }]), { passed: false, present: true });
});

void test('a genuine persistence pass survives the skip path', () => {
    assert.deepEqual(persistenceVerdict([{ success: true }]), { passed: true, present: true });
});

void test('a skipped check cannot mask a real failure alongside it', () => {
    assert.deepEqual(
        persistenceVerdict([{ success: false, skipped: true }, { success: false }]),
        { passed: false, present: true },
    );
});

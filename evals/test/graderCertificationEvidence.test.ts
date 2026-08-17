/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { missingGateEvidence } from '../src/graderCertification';

/**
 * The golden certification case is the control experiment for every other gate, so the assertion
 * that keeps it honest needs its own control. Three times now a gate has reported success purely
 * because it never ran; these tests pin the behaviour that catches that.
 */
const healthy = {
    commands: [{ kind: 'debugger' }],
    probes: [{}],
    browserChecks: [{ journeyStatus: 'passed', accessibilityScanned: true }],
    persistenceChecks: [{ skipped: false }],
    securityChecks: [{}],
};

void test('reports nothing missing when every validator left evidence', () => {
    const missing = missingGateEvidence(
        ['local-runtime', 'browser', 'accessibility', 'persistence', 'debugger-readiness', 'security'],
        healthy,
    );
    assert.deepEqual(missing, []);
});

void test('a security gate that produced no evidence is flagged', () => {
    assert.deepEqual(
        missingGateEvidence(['security'], { ...healthy, securityChecks: [] }),
        ['security produced no evidence'],
    );
});

void test('a security gate whose evidence key is absent entirely is flagged', () => {
    assert.deepEqual(
        missingGateEvidence(['security'], { ...healthy, securityChecks: undefined }),
        ['security produced no evidence'],
    );
});

void test('a debugger gate that ran no debugger command is flagged', () => {
    assert.deepEqual(
        missingGateEvidence(['debugger-readiness'], { ...healthy, commands: [{ kind: 'task' }] }),
        ['debugger-readiness produced no debugger evidence'],
    );
});

void test('a skipped persistence check counts as absent evidence', () => {
    assert.deepEqual(
        missingGateEvidence(['persistence'], { ...healthy, persistenceChecks: [{ skipped: true }] }),
        ['persistence produced no unskipped evidence'],
    );
});

void test('an incomplete browser journey counts as absent evidence', () => {
    assert.deepEqual(
        missingGateEvidence(
            ['browser'],
            { ...healthy, browserChecks: [{ journeyStatus: 'skipped', accessibilityScanned: true }] },
        ),
        ['browser produced no completed journey evidence'],
    );
});

void test('every missing validator is reported rather than stopping at the first', () => {
    assert.deepEqual(
        missingGateEvidence(['security', 'debugger-readiness'], {
            commands: [],
            probes: [],
            browserChecks: [],
            persistenceChecks: [],
            securityChecks: [],
        }),
        [
            'security produced no evidence',
            'debugger-readiness produced no debugger evidence',
        ],
    );
});

void test('validators that carry no evidence rule are ignored', () => {
    assert.deepEqual(missingGateEvidence(['project-build', 'cleanup'], healthy), []);
});

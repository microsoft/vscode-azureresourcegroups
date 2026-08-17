/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { LocalAcceptanceProbe } from '../src/scenario';
import {
    isSecurityPlanConclusive,
    malformedBearerToken,
    planSecurityChecks,
} from '../src/securityChecks';
import { securityVerdict } from '../src/vallyAcaExecutor';

const probes: LocalAcceptanceProbe[] = [
    { name: 'health', target: 'backend', url: 'http://127.0.0.1:7071/api/health' },
    { name: 'tickets', target: 'backend', url: 'http://127.0.0.1:7071/api/tickets' },
    { name: 'home', target: 'frontend', url: 'http://127.0.0.1:5173/' },
];

void test('protected paths default to declared backend probes that are not public', () => {
    // Authoring a full route inventory per app is the maintenance burden this design avoids.
    const checks = planSecurityChecks({ publicPaths: ['/api/health'] }, probes);
    const unauthenticated = checks.filter(check => check.kind === 'unauthenticated');
    assert.deepEqual(unauthenticated.map(check => check.url), ['http://127.0.0.1:7071/api/tickets']);
});

void test('a public path is checked for 200 so the refusal is proven selective', () => {
    const checks = planSecurityChecks({ publicPaths: ['/api/health'] }, probes);
    const publicCheck = checks.find(check => check.kind === 'public');
    assert.equal(publicCheck?.url, 'http://127.0.0.1:7071/api/health');
    assert.deepEqual(publicCheck?.expectedStatuses, [200]);
});

void test('frontend probes are not treated as protected API surface', () => {
    const checks = planSecurityChecks({ publicPaths: ['/api/health'] }, probes);
    assert.ok(checks.every(check => !check.url.includes('5173')));
});

void test('every protected path is also probed with a malformed bearer token', () => {
    // An app that only checks for the presence of an Authorization header passes the
    // unauthenticated check and must still be caught here.
    const checks = planSecurityChecks({ publicPaths: ['/api/health'] }, probes);
    const malformed = checks.find(check => check.kind === 'malformed-token');
    assert.equal(malformed?.headers?.Authorization, malformedBearerToken);
    assert.equal(malformed?.url, 'http://127.0.0.1:7071/api/tickets');
});

void test('401 and 403 both count as a correct refusal by default', () => {
    const checks = planSecurityChecks({ publicPaths: ['/api/health'] }, probes);
    const unauthenticated = checks.find(check => check.kind === 'unauthenticated');
    assert.deepEqual(unauthenticated?.expectedStatuses, [401, 403]);
});

void test('relative protected paths resolve against the backend origin', () => {
    const checks = planSecurityChecks(
        { publicPaths: ['/api/health'], protectedPaths: ['/api/reviews'] },
        probes,
    );
    assert.ok(checks.some(check => check.url === 'http://127.0.0.1:7071/api/reviews'));
});

void test('a plan with no protected path is not conclusive', () => {
    // Without a protected path there is nothing to refuse, so passing would mean nothing.
    const checks = planSecurityChecks({ publicPaths: ['/api/health'] }, [probes[0]]);
    assert.equal(isSecurityPlanConclusive(checks), false);
});

void test('an app that serves protected data unauthenticated fails the gate', () => {
    assert.equal(
        securityVerdict([
            { kind: 'public', success: true },
            { kind: 'unauthenticated', success: false },
            { kind: 'malformed-token', success: true },
        ]).passed,
        false,
    );
});

void test('an app that refuses everything, including its health path, fails the gate', () => {
    // A crashed or blanket-deny app refuses every negative check. Requiring the public control
    // stops that from being scored as a security pass.
    assert.equal(
        securityVerdict([
            { kind: 'public', success: false },
            { kind: 'unauthenticated', success: true },
        ]).passed,
        false,
    );
});

void test('evidence without any public control is never a pass', () => {
    assert.equal(
        securityVerdict([
            { kind: 'unauthenticated', success: true },
            { kind: 'malformed-token', success: true },
        ]).passed,
        false,
    );
});

void test('a correctly enforcing app passes the gate', () => {
    const verdict = securityVerdict([
        { kind: 'public', success: true },
        { kind: 'unauthenticated', success: true },
        { kind: 'malformed-token', success: true },
    ]);
    assert.equal(verdict.passed, true);
    assert.equal(verdict.present, true);
});

void test('no security evidence is reported as absent rather than failed', () => {
    // Absent evidence and a failed check are different release signals.
    assert.deepEqual(securityVerdict([]), { passed: false, present: false });
});

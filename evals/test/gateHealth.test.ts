/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeGateHealth } from '../src/gateHealth';

/**
 * A gate blocked by an upstream failure is persisted with status `failed`, because a required gate
 * that never ran must not be scored as a pass. Rolling those into per-gate failure counts, however,
 * manufactures failures the product never earned: `persistence` accumulated 78 lifetime "failures"
 * of which zero were verdicts it actually rendered, which is what hid the fact that the gate had
 * never once produced signal.
 */

function writeRun(root: string, run: string, gates: Record<string, unknown>): void {
    const dir = join(root, run, 'scenario', 'model', '0', 'artifacts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'cor-validation.json'), JSON.stringify({ gates }));
}

void test('an explicitly flagged cascade is counted as not-attempted, not failed', () => {
    const root = mkdtempSync(join(tmpdir(), 'gate-health-'));
    writeRun(root, 'run-a', {
        persistence: { status: 'failed', notAttempted: true, reason: 'anything at all' },
    });
    const persistence = analyzeGateHealth(root).get('persistence');
    assert.equal(persistence?.notAttempted, 1);
    assert.equal(persistence?.failed, 0, 'a gate that never ran did not fail');
});

void test('historical runs without the flag still fall back to the prose match', () => {
    const root = mkdtempSync(join(tmpdir(), 'gate-health-'));
    writeRun(root, 'run-a', {
        browser: {
            status: 'failed',
            reason: 'Not attempted because build/sandboxCommandFailed stopped dependent validation.',
        },
    });
    const browser = analyzeGateHealth(root).get('browser');
    assert.equal(browser?.notAttempted, 1);
    assert.equal(browser?.failed, 0);
});

void test('a genuine verdict is still counted as a real failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'gate-health-'));
    writeRun(root, 'run-a', {
        accessibility: { status: 'failed', reason: 'Accessibility violations exceeded 0: color-contrast' },
    });
    const accessibility = analyzeGateHealth(root).get('accessibility');
    assert.equal(accessibility?.failed, 1);
    assert.equal(accessibility?.notAttempted, 0);
});

void test('a gate that only ever cascaded is distinguishable from one that ran and failed', () => {
    const root = mkdtempSync(join(tmpdir(), 'gate-health-'));
    writeRun(root, 'run-a', {
        starved: { status: 'failed', notAttempted: true },
        broken: { status: 'failed', reason: 'the gate did not satisfy its authoritative contract' },
    });
    const tallies = analyzeGateHealth(root);
    assert.equal(tallies.get('starved')?.failed, 0);
    assert.equal(tallies.get('broken')?.failed, 1);
});

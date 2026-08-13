/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { progressMetrics } from '../src/vallyAcaExecutor';

type Gate = { status: 'passed' | 'failed' | 'not-applicable'; evidence?: string[]; reason?: string };

const RUNTIME_GATES = ['local-runtime', 'browser', 'browser-journey', 'accessibility', 'persistence', 'worker', 'debugger'];

function gates(overrides: Record<string, Gate['status']>): Record<string, Gate> {
    const all = [
        'planning', 'scaffold', 'build', 'test', 'integration',
        ...RUNTIME_GATES,
        'deployment', 'security', 'cleanup', 'model', 'provenance',
    ];
    return Object.fromEntries(all.map(name => [name, { status: overrides[name] ?? 'not-applicable' }]));
}

function applicability(required: string[]): Record<string, boolean> {
    const all = [
        'planning', 'scaffold', 'build', 'test', 'integration',
        ...RUNTIME_GATES,
        'deployment', 'security', 'cleanup', 'model', 'provenance',
    ];
    return Object.fromEntries(all.map(name => [name, required.includes(name)]));
}

void test('an advisory journey failure does not reduce the applicable gate count', () => {
    const required = ['build', 'local-runtime', 'browser', 'debugger'];
    const passing = progressMetrics(
        applicability(required),
        gates({
            build: 'passed',
            'local-runtime': 'passed',
            browser: 'passed',
            'browser-journey': 'passed',
            debugger: 'passed',
        }),
    );
    const advisoryFailure = progressMetrics(
        applicability(required),
        gates({
            build: 'passed',
            'local-runtime': 'passed',
            browser: 'passed',
            'browser-journey': 'failed',
            debugger: 'passed',
        }),
    );
    assert.equal(passing.gates_pass_ratio, 1);
    assert.equal(
        advisoryFailure.gates_pass_ratio,
        1,
        'a gate excluded from applicability must not drag down the release ratio',
    );
});

void test('an advisory journey outcome is still measured', () => {
    const metrics = progressMetrics(
        applicability(['build', 'local-runtime', 'browser']),
        gates({ build: 'passed', 'local-runtime': 'passed', browser: 'passed', 'browser-journey': 'failed' }),
    );
    assert.equal(metrics.browser_journey_status, 'failed');
    assert.equal(metrics.browser_journey_enforced, 0, 'the metric must state that it did not gate the run');
});

void test('an enforced journey is reported as enforced', () => {
    const metrics = progressMetrics(
        applicability(['build', 'local-runtime', 'browser', 'browser-journey']),
        gates({ build: 'passed', 'local-runtime': 'passed', browser: 'passed', 'browser-journey': 'failed' }),
    );
    assert.equal(metrics.browser_journey_enforced, 1);
    assert.ok((metrics.gates_pass_ratio as number) < 1, 'an enforced journey failure must lower the ratio');
});

void test('a journey that never ran reports no status rather than a false one', () => {
    const metrics = progressMetrics(
        applicability(['build']),
        gates({ build: 'passed' }),
    );
    assert.equal(metrics.browser_journey_status, undefined);
    assert.equal(metrics.browser_journey_enforced, undefined);
});

void test('splitting the gate lets a run reach the debugger with a failed journey', () => {
    const metrics = progressMetrics(
        applicability(['build', 'integration', 'local-runtime', 'browser', 'debugger']),
        gates({
            build: 'passed',
            integration: 'passed',
            'local-runtime': 'passed',
            browser: 'passed',
            'browser-journey': 'failed',
            debugger: 'passed',
        }),
    );
    assert.equal(metrics.furthest_gate_reached, 'complete');
    assert.equal(metrics.deepest_gate_passed, 'debugger');
});

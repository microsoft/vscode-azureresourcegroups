/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import test from 'node:test';
import { progressMetrics } from '../src/vallyAcaExecutor';

type GateStatus = 'passed' | 'failed' | 'not-applicable';

const CANARY_APPLICABILITY: Record<string, boolean> = {
    planning: true,
    scaffold: true,
    build: true,
    test: true,
    integration: true,
    'local-runtime': true,
    browser: true,
    accessibility: true,
    persistence: true,
    worker: false,
    debugger: true,
    deployment: false,
    security: false,
    cleanup: true,
    model: true,
    provenance: true,
};

function gatesFrom(statuses: Record<string, GateStatus>): Record<string, { status: GateStatus }> {
    return Object.fromEntries(
        Object.keys(CANARY_APPLICABILITY).map(name => [name, { status: statuses[name] ?? 'failed' }]),
    );
}

/** The 2026-08-13T15:05 run: died at the integration build. */
const BUILD_FAILURE_RUN = gatesFrom({
    planning: 'passed',
    scaffold: 'passed',
    build: 'failed',
    integration: 'failed',
    worker: 'not-applicable',
    deployment: 'not-applicable',
    security: 'not-applicable',
    cleanup: 'passed',
    model: 'passed',
    provenance: 'passed',
});

/** The 2026-08-13T16:47 run: product gates green, died at the browser probe. */
const BROWSER_FAILURE_RUN = gatesFrom({
    planning: 'passed',
    scaffold: 'passed',
    build: 'passed',
    test: 'passed',
    integration: 'passed',
    'local-runtime': 'failed',
    browser: 'failed',
    accessibility: 'failed',
    persistence: 'failed',
    worker: 'not-applicable',
    debugger: 'failed',
    deployment: 'not-applicable',
    security: 'not-applicable',
    cleanup: 'passed',
    model: 'passed',
    provenance: 'passed',
});

void test('a browser failure outranks a build failure', () => {
    // Both runs fail the binary hard gate identically. The regression this guards is that the
    // report gave them the same 0.0% score, hiding a large real quality difference.
    const early = progressMetrics(CANARY_APPLICABILITY, BUILD_FAILURE_RUN as never);
    const late = progressMetrics(CANARY_APPLICABILITY, BROWSER_FAILURE_RUN as never);

    assert.ok(
        (late.gates_passed as number) > (early.gates_passed as number),
        `expected the browser-failure run to pass more gates, got ${String(late.gates_passed)} vs ${String(early.gates_passed)}`,
    );
    assert.ok((late.furthest_gate_depth as number) > (early.furthest_gate_depth as number));
});

void test('furthest gate reached names the first unmet pipeline gate', () => {
    assert.strictEqual(progressMetrics(CANARY_APPLICABILITY, BUILD_FAILURE_RUN as never).furthest_gate_reached, 'build');
    assert.strictEqual(
        progressMetrics(CANARY_APPLICABILITY, BROWSER_FAILURE_RUN as never).furthest_gate_reached,
        'local-runtime',
    );
});

void test('group counts separate product health from runtime health', () => {
    const late = progressMetrics(CANARY_APPLICABILITY, BROWSER_FAILURE_RUN as never);

    assert.strictEqual(late.product_gates_passed, 5);
    assert.strictEqual(late.product_gates_applicable, 5);
    assert.strictEqual(late.runtime_gates_passed, 0);
    assert.strictEqual(late.runtime_gates_applicable, 5);
});

void test('non-applicable gates are excluded from every denominator', () => {
    const late = progressMetrics(CANARY_APPLICABILITY, BROWSER_FAILURE_RUN as never);

    assert.strictEqual(late.gates_applicable, 13, 'worker, deployment, and security are not applicable');
    assert.strictEqual(late.operations_gates_applicable, 1, 'only cleanup applies');
});

void test('an all-passing run reports complete depth', () => {
    const perfect = gatesFrom(Object.fromEntries(
        Object.entries(CANARY_APPLICABILITY).map(([name, applicable]) => [
            name,
            applicable ? 'passed' : 'not-applicable',
        ]),
    ) as Record<string, GateStatus>);
    const metrics = progressMetrics(CANARY_APPLICABILITY, perfect as never);

    assert.strictEqual(metrics.furthest_gate_reached, 'complete');
    assert.strictEqual(metrics.pipeline_depth_ratio, 1);
    assert.strictEqual(metrics.gates_pass_ratio, 1);
});

void test('progress metrics never claim success for a failing run', () => {
    // Anti-gaming: a gradient must not be mistakable for a pass.
    const early = progressMetrics(CANARY_APPLICABILITY, BUILD_FAILURE_RUN as never);

    assert.ok((early.gates_pass_ratio as number) < 1);
    assert.ok((early.pipeline_depth_ratio as number) < 1);
    assert.notStrictEqual(early.furthest_gate_reached, 'complete');
});

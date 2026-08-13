/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import test from 'node:test';
import {
    createStageRepairBudgets,
    totalUsedAgentRepairs,
    tryConsumeAgentRepair,
} from '../src/evaluationParity';

void test('each stage receives its own independent repair budget', () => {
    const budgets = createStageRepairBudgets(2);

    assert.strictEqual(budgets.build.maxRetries, 2);
    assert.strictEqual(budgets.integration.maxRetries, 2);
    assert.strictEqual(budgets.local.maxRetries, 2);
});

void test('exhausting the build budget does not starve integration or local', () => {
    const budgets = createStageRepairBudgets(2);

    assert.strictEqual(tryConsumeAgentRepair(budgets.build), 1);
    assert.strictEqual(tryConsumeAgentRepair(budgets.build), 2);
    assert.strictEqual(tryConsumeAgentRepair(budgets.build), undefined, 'build budget should be exhausted');

    // The regression this guards: a shared pool left local-runtime with zero repairs whenever the
    // product gates consumed every retry, so a trivially fixable browser failure was never repaired.
    assert.strictEqual(tryConsumeAgentRepair(budgets.integration), 1);
    assert.strictEqual(tryConsumeAgentRepair(budgets.local), 1);
});

void test('total used repairs sums every stage', () => {
    const budgets = createStageRepairBudgets(3);

    tryConsumeAgentRepair(budgets.build);
    tryConsumeAgentRepair(budgets.build);
    tryConsumeAgentRepair(budgets.integration);
    tryConsumeAgentRepair(budgets.local);

    assert.strictEqual(totalUsedAgentRepairs(budgets), 4);
});

void test('a zero budget disables repairs on every stage', () => {
    const budgets = createStageRepairBudgets(0);

    assert.strictEqual(tryConsumeAgentRepair(budgets.build), undefined);
    assert.strictEqual(tryConsumeAgentRepair(budgets.integration), undefined);
    assert.strictEqual(tryConsumeAgentRepair(budgets.local), undefined);
    assert.strictEqual(totalUsedAgentRepairs(budgets), 0);
});

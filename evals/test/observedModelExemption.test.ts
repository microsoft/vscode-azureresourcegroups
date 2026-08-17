/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { __testing } from '../src/vallyAcaExecutor';

/**
 * A GitHub auth outage on 2026-08-17 failed all 20 trials of a matrix run. The native runner
 * classified every one of them `harness_failure`, and vally already knows to exclude those from
 * product quality -- but the model-observation assertion threw first, converting the classified
 * failure into an unclassified executor error that scored 0%. The eval reported the product at 0%
 * for GitHub's downtime.
 */

const base = {
    runId: 'r', scenarioId: 's', attempt: 1, durationMs: 0, stages: [],
    requestedModel: 'gpt-5.6-sol', model: 'gpt-5.6-sol', observedModels: [] as string[],
};

void test('a classified harness failure with no observed model is let through', () => {
    assert.doesNotThrow(() => __testing.assertObservedModel(
        { ...base, outcome: 'failed', failureCategory: 'harness_failure' },
        'gpt-5.6-sol',
    ));
});

void test('a classified infrastructure failure is let through', () => {
    assert.doesNotThrow(() => __testing.assertObservedModel(
        { ...base, outcome: 'failed', failureCategory: 'infrastructure_failure' },
        'gpt-5.6-sol',
    ));
});

void test('a product failure must still prove which model produced it', () => {
    assert.throws(() => __testing.assertObservedModel(
        { ...base, outcome: 'failed', failureCategory: 'product_failure' },
        'gpt-5.6-sol',
    ), /did not observe requested model/);
});

void test('an unclassified failure must still prove which model produced it', () => {
    assert.throws(() => __testing.assertObservedModel(
        { ...base, outcome: 'failed' },
        'gpt-5.6-sol',
    ), /did not observe requested model/);
});

void test('a success can never skip model provenance', () => {
    assert.throws(() => __testing.assertObservedModel(
        { ...base, outcome: 'autonomous_success', failureCategory: 'harness_failure' },
        'gpt-5.6-sol',
    ), /did not observe requested model/);
});

void test('an observed model that is not the requested one still fails', () => {
    assert.throws(() => __testing.assertObservedModel(
        { ...base, observedModels: ['claude-sonnet-5'], outcome: 'failed', failureCategory: 'harness_failure' },
        'gpt-5.6-sol',
    ), /instead of requested model/);
});

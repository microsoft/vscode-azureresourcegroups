/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, UserCancelledError } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import * as vscode from 'vscode';
import { callWithTreeErrorHandling, normalizeTreeId } from '../src/utils/treeOperations';
import { wrapFunctionsInTelemetry, wrapFunctionsInTelemetrySync } from '../src/utils/wrapFunctionsInTelemetry';

suite('wrapFunctionsInTelemetry', () => {
    test('wrapped sync function returns a Promise', async () => {
        const functions = wrapFunctionsInTelemetry({ value: () => 'value' });
        const result = functions.value();
        assert.ok(result instanceof Promise);
        assert.strictEqual(await result, 'value');
    });

    test('wrapper rethrows ordinary errors and records failure', async () => {
        const failure = new Error('Failure');
        let context: IActionContext | undefined;
        const functions = wrapFunctionsInTelemetry({ fail: async () => { throw failure; } }, {
            beforeHook: value => { context = value; }
        });
        await assert.rejects(functions.fail(), error => error === failure);
        assert.strictEqual(context?.telemetry.properties.result, 'Failed');
    });

    test('sync wrapper rethrows ordinary errors and records failure', () => {
        const failure = new Error('Failure');
        let context: IActionContext | undefined;
        const functions = wrapFunctionsInTelemetrySync({ fail: () => { throw failure; } }, {
            beforeHook: value => { context = value; }
        });
        assert.throws(() => functions.fail(), error => error === failure);
        assert.strictEqual(context?.telemetry.properties.result, 'Failed');
    });
});

suite('explicit tree error handling', () => {
    for (const kind of ['user', 'VS Code', 'ordinary']) {
        test(`preserves ${kind} failures without affecting concurrent browsing`, async () => {
            const failure = kind === 'user' ? new UserCancelledError()
                : kind === 'VS Code' ? new vscode.CancellationError() : new Error('Failure');
            const fail = async () => { throw failure; };
            const results = await Promise.allSettled([
                callWithTreeErrorHandling('explicitTreeTest', fail, { propagateErrors: true }),
                callWithTreeErrorHandling('backgroundTreeTest', fail),
                callWithTreeErrorHandling('successfulTreeTest', async () => 'success', { propagateErrors: true })
            ]);
            assert.strictEqual(results[0].status, 'rejected');
            if (results[0].status === 'rejected') {
                assert.strictEqual(results[0].reason, failure);
            }
            assert.deepStrictEqual(results[1], { status: 'fulfilled', value: undefined });
            assert.deepStrictEqual(results[2], { status: 'fulfilled', value: 'success' });
        });
    }

    test('ARM identity matching does not lowercase case-sensitive child IDs', () => {
        const root = '/accounts/A/tenants/T/subscriptions/S/resourceGroups/R/providers/Microsoft.Web/sites/App';
        assert.strictEqual(normalizeTreeId(root + '/orders'), root.toLowerCase() + '/orders');
        assert.notStrictEqual(normalizeTreeId(root + '/orders'), normalizeTreeId(root + '/Orders'));
    });
});

export async function assertThrowsAsync<T>(block: () => Promise<T>): Promise<void> {
    await assert.rejects(block);
}

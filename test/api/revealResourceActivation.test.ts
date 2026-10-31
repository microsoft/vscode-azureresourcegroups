/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import * as vscode from 'vscode';
import { AzExtResourceType, AzureResource, BranchDataProvider, ResourceModelBase } from '../../api/src';
import { AzureResourceTreeDataProvider } from '../../src/tree/azure/AzureResourceTreeDataProvider';
import { getAccountAndTenantPrefix } from '../../src/tree/azure/idPrefix';
import { getCachedTestApi } from '../utils/testApiAccess';
import { api } from './api';
import { MockAzureSubscriptionProvider } from './MockAzureSubscriptionProvider';
import { createMockSubscriptionWithFunctions } from './mockServiceFactory';

interface ActivatedNode extends ResourceModelBase {
    id: string;
    parent?: ActivatedNode;
    marker: 'activated';
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(complete => { resolve = complete; });
    return { promise, resolve };
}

suite('Explicit reveals await branch extension activation', () => {
    const disposables: vscode.Disposable[] = [];
    let resourceId: string;
    let childId: string;
    let prefix: string;
    let rootNode: ActivatedNode;
    let childNode: ActivatedNode;
    let provider: BranchDataProvider<AzureResource, ActivatedNode>;
    let nativeReveals: number;
    let modelLoads: number;

    setup(async () => {
        const resources = createMockSubscriptionWithFunctions();
        resourceId = resources.functionApp1.id;
        childId = `${resourceId}/child`;
        const subscriptions = await new MockAzureSubscriptionProvider(resources).getAvailableSubscriptions();
        const subscription = subscriptions.find(candidate => candidate.subscriptionId === resources.sub1.subscriptionId);
        assert.ok(subscription);
        prefix = getAccountAndTenantPrefix(subscription);
        rootNode = { id: resourceId, marker: 'activated' };
        childNode = { id: childId, parent: rootNode, marker: 'activated' };
        nativeReveals = 0;
        modelLoads = 0;
        provider = {
            getResourceItem: () => { modelLoads++; return rootNode; },
            getChildren: node => node === rootNode ? [childNode] : [],
            getTreeItem: node => new vscode.TreeItem(node.id,
                node === rootNode ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None),
            getParent: node => node.parent
        };
        disposables.push(getCachedTestApi().testing.overrideAzureResourceReveal(async () => { nativeReveals++; }));
    });

    teardown(() => {
        while (disposables.length) {
            disposables.pop()?.dispose();
        }
        getCachedTestApi().testing.setOverrideAzureServiceFactory(undefined);
        getCachedTestApi().testing.setOverrideAzureSubscriptionProvider(undefined);
    });

    const registerProvider = () => disposables.push(
        api().registerAzureResourceBranchDataProvider(AzExtResourceType.FunctionApp, provider));
    const reveal = (id: string) => api().revealAzureResourceWithResult(id, {
        revealOptions: { select: false, focus: false, expand: false }
    });
    const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

    for (const grouping of ['resourceGroup', 'resourceType']) {
        for (const target of ['ARM root', 'provider child']) {
            test(`waits for delayed activation before revealing the ${target} with ${grouping} grouping`, async () => {
                const started = deferred();
                const release = deferred();
                let activations = 0;
                disposables.push(getCachedTestApi().testing.overrideAzureBranchActivation(async type => {
                    assert.strictEqual(type, AzExtResourceType.FunctionApp);
                    activations++;
                    started.resolve();
                    await release.promise;
                    registerProvider();
                }));
                await vscode.commands.executeCommand(`azureResourceGroups.groupBy.${grouping}`);
                const requestedId = target === 'ARM root' ? resourceId : childId;
                const pending = reveal(requestedId);
                let settled = false;
                void pending.then(() => { settled = true; }, () => { settled = true; });
                try {
                    await Promise.race([started.promise, pending.then(() => {
                        throw new Error('Reveal completed without starting branch activation');
                    })]);
                    await nextTurn();
                    assert.strictEqual(settled, false, 'An explicit reveal must wait for activation');
                    assert.strictEqual(modelLoads, 0);
                    assert.strictEqual(nativeReveals, 0);
                    assert.strictEqual(activations, 1);
                } finally {
                    release.resolve();
                    await pending;
                }
                const result = await pending;
                assert.strictEqual(result?.id, prefix + requestedId);
                assert.strictEqual(result?.resource, target === 'ARM root' ? rootNode : childNode);
                assert.strictEqual(nativeReveals, 1);
            });
        }
    }

    test('normal browsing stays non-blocking and its in-flight activation is shared with explicit reveals', async () => {
        const started = deferred();
        const release = deferred();
        let activations = 0;
        disposables.push(getCachedTestApi().testing.overrideAzureBranchActivation(async () => {
            activations++;
            started.resolve();
            await release.promise;
            registerProvider();
        }));
        const tree = api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
        const browsing = tree.findItemById(resourceId);
        let pending: ReturnType<typeof reveal> | undefined;
        try {
            const fallback = await browsing;
            await nextTurn();
            assert.strictEqual(fallback?.id, prefix + resourceId);
            assert.strictEqual(modelLoads, 0);
            pending = reveal(childId);
            let settled = false;
            void pending.then(() => { settled = true; }, () => { settled = true; });
            await nextTurn();
            assert.strictEqual(settled, false);
            assert.strictEqual(activations, 1);
        } finally {
            release.resolve();
            await browsing;
            await pending;
        }
        assert.strictEqual((await pending)?.resource, childNode);
    });

    test('concurrent explicit reveals wait for the same activation', async () => {
        const started = deferred();
        const release = deferred();
        let activations = 0;
        disposables.push(getCachedTestApi().testing.overrideAzureBranchActivation(async () => {
            activations++;
            started.resolve();
            await release.promise;
            registerProvider();
        }));
        const pending = Promise.all([reveal(resourceId), reveal(childId)]);
        try {
            await Promise.race([started.promise, pending.then(() => {
                throw new Error('Reveals completed without starting branch activation');
            })]);
            await nextTurn();
            assert.strictEqual(activations, 1);
            assert.strictEqual(nativeReveals, 0);
        } finally {
            release.resolve();
            await pending;
        }
        const [root, child] = await pending;
        assert.strictEqual(root?.resource, rootNode);
        assert.strictEqual(child?.resource, childNode);
    });

    test('a provider registered before activation completes does not let a second reveal skip the pending activation', async () => {
        const registered = deferred();
        const release = deferred();
        disposables.push(getCachedTestApi().testing.overrideAzureBranchActivation(async () => {
            registerProvider();
            registered.resolve();
            await release.promise;
        }));
        const first = reveal(resourceId);
        let second: ReturnType<typeof reveal> | undefined;
        try {
            await Promise.race([registered.promise, first.then(() => {
                throw new Error('Reveal completed without starting branch activation');
            })]);
            second = reveal(childId);
            await nextTurn();
            assert.strictEqual(modelLoads, 0);
            assert.strictEqual(nativeReveals, 0);
        } finally {
            release.resolve();
            await first;
            await second;
        }
        assert.strictEqual((await first)?.resource, rootNode);
        assert.strictEqual((await second)?.resource, childNode);
    });

    for (const kind of ['failure', 'user cancellation', 'VS Code cancellation']) {
        test(`preserves activation ${kind} and permits a later retry`, async () => {
            const error = kind === 'failure' ? new Error('Branch extension activation failed')
                : kind === 'user cancellation' ? new UserCancelledError() : new vscode.CancellationError();
            let shouldFail = true;
            let activations = 0;
            disposables.push(getCachedTestApi().testing.overrideAzureBranchActivation(async () => {
                activations++;
                if (shouldFail) {
                    throw error;
                }
                registerProvider();
            }));
            if (kind === 'failure') {
                await assert.rejects(reveal(resourceId), candidate => candidate === error);
            } else {
                assert.strictEqual(await reveal(resourceId), undefined);
            }
            assert.strictEqual(nativeReveals, 0, 'Activation failure must not reveal a fallback model');
            assert.strictEqual(modelLoads, 0);

            shouldFail = false;
            assert.strictEqual((await reveal(childId))?.resource, childNode);
            assert.strictEqual(activations, 2);
        });
    }

    test('does not activate an extension for an already registered provider', async () => {
        registerProvider();
        let activations = 0;
        disposables.push(getCachedTestApi().testing.overrideAzureBranchActivation(async () => { activations++; }));
        assert.strictEqual((await reveal(childId))?.resource, childNode);
        assert.strictEqual(activations, 0);
    });

    test('keeps the default fallback when activation finds no contributing provider', async () => {
        let activations = 0;
        disposables.push(getCachedTestApi().testing.overrideAzureBranchActivation(async () => { activations++; }));
        const result = await reveal(resourceId);
        assert.strictEqual(result?.id, prefix + resourceId);
        assert.ok(result?.resource);
        assert.strictEqual('marker' in result.resource, false);
        assert.strictEqual(activations, 1);
        assert.strictEqual(nativeReveals, 1);
    });

    test('normal browsing keeps its fallback and reports asynchronous activation failure', async () => {
        const error = new Error('Lazy branch activation failed');
        disposables.push(getCachedTestApi().testing.overrideAzureBranchActivation(async () => { throw error; }));
        const channel = getCachedTestApi().extensionVariables.getOutputChannel();
        const originalAppendLog = channel.appendLog;
        const logs: string[] = [];
        channel.appendLog = message => { logs.push(message); };
        try {
            const tree = api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
            assert.strictEqual((await tree.findItemById(resourceId))?.id, prefix + resourceId);
            await nextTurn();
            assert.ok(logs.some(message => message.includes(error.message)));
        } finally {
            channel.appendLog = originalAppendLog;
        }
    });
});

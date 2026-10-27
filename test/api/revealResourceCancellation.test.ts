/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import { AsyncResource } from 'async_hooks';
import * as vscode from 'vscode';
import { AzExtResourceType, AzureResource, BranchDataProvider, ResourceModelBase, ResourceTreeOperationContext } from '../../api/src';
import { AzureResourceTreeDataProvider } from '../../src/tree/azure/AzureResourceTreeDataProvider';
import { getAccountAndTenantPrefix } from '../../src/tree/azure/idPrefix';
import { getCachedTestApi } from '../utils/testApiAccess';
import { api } from './api';
import { MockAzureSubscriptionProvider } from './MockAzureSubscriptionProvider';
import { createMockAzureResourcesServiceFactory, createMockSubscriptionWithFunctions } from './mockServiceFactory';

interface RevealNode extends ResourceModelBase {
    id: string;
    parent?: RevealNode;
}

suite('Explicit resource operation isolation', () => {
    let disposable: vscode.Disposable;
    let revealOverride: vscode.Disposable | undefined;
    let resources: ReturnType<typeof createMockSubscriptionWithFunctions>;
    let service: ReturnType<ReturnType<typeof createMockAzureResourcesServiceFactory>>;
    let resourceId: string;
    let childId: string;
    let prefix: string;
    let failureMethod: 'getChildren' | 'getResourceItem' | 'getTreeItem' | undefined;
    let failureId: string;
    let failure: Error;
    let failureCalls: number;
    let siblingLoads: number;
    let lastChild: RevealNode | undefined;

    setup(async () => {
        resources = createMockSubscriptionWithFunctions();
        service = createMockAzureResourcesServiceFactory(resources)();
        resourceId = resources.functionApp1.id;
        childId = `${resourceId}/orders`;
        const subscriptions = await new MockAzureSubscriptionProvider(resources).getAvailableSubscriptions();
        const subscription = subscriptions.find(item => item.subscriptionId === resources.sub1.subscriptionId);
        assert.ok(subscription);
        prefix = getAccountAndTenantPrefix(subscription);
        failureMethod = undefined;
        failureId = resourceId;
        failure = new UserCancelledError();
        failureCalls = 0;
        siblingLoads = 0;
        lastChild = undefined;
        revealOverride = getCachedTestApi().testing.overrideAzureResourceReveal(async () => { /* accepted by VS Code */ });

        const fail = (method: typeof failureMethod, id: string, context?: ResourceTreeOperationContext) => {
            if (method === failureMethod && id === failureId) {
                failureCalls++;
                if (context?.propagateErrors) {
                    throw failure;
                }
                return true;
            }
            return false;
        };
        const provider: BranchDataProvider<AzureResource, RevealNode> = {
            getResourceItem: (resource, context) => {
                if (resource.id !== resourceId) {
                    siblingLoads++;
                }
                if (fail('getResourceItem', resource.id, context)) {
                    throw failure;
                }
                return { id: resource.id };
            },
            getChildren: (node, context) => {
                if (fail('getChildren', node.id, context)) {
                    return [];
                }
                if (node.id === resourceId) {
                    lastChild = { id: childId, parent: node };
                    return [{ id: `${resourceId}/Orders`, parent: node }, lastChild];
                }
                return [];
            },
            getTreeItem: node => {
                if (fail('getTreeItem', node.id)) {
                    throw failure;
                }
                return new vscode.TreeItem(node.id,
                    node.id === resourceId ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
            },
            getParent: node => node.parent
        };
        disposable = api().registerAzureResourceBranchDataProvider(AzExtResourceType.FunctionApp, provider);
    });

    teardown(() => {
        revealOverride?.dispose();
        disposable.dispose();
        getCachedTestApi().testing.setOverrideAzureServiceFactory(undefined);
        getCachedTestApi().testing.setOverrideAzureSubscriptionProvider(undefined);
    });

    const reveal = () => api().revealAzureResourceWithResult(childId, {
        revealOptions: { focus: false, select: false, expand: false }
    });

    for (const grouping of ['resourceGroup', 'resourceType']) {
        for (const method of ['getChildren', 'getResourceItem'] as const) {
            for (const kind of ['user cancellation', 'VS Code cancellation', 'failure']) {
                test(`${method} ${kind} propagates with ${grouping} grouping`, async () => {
                    await vscode.commands.executeCommand(`azureResourceGroups.groupBy.${grouping}`);
                    failureMethod = method;
                    failure = kind === 'user cancellation' ? new UserCancelledError()
                        : kind === 'VS Code cancellation' ? new vscode.CancellationError() : new Error('Loading failed');

                    if (kind === 'failure') {
                        await assert.rejects(reveal(), error => error === failure);
                    } else {
                        assert.strictEqual(await reveal(), undefined);
                    }
                    assert.ok(failureCalls > 0);

                    failureMethod = undefined;
                    const result = await reveal();
                    assert.strictEqual(result?.id, prefix + childId);
                    assert.strictEqual(result?.resource, lastChild);
                });
            }
        }

        test(`case-distinct siblings and unrelated resources cannot cancel a ${grouping} reveal`, async () => {
            await vscode.commands.executeCommand(`azureResourceGroups.groupBy.${grouping}`);
            failureMethod = 'getTreeItem';
            failureId = `${resourceId}/Orders`;
            const result = await reveal();
            assert.strictEqual(result?.id, prefix + childId);
            assert.strictEqual(result?.resource, lastChild);
            assert.strictEqual(failureCalls, 0);
            assert.strictEqual(siblingLoads, 0);
        });

        for (const method of ['listResources', 'listResourceGroups'] as const) {
            for (const kind of ['user cancellation', 'VS Code cancellation', 'failure']) {
                test(`${method} ${kind} propagates with ${grouping} grouping`, async () => {
                    await vscode.commands.executeCommand(`azureResourceGroups.groupBy.${grouping}`);
                    failure = kind === 'user cancellation' ? new UserCancelledError()
                        : kind === 'VS Code cancellation' ? new vscode.CancellationError() : new Error('Enumeration failed');
                    getCachedTestApi().testing.setOverrideAzureServiceFactory(() => ({
                        ...service, [method]: async () => { failureCalls++; throw failure; }
                    }));
                    if (kind === 'failure') {
                        await assert.rejects(reveal(), error => error === failure);
                    } else {
                        assert.strictEqual(await reveal(), undefined);
                    }
                    assert.ok(failureCalls > 0);
                });
            }
        }
    }

    test('a background root cancellation does not change a successful explicit reveal', async () => {
        const tree = api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
        const provider = new class extends MockAzureSubscriptionProvider {
            cancel = false;
            override async getAvailableSubscriptions(): Promise<AzureSubscription[]> {
                if (this.cancel) {
                    throw new UserCancelledError();
                }
                return super.getAvailableSubscriptions();
            }
        }(resources);
        getCachedTestApi().testing.setOverrideAzureSubscriptionProvider(() => provider);
        revealOverride?.dispose();
        revealOverride = getCachedTestApi().testing.overrideAzureResourceReveal(AsyncResource.bind(async () => {
            provider.cancel = true;
            assert.deepStrictEqual(await tree.getChildren(), []);
        }));
        assert.strictEqual((await reveal())?.id, prefix + childId);
    });

    test('an overlapping reveal cannot inherit another operation failure or async context', async () => {
        let release!: () => void;
        let started!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const entered = new Promise<void>(resolve => { started = resolve; });
        let secondRequest: (() => Promise<unknown>) | undefined;
        revealOverride?.dispose();
        revealOverride = getCachedTestApi().testing.overrideAzureResourceReveal(async () => {
            secondRequest = AsyncResource.bind(() => reveal());
            started();
            await gate;
        });
        const first = reveal();
        await entered;
        failureMethod = 'getChildren';
        failureId = resourceId;
        failure = new Error('Second operation failed');
        assert.ok(secondRequest);
        try {
            await assert.rejects(secondRequest(), error => error === failure);
        } finally {
            release();
        }
        assert.strictEqual((await first)?.id, prefix + childId);
    });

    test('native reveal rejection remains a failure', async () => {
        failure = new Error('Native reveal failed');
        revealOverride?.dispose();
        revealOverride = getCachedTestApi().testing.overrideAzureResourceReveal(async () => { throw failure; });
        await assert.rejects(reveal(), error => error === failure);
    });

    for (const kind of ['user cancellation', 'VS Code cancellation', 'failure']) {
        test(`root subscription ${kind} after initial resolution is preserved`, async () => {
            failure = kind === 'user cancellation' ? new UserCancelledError()
                : kind === 'VS Code cancellation' ? new vscode.CancellationError() : new Error('Root read failed');
            const provider = new class extends MockAzureSubscriptionProvider {
                override async getAvailableSubscriptions(
                    options?: Parameters<AzureSubscriptionProvider['getAvailableSubscriptions']>[0]
                ): Promise<AzureSubscription[]> {
                    if (options?.filter !== false) {
                        failureCalls++;
                        throw failure;
                    }
                    return super.getAvailableSubscriptions();
                }
            }(resources);
            getCachedTestApi().testing.setOverrideAzureSubscriptionProvider(() => provider);
            if (kind === 'failure') {
                await assert.rejects(reveal(), error => error === failure);
            } else {
                assert.strictEqual(await reveal(), undefined);
            }
            assert.ok(failureCalls > 0);
            assert.deepStrictEqual(await (api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider).getChildren(), []);
        });
    }

    test('ordinary browsing retains error placeholders for rendering failures', async () => {
        const tree = api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
        const node = await tree.findItemById(resourceId);
        assert.ok(node);
        failureMethod = 'getTreeItem';
        failure = new Error('Background rendering failed');
        assert.strictEqual((await tree.getTreeItem(node)).contextValue, 'invalidItem');
    });
});

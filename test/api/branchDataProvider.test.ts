import { commands, TreeItem } from "vscode";
import { AzExtResourceType, AzureResource, BranchDataItemWrapper, BranchDataProvider, ext, ResourceModelBase, WorkspaceResource, WorkspaceResourceProvider } from "../../extension.bundle";
import { TestBranchDataProvider } from "./TestBranchDataProvider";
import assert = require("assert");

const getWorkspaceResourceProviderStub: (onCalled?: () => void, resources?: WorkspaceResource[]) => WorkspaceResourceProvider = (onCalled, resources) => {
    return {
        getResources: async () => {
            onCalled?.();
            return resources ?? [];
        }
    }
}

const api = () => {
    return ext.v2.api.resources;
}

suite('Branch data provider tests', async () => {

    test('Provided workspace tree items are displayed', async () => {
        const workspaceResourceType = 'test2';
        const workspaceResource: WorkspaceResource = {
            resourceType: workspaceResourceType,
            id: 'test-resource-2',
            name: 'Test Resource 2',
        };
        const provider = getWorkspaceResourceProviderStub(undefined, [workspaceResource]);
        api().registerWorkspaceResourceProvider(provider);
        api().registerWorkspaceResourceBranchDataProvider(workspaceResourceType, {
            getResourceItem: (resource: WorkspaceResource): ResourceModelBase => {
                return resource;
            },
            getChildren: (_resource: WorkspaceResource): WorkspaceResource[] => {
                return [];
            },
            getTreeItem: (resource: WorkspaceResource): TreeItem => {
                return new TreeItem(resource.name);
            }
        })

        const children = await api().workspaceResourceTreeDataProvider.getChildren() as any[];
        const testChild = children.find(c => c.id === workspaceResource.id);
        assert.ok(testChild);
    });

    test('Provided workspace tree items children are displayed', async () => {
        const workspaceResourceType = 'test3';
        const workspaceResource: WorkspaceResource = {
            resourceType: workspaceResourceType,
            id: 'test-resource-3',
            name: 'Test Resource 3',
        };
        const provider = getWorkspaceResourceProviderStub(undefined, [workspaceResource]);
        api().registerWorkspaceResourceProvider(provider);
        api().registerWorkspaceResourceBranchDataProvider(workspaceResourceType, {
            getResourceItem: (resource: WorkspaceResource): ResourceModelBase => {
                return resource;
            },
            getChildren: (_resource: WorkspaceResource): WorkspaceResource[] => {
                return [
                    {
                        id: 'test-resource-3-child',
                        name: 'Test Resource 3 Child',
                        resourceType: workspaceResourceType,
                    }
                ];
            },
            getTreeItem: (resource: WorkspaceResource): TreeItem => {
                return new TreeItem(resource.name);
            }
        })

        const children = await api().workspaceResourceTreeDataProvider.getChildren() as any[];
        const testChild = children.find(c => c.id === workspaceResource.id);

        const testChildChildren = await api().workspaceResourceTreeDataProvider.getChildren(testChild) as any[];
        assert.strictEqual(testChildChildren.length, 1);
        assert.strictEqual(testChildChildren[0].id, 'test-resource-3-child');
    });

    test('BranchDataProvider.getTreeItem should be called for resource items', async () => {
        const workspaceResourceType = 'test-4';
        const workspaceResource: WorkspaceResource = {
            resourceType: workspaceResourceType,
            id: 'test-resource-3',
            name: 'Test Resource 3',
        };
        const provider = getWorkspaceResourceProviderStub(undefined, [workspaceResource]);
        api().registerWorkspaceResourceProvider(provider);

        const branchDataProvider = new TestBranchDataProvider();
        api().registerWorkspaceResourceBranchDataProvider(workspaceResourceType, branchDataProvider);

        const childResource: WorkspaceResource = {
            id: 'test-resource-child',
            name: 'Test Resource 3 Child',
            resourceType: workspaceResourceType,
        }

        branchDataProvider.registerChildren(workspaceResource, [childResource]);

        const rootChildren = await api().workspaceResourceTreeDataProvider.getChildren() as any[];
        const testChild = rootChildren.find(c => c.id === workspaceResource.id);
        branchDataProvider.assertGetTreeItemCalledAsync(async () => {
            await api().workspaceResourceTreeDataProvider.getTreeItem(testChild);
        });
    });

    test('BranchDataProvider.getTreeItem should be called for resource item children', async () => {
        const workspaceResource: WorkspaceResource = {
            resourceType: 'test56',
            id: 'test-resource-56',
            name: 'Test Resource 56',
        };

        const workspaceResourceChild: WorkspaceResource = {
            id: 'test-resource-child',
            name: 'Test Resource 3 Child',
            resourceType: workspaceResource.resourceType,
        };

        api().registerWorkspaceResourceProvider(getWorkspaceResourceProviderStub(undefined, [workspaceResource]));

        const branchDataProvider = new TestBranchDataProvider();
        branchDataProvider.registerChildren(workspaceResource, [workspaceResourceChild]);

        api().registerWorkspaceResourceBranchDataProvider(workspaceResource.resourceType, branchDataProvider);

        const workspaceResourceNodes = await api().workspaceResourceTreeDataProvider.getChildren() as WorkspaceResource[];
        const workspaceResourceNode = workspaceResourceNodes.find(c => c.id === workspaceResource.id);

        assert.ok(workspaceResourceNode, `No workspace resource node found with id: ${workspaceResource.id}. Workspace resource nodes: ${workspaceResourceNodes.map(item => item.id).join(', ')}`);

        const workspaceResourceChildNodes = await api().workspaceResourceTreeDataProvider.getChildren(workspaceResourceNode) as WorkspaceResource[];
        assert.strictEqual(workspaceResourceChildNodes.length, 1);

        const workspaceResourceChildNode = workspaceResourceChildNodes[0];
        assert.strictEqual(workspaceResourceChildNode.id, workspaceResourceChild.id);

        branchDataProvider.assertGetTreeItemCalledAsync(async () => {
            await api().workspaceResourceTreeDataProvider.getTreeItem(workspaceResourceChildNode);
        });
    });

    test('Registered Azure resource branch data provider is used', async () => {
        let getResourceItemIsCalled = false;
        const azureResourceBranchDataProvider: BranchDataProvider<AzureResource, ResourceModelBase> = {
            getResourceItem: (resource: AzureResource): ResourceModelBase => {
                getResourceItemIsCalled = true;
                return {
                    id: resource.id,
                }
            },
            getChildren: (_resource: AzureResource): AzureResource[] => {
                return [];
            },
            getTreeItem: (resource: AzureResource): TreeItem => {
                return new TreeItem(resource.name);
            }
        }

        api().registerAzureResourceBranchDataProvider(AzExtResourceType.FunctionApp, azureResourceBranchDataProvider);
        await commands.executeCommand('azureResourceGroups.groupBy.resourceType');

        const tdp = api().azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();

        const groups = await tdp.getChildren(subscriptions![0]) as TreeItem[];
        const functionGroup = groups!.find(g => g.label?.toString().includes('Func'));
        await tdp.getChildren(functionGroup);

        assert.strictEqual(getResourceItemIsCalled, true);
    });

    test('Tree should be resilliant to errors thrown in BranchDataProvider.getResourceItem', async () => {
        api().registerAzureResourceBranchDataProvider(AzExtResourceType.FunctionApp, {
            getResourceItem: (resource: AzureResource): ResourceModelBase => {
                if (resource.name === 'my-functionapp-1') {
                    throw new Error('Cannot find resource');
                }
                return resource;
            },
            getChildren: (_resource: AzureResource): AzureResource[] => {
                return [];
            },
            getTreeItem: (resource: AzureResource): TreeItem => {
                return {
                    label: resource.name,
                    id: resource.id,
                    contextValue: 'validItem'
                }
            }
        });

        await commands.executeCommand('azureResourceGroups.groupBy.resourceType');

        const tdp = api().azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();

        const groups = await tdp.getChildren(subscriptions![0]) as TreeItem[];
        const functionGroup = groups!.find(g => g.label?.toString().includes('Func'));
        const children = await tdp.getChildren(functionGroup) as BranchDataItemWrapper[];

        const childTreeItems: TreeItem[] = await Promise.all(children.map(child => tdp.getTreeItem(child)));

        assert.ok(children);

        const invalidTreeItems = childTreeItems.filter(child => child.contextValue?.includes('invalid'));
        assert.strictEqual(invalidTreeItems.length, 1, `There should be 1 invalid tree item: ${invalidTreeItems.map(i => i.label).join(', ')}`);
    });

    test('Should show a custom error message when BranchDataProvider.getResourceItem returns nullish value', async () => {
        api().registerAzureResourceBranchDataProvider(AzExtResourceType.FunctionApp, {
            getResourceItem: (resource: AzureResource): ResourceModelBase => {
                if (resource.name === 'my-functionapp-1') {
                    return undefined as unknown as ResourceModelBase;
                }
                return resource;
            },
            getChildren: (_resource: AzureResource): AzureResource[] => {
                return [];
            },
            getTreeItem: (resource: AzureResource): TreeItem => {
                return {
                    label: resource.name,
                    id: resource.id,
                    contextValue: 'validItem'
                }
            }
        });

        await commands.executeCommand('azureResourceGroups.groupBy.resourceType');

        const tdp = api().azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();

        const groups = await tdp.getChildren(subscriptions![0]) as TreeItem[];
        const functionGroup = groups!.find(g => g.label?.toString().includes('Func'));
        const children = await tdp.getChildren(functionGroup) as BranchDataItemWrapper[];

        const childTreeItems: TreeItem[] = await Promise.all(children.map(child => tdp.getTreeItem(child)));

        assert.ok(children);

        const invalidTreeItems = childTreeItems.filter(child => child.contextValue?.includes('invalid'));
        assert.strictEqual(invalidTreeItems.length, 1, `There should be 1 invalid tree item: ${invalidTreeItems.map(i => i.label).join(', ')}`);
        assert.doesNotMatch(invalidTreeItems[0].label!.toString(), /Cannot read properties of undefined/, `Error should not be a "Cannot read properties of undefined error`);
    });
});

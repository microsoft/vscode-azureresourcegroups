import * as assert from "assert";
import { Event, TreeDataProvider, TreeItem } from "vscode";
import { BranchDataItemWrapper, ext, isWrapper, ResourceGroupsItem, ResourceModelBase, WorkspaceResource, WorkspaceResourceProvider } from "../../extension.bundle";
import { TestBranchDataProvider } from "./TestBranchDataProvider";

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

/**
 * Todo:
 * - tests for onDidChangeTreeData and refresh
 * - tests for groupings
 * - tests for if duplicate resources are returned by the service
 * - tests for tags
 * - tests for reveal
 * - pick experiences tests can easily exist here
 * - add compat shim tests
 * - add tests for node ids to match azure resource ids
 */

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

    test('BranchDataProvider returns wrappers', async () => {
        const { workspaceResource, tdp } = setupTestBranchDataProvider();
        const rootChildren = await tdp.getChildren() as any[];
        const testChild = rootChildren.find(c => c.id === workspaceResource.id);
        assert.strictEqual(isWrapper(testChild), true);
    });

    test('Firing BranchDataProvider.onDidChangeTreeData event with a branch item should fire a TreeDataProvider.onDidChangeTreeData evente with the corresponding wrapper item.', async () => {
        const { testChild, branchDataProvider, tdp } = await getGrandchild();

        const unwrappedChild = testChild.unwrap<WorkspaceResource>();
        const waitForOnDidChangeTreeDataToFire = waitForEventToFire(tdp.onDidChangeTreeData!);
        branchDataProvider.onDidChangeTreeDataEmitter.fire(unwrappedChild);

        const eventData = await waitForOnDidChangeTreeDataToFire;
        assert.strictEqual((eventData as ResourceGroupsItem[])[0], testChild);
    });

    test('Firing BranchDataProvider.onDidChangeTreeData event with a wrapper item should result in TreeDataProvider.onDidChangeTreeData being fired with an empty array.', async () => {
        const { testChild, branchDataProvider, tdp } = await getGrandchild();

        const waitForOnDidChangeTreeDataToFire = waitForEventToFire(tdp.onDidChangeTreeData!);
        branchDataProvider.onDidChangeTreeDataEmitter.fire(testChild as unknown as WorkspaceResource);

        const eventData = await waitForOnDidChangeTreeDataToFire;
        assert.strictEqual((eventData as []).length, 0);
    });
});

function setupTestBranchDataProvider() {
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

    const tdp = api().workspaceResourceTreeDataProvider as TreeDataProvider<unknown>;
    return { branchDataProvider, tdp, workspaceResource };
}

async function getGrandchild() {
    const { branchDataProvider, workspaceResource } = setupTestBranchDataProvider();
    const tdp = api().workspaceResourceTreeDataProvider as TreeDataProvider<unknown>;

    const rootChildren = await tdp.getChildren() as BranchDataItemWrapper[];
    const testChild = rootChildren.find(c => c.id === workspaceResource.id);
    assert.ok(testChild, `No test child found with id: ${workspaceResource.id}. Test children: ${rootChildren.map(item => item.id).join(', ')}`);
    return { testChild, branchDataProvider, tdp };
}

async function waitForEventToFire<T>(event: Event<T>): Promise<T> {
    return new Promise<T>((resolve) => {
        const disposable = event(data => {
            if (data === data) {
                disposable.dispose();
                resolve(data);
            } else {
            }
        });
    });
}

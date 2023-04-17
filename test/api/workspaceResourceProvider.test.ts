import { TreeItem } from "vscode";
import { ResourceModelBase, WorkspaceResource, WorkspaceResourceProvider } from "../../extension.bundle";
import { api } from "./api";
import assert = require("assert");

class TestWorkspaceResourceProvider implements WorkspaceResourceProvider {
    constructor(private readonly _resources?: WorkspaceResource[]) { }
    private _getResourcesCalled = false;

    /**
     * Asserts that `getResources` was called at least once.
     */
    assertGetResourcesWasCalled(): void {
        assert.ok(this._getResourcesCalled, 'Get resources was not called');
    }

    getResources(): WorkspaceResource[] {
        this._getResourcesCalled = true;
        return this._resources ?? [];
    }
}

suite('workspace resource provider tests', async () => {
    test("Registering a workspace resource provider doesn't throw an error", () => {
        const provider = new TestWorkspaceResourceProvider();
        assert.doesNotThrow(() => {
            api().registerWorkspaceResourceProvider(provider);
        });
    });

    test('Registered workspace resource provider is used', async () => {
        const provider = new TestWorkspaceResourceProvider();
        api().registerWorkspaceResourceProvider(provider);
        await api().workspaceResourceTreeDataProvider.getChildren();
        provider.assertGetResourcesWasCalled();
    });

    test('Resources provided by workspace resource provider are then passed to the corresponding branch data provider', async () => {
        const workspaceResource: WorkspaceResource = {
            resourceType: 'test1',
            id: 'test-resource-1',
            name: 'Test Resource 1',
        };

        const resourceProvider = new TestWorkspaceResourceProvider([workspaceResource]);
        api().registerWorkspaceResourceProvider(resourceProvider);

        api().registerWorkspaceResourceBranchDataProvider(workspaceResource.resourceType, {
            getResourceItem: (resource: WorkspaceResource): ResourceModelBase => {
                assert.strictEqual(resource, workspaceResource);
                return resource;
            },
            getChildren: (_resource: WorkspaceResource): WorkspaceResource[] => {
                return [];
            },
            getTreeItem: (resource: WorkspaceResource): TreeItem => {
                return new TreeItem(resource.name);
            }
        });

        await api().workspaceResourceTreeDataProvider.getChildren();
        resourceProvider.assertGetResourcesWasCalled();
    });
});

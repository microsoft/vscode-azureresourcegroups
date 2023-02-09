import { AzureResourceModel } from "@microsoft/vscode-azureresources-api";
import { commands, TreeItem, Uri } from "vscode";
import { AzExtResourceType, AzureResource, AzureResourceBranchDataProvider, BranchDataItemWrapper, ext } from "../../extension.bundle";
import assert = require("assert");

const api = () => {
    return ext.v2.api.resources;
}

type Mutable<T> = {
    -readonly [k in keyof T]: T[k];
};

type TestAzureResourceModel = Mutable<AzureResourceModel> & AzureResource;

const resourceName = 'my-functionapp-1';
// BDP that returns a model with a portal url ONLY for the 'my-functionapp-1' resource
class PortalUrlBranchDataProvider implements AzureResourceBranchDataProvider<TestAzureResourceModel> {
    getResourceItem(resource: AzureResource): TestAzureResourceModel {
        return resource;
    }

    getChildren(resource: TestAzureResourceModel): TestAzureResourceModel[] {
        const childModel: TestAzureResourceModel = {
            ...resource,
            id: resource.id + '/child',
            name: resource.name + '-child',
        };

        if (resourceName === resource.name) {
            childModel.portalUrl = Uri.parse('https://portal.azure.com');
        }

        return [childModel];
    }

    getTreeItem(resource: TestAzureResourceModel): TreeItem {
        return {
            label: resource.name,
            id: resource.id,
            contextValue: 'validItem'
        }
    }
}

suite('AzureResourceModel.portalUrl tests', async () => {

    test('TreeItem.contextValue should include "hasPortalUrl" if AzureResourceModel.portalUrl is defined', async () => {
        api().registerAzureResourceBranchDataProvider(AzExtResourceType.FunctionApp, new PortalUrlBranchDataProvider());
        await commands.executeCommand('azureResourceGroups.groupBy.resourceType');

        const tdp = api().azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();

        const groups = await tdp.getChildren(subscriptions![0]) as TreeItem[];
        const functionGroup = groups!.find(g => g.label?.toString().includes('Func'));
        const children = await tdp.getChildren(functionGroup) as BranchDataItemWrapper[];
        const grandchildren = await Promise.all(children.map(child => tdp.getChildren(child) as Promise<BranchDataItemWrapper[]>));

        const grandChildTreeItems: TreeItem[] = [];
        for await (const grandchildrenset of grandchildren) {
            if (grandchildrenset.length > 0) {
                for await (const grandchild of grandchildrenset) {
                    const treeItem = await tdp.getTreeItem(grandchild);
                    grandChildTreeItems.push(treeItem);
                }
            }
        }
        const grandchildrenTreeItemsWithPortalUrl = grandChildTreeItems.filter(treeItem => treeItem.contextValue?.includes('hasPortalUrl'));
        assert.strictEqual(grandchildrenTreeItemsWithPortalUrl.length, 1, 'There should be 1 tree item with "hasPortalUrl" context value');
    });
});

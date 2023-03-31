import { AzureResourceModel } from "@microsoft/vscode-azureresources-api";
import * as assert from 'assert';
import { commands, TreeItem, Uri } from "vscode";
import { AzExtResourceType, AzureResource, AzureResourceBranchDataProvider, BranchDataItemWrapper, ext } from "../../extension.bundle";
import { createMockSubscriptionWithFunctions } from "./mockServiceFactory";

const api = () => {
    return ext.v2.api.resources;
}

type Mutable<T> = {
    -readonly [k in keyof T]: T[k];
};

type TestAzureResourceModel = Mutable<AzureResourceModel> & AzureResource;

// BDP that returns a model with a portal url ONLY for the resource with the specified id
class PortalUrlBranchDataProvider implements AzureResourceBranchDataProvider<TestAzureResourceModel> {
    constructor(public readonly resourceId: string) { }

    getResourceItem(resource: AzureResource): TestAzureResourceModel {
        return resource;
    }

    getChildren(resource: TestAzureResourceModel): TestAzureResourceModel[] {
        const childModel: TestAzureResourceModel = {
            ...resource,
            id: resource.id + '/child',
            name: resource.name + '-child',
        };

        if (this.resourceId === resource.id) {
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
    test(`TreeItem.contextValue should include "${BranchDataItemWrapper.hasPortalUrlContextValue}" if AzureResourceModel.portalUrl is defined`, async () => {
        const mockResources = createMockSubscriptionWithFunctions();
        api().registerAzureResourceBranchDataProvider(AzExtResourceType.FunctionApp, new PortalUrlBranchDataProvider(mockResources.functionApp1.id));
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
        const grandchildrenTreeItemsWithPortalUrl = grandChildTreeItems.filter(treeItem => treeItem.contextValue?.includes(BranchDataItemWrapper.hasPortalUrlContextValue));
        assert.strictEqual(grandchildrenTreeItemsWithPortalUrl.length, 1, `There should be 1 tree item with "${BranchDataItemWrapper.hasPortalUrlContextValue}" context value`);
    });
});

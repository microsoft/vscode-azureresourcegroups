import { AzureResourceModel } from "@microsoft/vscode-azureresources-api";
import { commands, TreeItem } from "vscode";
import { AzExtResourceType, AzureResource, AzureResourceBranchDataProvider, BranchDataItemWrapper, ext, hasViewProperties } from "../../extension.bundle";
import { createMockSubscriptionWithFunctions } from "./mockServiceFactory";
import assert = require("assert");

const api = () => {
    return ext.v2.api.resources;
}

type Mutable<T> = {
    -readonly [k in keyof T]: T[k];
};

type TestAzureResourceModel = Mutable<AzureResourceModel> & AzureResource;

// BDP that returns a model with a view properties model ONLY for a specific resource
class ViewPropertiesBranchDataProvider implements AzureResourceBranchDataProvider<TestAzureResourceModel> {

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
            childModel.viewProperties = {
                data: {
                    foo: 'bar',
                },
                label: 'properties',
            }
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

suite('AzureResourceModel.viewProperties tests', async () => {
    test(`TreeItem.contextValue should only include "${BranchDataItemWrapper.hasPropertiesContextValue}" if AzureResourceModel.viewProperties is defined`, async () => {
        const mockResources = createMockSubscriptionWithFunctions();
        api().registerAzureResourceBranchDataProvider(AzExtResourceType.FunctionApp, new ViewPropertiesBranchDataProvider(mockResources.functionApp1.id));
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
        const grandchildrenTreeItemsWithPortalUrl = grandChildTreeItems.filter(treeItem => treeItem.contextValue?.includes(BranchDataItemWrapper.hasPropertiesContextValue));
        assert.strictEqual(grandchildrenTreeItemsWithPortalUrl.length, 1, `There should be 1 tree item with "${BranchDataItemWrapper.hasPropertiesContextValue}" context value`);
    });

    test(`BrachDataItemWrapper should have viewPropertiesModel`, async () => {
        const mockResources = createMockSubscriptionWithFunctions();
        api().registerAzureResourceBranchDataProvider(AzExtResourceType.FunctionApp, new ViewPropertiesBranchDataProvider(mockResources.functionApp1.id));
        await commands.executeCommand('azureResourceGroups.groupBy.resourceType');

        const tdp = api().azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();

        const groups = await tdp.getChildren(subscriptions![0]) as TreeItem[];
        const functionGroup = groups!.find(g => g.label?.toString().includes('Func'));
        const children = await tdp.getChildren(functionGroup) as BranchDataItemWrapper[];

        const functionApp1Item = children.find(child => child.id === mockResources.functionApp1.id);
        assert.ok(functionApp1Item);

        assert.ok(hasViewProperties(functionApp1Item));
    });
});

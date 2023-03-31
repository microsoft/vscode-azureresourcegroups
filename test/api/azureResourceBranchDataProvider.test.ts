import * as assert from "assert";
import { commands, TreeDataProvider, TreeItem } from "vscode";
import { AzExtResourceType, AzureResource, AzureResourceItem, BranchDataItemWrapper, BranchDataProvider, ext, GroupingItem, ResourceGroupsItem, ResourceModelBase, SubscriptionItem } from "../../extension.bundle";
import { createMockSubscriptionWithFunctions } from "./mockServiceFactory";

const api = () => {
    return ext.v2.api.resources;
}

suite('Azure Resource Branch Data Provider tests', async () => {
    test('Registered Azure resource branch data provider is used', async () => {
        createMockSubscriptionWithFunctions();
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
        const mockResources = createMockSubscriptionWithFunctions();
        api().registerAzureResourceBranchDataProvider(AzExtResourceType.FunctionApp, {
            getResourceItem: (resource: AzureResource): ResourceModelBase => {
                if (resource.id === mockResources.functionApp1.id) {
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
        const mockResources = createMockSubscriptionWithFunctions();
        api().registerAzureResourceBranchDataProvider(AzExtResourceType.FunctionApp, {
            getResourceItem: (resource: AzureResource): ResourceModelBase => {
                if (resource.id === mockResources.functionApp1.id) {
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

export interface AzureResourceTreeDataProvider extends TreeDataProvider<ResourceGroupsItem> {
    getChildren(): Promise<SubscriptionItem[]>;
    getChildren(element: SubscriptionItem): Promise<GroupingItem[]>;
    getChildren(element: GroupingItem): Promise<AzureResourceItem<AzureResource>[]>;
    getChildren(element: AzureResourceItem<AzureResource>): Promise<BranchDataItemWrapper[]>;
}

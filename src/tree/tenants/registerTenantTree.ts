/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, IActionContext, registerEvent } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { TenantResourceProviderManager } from "../../api/ResourceProviderManagers";
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { getKeyForTenant, getUnselectedTenants, setUnselectedTenants } from '../../utils/tenantSelection';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { TreeDataItem } from '../ResourceGroupsItem';
import { createTreeView } from '../createTreeView';
import { wrapTreeForVSCode } from '../wrapTreeForVSCode';
import { TenantResourceBranchDataProviderManager } from "./TenantResourceBranchDataProviderManager";
import { TenantResourceTreeDataProvider } from './TenantResourceTreeDataProvider';
import { TenantTreeItem } from './TenantTreeItem';

interface RegisterTenantTreeOptions {
    tenantResourceBranchDataProviderManager: TenantResourceBranchDataProviderManager,
    tenantResourceProviderManager: TenantResourceProviderManager,
    refreshEvent: vscode.Event<void | TreeDataItem | TreeDataItem[] | null | undefined>,
    itemCache: BranchDataItemCache
}

export function registerTenantTree(context: vscode.ExtensionContext, options: RegisterTenantTreeOptions): TenantResourceTreeDataProvider {
    const { tenantResourceBranchDataProviderManager, tenantResourceProviderManager, refreshEvent, itemCache } = options;

    const tenantResourceTreeDataProvider =
        new TenantResourceTreeDataProvider(tenantResourceBranchDataProviderManager, tenantResourceBranchDataProviderManager.onDidChangeTreeData, refreshEvent, tenantResourceProviderManager, itemCache);
    context.subscriptions.push(tenantResourceTreeDataProvider);

    const treeView = createTreeView('azureTenantsView', {
        canSelectMany: true,
        showCollapseAll: true,
        itemCache,
        title: localize('accountsAndTenants', 'Accounts & Tenants'),
        treeDataProvider: wrapTreeForVSCode(tenantResourceTreeDataProvider, itemCache),
        findItemById: tenantResourceTreeDataProvider.findItemById.bind(tenantResourceTreeDataProvider) as typeof tenantResourceTreeDataProvider.findItemById,
    });
    context.subscriptions.push(treeView);

    ext.tenantTreeView = treeView as unknown as vscode.TreeView<AzExtTreeItem>;

    registerEvent('onDidChangeCheckboxState', treeView.onDidChangeCheckboxState, async (context: IActionContext, args: vscode.TreeCheckboxChangeEvent<TenantTreeItem>) => {
        await updateTenantsSetting(context, args);
        ext.actions.refreshAzureTree();
    });

    return tenantResourceTreeDataProvider;
}

async function updateTenantsSetting(context: IActionContext, tenants: vscode.TreeCheckboxChangeEvent<TenantTreeItem>) {
    const unselectedTenants = getUnselectedTenants();
    const unselectedTenantsSet = new Set(unselectedTenants);

    for (const [tenantTreeItem, state] of tenants.items) {
        if (state === vscode.TreeItemCheckboxState.Unchecked) {
            context.telemetry.properties.uncheckedTenant = 'true';
            unselectedTenantsSet.add(getKeyForTenant(tenantTreeItem.tenantId, tenantTreeItem.account.id));
        } else if (state === vscode.TreeItemCheckboxState.Checked) {
            context.telemetry.properties.checkedTenant = 'true';
            const treeItem = await tenantTreeItem.getTreeItem();
            if (treeItem?.contextValue === 'tenantNameNotSignedIn') {
                await vscode.commands.executeCommand('azureTenantsView.signInToTenant', tenantTreeItem);
                ext.actions.refreshTenantTree();
            }
            unselectedTenantsSet.delete(getKeyForTenant(tenantTreeItem.tenantId, tenantTreeItem.account.id));
        }
    }

    await setUnselectedTenants(Array.from(unselectedTenantsSet));
}

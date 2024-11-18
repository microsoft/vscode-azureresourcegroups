/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, IActionContext, registerEvent } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { TenantResourceProviderManager } from "../../api/ResourceProviderManagers";
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { createTreeView } from '../createTreeView';
import { wrapTreeForVSCode } from '../wrapTreeForVSCode';
import { TenantResourceBranchDataProviderManager } from "./TenantResourceBranchDataProviderManager";
import { TenantResourceTreeDataProvider } from './TenantResourceTreeDataProvider';
import { TenantTreeItem } from './TenantTreeItem';

interface RegisterTenantTreeOptions {
    tenantResourceBranchDataProviderManager: TenantResourceBranchDataProviderManager,
    tenantResourceProviderManager: TenantResourceProviderManager,
    refreshEvent: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>,
    itemCache: BranchDataItemCache
}

export function registerTenantTree(context: vscode.ExtensionContext, options: RegisterTenantTreeOptions): TenantResourceTreeDataProvider {
    const { tenantResourceBranchDataProviderManager, tenantResourceProviderManager, refreshEvent, itemCache } = options;

    const tenantResourceTreeDataProvider =
        new TenantResourceTreeDataProvider(tenantResourceBranchDataProviderManager, tenantResourceBranchDataProviderManager.onDidChangeTreeData, refreshEvent, tenantResourceProviderManager, itemCache);
    context.subscriptions.push(tenantResourceTreeDataProvider);

    const treeView = createTreeView('azureTenant', {
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

async function updateTenantsSetting(_context: IActionContext, tenants: vscode.TreeCheckboxChangeEvent<TenantTreeItem>) {
    const state = ext.context.globalState.get<string[]>('unselectedTenants');
    const unselectedTenants = new Set(state ?? []);

    for (const [tenantTreeItem, state] of tenants.items) {
        if (state === vscode.TreeItemCheckboxState.Unchecked) {
            unselectedTenants.add(getKeyForTenant(tenantTreeItem));
        } else if (state === vscode.TreeItemCheckboxState.Checked) {
            const treeItem = await tenantTreeItem.getTreeItem();
            if (treeItem?.contextValue === 'tenantNameNotSignedIn') {
                await vscode.commands.executeCommand('azureTenant.signInToTenant', tenantTreeItem,);
                ext.actions.refreshTenantTree();
            }
            unselectedTenants.delete(getKeyForTenant(tenantTreeItem));
        }
    }

    await ext.context.globalState.update('unselectedTenants', Array.from(unselectedTenants));
}

export function getKeyForTenant(tenant: { id: string, accountId: string }): string {
    return `${tenant.id}/${tenant.accountId}`;
}

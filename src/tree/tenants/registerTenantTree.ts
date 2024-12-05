/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { getUnselectedTenants } from '@microsoft/vscode-azext-azureauth';
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

async function updateTenantsSetting(_context: IActionContext, tenants: vscode.TreeCheckboxChangeEvent<TenantTreeItem>) {
    const unselectedTenants = getUnselectedTenants();
    const unselectedTenantsSet = new Set(unselectedTenants);

    for (const [tenantTreeItem, state] of tenants.items) {
        if (state === vscode.TreeItemCheckboxState.Unchecked) {
            unselectedTenantsSet.add(getKeyForTenant(tenantTreeItem.tenantId, tenantTreeItem.account.id));
        } else if (state === vscode.TreeItemCheckboxState.Checked) {
            const treeItem = await tenantTreeItem.getTreeItem();
            if (treeItem?.contextValue === 'tenantNameNotSignedIn') {
                await vscode.commands.executeCommand('azureTenantsView.signInToTenant', tenantTreeItem, tenantTreeItem.account);
                ext.actions.refreshTenantTree();
            }
            unselectedTenantsSet.delete(getKeyForTenant(tenantTreeItem.tenantId, tenantTreeItem.account.id));
        }
    }

    await setUnselectedTenants(Array.from(unselectedTenantsSet));
}

const unselectedTenants = 'unselectedTenants';

function removeDuplicates(arr: string[]): string[] {
    return Array.from(new Set(arr));
}

export async function setUnselectedTenants(tenantIds: string[]): Promise<void> {
    printTenants(tenantIds);
    await vscode.workspace.getConfiguration('azureResourceGroups')
        .update(unselectedTenants, removeDuplicates(tenantIds), vscode.ConfigurationTarget.Global);
}

export function isTenantFilteredOut(tenantId: string, accountId: string): boolean {
    const settings = getUnselectedTenants();
    if (settings) {
        if (settings.includes(getKeyForTenant(tenantId, accountId))) {
            return true;
        }
    }
    return false;
}

export function getKeyForTenant(tenantId: string, accountId: string): string {
    return `${tenantId}/${accountId}`;
}

function printTenants(unselectedTenants: string[]): void {
    let str = '';
    str += 'Unselected tenants:\n';
    for (const tenant of unselectedTenants) {
        str += `- ${tenant}\n`;
    }
    ext.outputChannel.appendLine(str);
}

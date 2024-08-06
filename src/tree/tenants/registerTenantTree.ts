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
}

export function registerTenantTree(context: vscode.ExtensionContext, options: RegisterTenantTreeOptions): TenantResourceTreeDataProvider {
    const { tenantResourceBranchDataProviderManager, tenantResourceProviderManager, refreshEvent } = options;


    const branchItemCache = new BranchDataItemCache();
    const tenantResourceTreeDataProvider =
        new TenantResourceTreeDataProvider(tenantResourceBranchDataProviderManager, refreshEvent, tenantResourceProviderManager, ext.azureTreeState, branchItemCache);
    context.subscriptions.push(tenantResourceTreeDataProvider);

    const treeView = createTreeView('azureTenant', {
        canSelectMany: true,
        showCollapseAll: true,
        itemCache: branchItemCache,
        title: localize('accountsAndTenants', 'Accounts & Tenants'),
        treeDataProvider: wrapTreeForVSCode(tenantResourceTreeDataProvider, branchItemCache),
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
    const unselectedTenants = ext.context.globalState.get<string[]>('unselectedTenants') || [];

    for (const item of tenants.items) {
        if (item[1] === vscode.TreeItemCheckboxState.Unchecked) {
            unselectedTenants.push(`${item[0].id}/${item[0].accountId}`);
        } else if (item[1] === vscode.TreeItemCheckboxState.Checked) {
            const treeItem = await item[0].getTreeItem();
            if (treeItem?.contextValue === 'tenantNameNotSignedIn') {
                const signInButton: vscode.MessageItem = { title: localize('signIn', 'Sign in') };
                const buttons: vscode.MessageItem[] = [signInButton];
                const result = await vscode.window.showWarningMessage(
                    localize('signIntoTenant', 'This tenant is not signed in. Please sign in to access resources.'), { modal: true }, ...buttons);
                if (result === signInButton) {
                    await vscode.commands.executeCommand('azureTenant.signInToTenant', treeItem);
                }
            }
            unselectedTenants.splice(unselectedTenants.indexOf(item[0].id), 1);
        }
    }

    await ext.context.globalState.update('unselectedTenants', unselectedTenants);
}

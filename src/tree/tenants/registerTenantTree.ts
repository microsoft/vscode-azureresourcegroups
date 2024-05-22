/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, IActionContext, registerEvent } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { TenantResourceProviderManager } from "../../api/ResourceProviderManagers";
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { settingUtils } from '../../utils/settingUtils';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { createTreeView } from '../createTreeView';
import { wrapTreeForVSCode } from '../wrapTreeForVSCode';
import { TenantResourceBranchDataProviderManager } from "./TenantResourceBranchDataProviderManager";
import { TenantResourceTreeDataProvider } from './TenantResourceTreeDataProvider';

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
    context.subscriptions.push(tenantResourceTreeDataProvider); //not sure about this

    const treeView = createTreeView('azureTenant', {
        canSelectMany: true,
        showCollapseAll: true,
        itemCache: branchItemCache,
        title: localize('tenant', 'Tenant'),
        treeDataProvider: wrapTreeForVSCode(tenantResourceTreeDataProvider, branchItemCache),
        findItemById: tenantResourceTreeDataProvider.findItemById.bind(tenantResourceTreeDataProvider) as typeof tenantResourceTreeDataProvider.findItemById,
    });
    context.subscriptions.push(treeView);

    ext.tenantTreeView = treeView as unknown as vscode.TreeView<AzExtTreeItem>;

    registerEvent('onDidChangeCheckboxState', treeView.onDidChangeCheckboxState, async (context: IActionContext, args: vscode.TreeCheckboxChangeEvent<ResourceGroupsItem>) => {
        await updateTenantsSetting(context, args);
    });

    return tenantResourceTreeDataProvider;
}

async function updateTenantsSetting(_context: IActionContext, tenants: vscode.TreeCheckboxChangeEvent<ResourceGroupsItem>) {
    //get current list first and then just delete from that list/add to it instead of returning a whole new list
    const unselectedTenants = settingUtils.getGlobalSetting<string[]>('unselectedTenants') || [];
    for (const item of tenants.items) {
        if (item[1] === vscode.TreeItemCheckboxState.Unchecked) {
            unselectedTenants.push(item[0].id);
        }
        if (item[1] === vscode.TreeItemCheckboxState.Checked) {
            unselectedTenants.splice(unselectedTenants.indexOf(item[0].id), 1);
        }
    }
    await settingUtils.updateGlobalSetting('unselectedTenants', unselectedTenants);
}

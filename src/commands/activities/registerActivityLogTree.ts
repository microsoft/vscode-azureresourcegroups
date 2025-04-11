/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem } from "@microsoft/vscode-azext-utils";
import { Event, ExtensionContext, TreeView } from "vscode";
import { ActivityLogResourceProviderManager } from "../../api/ResourceProviderManagers";
import { ext } from "../../extensionVariables";
import { ActivityLogTreeDataProvider } from "../../tree/activitiyLog/ActivityLogBranchDataProvider";
import { ActivityLogResourceBranchDataProviderManager } from "../../tree/activitiyLog/ActivityLogBranchDataProviderManager";
import { BranchDataItemCache } from "../../tree/BranchDataItemCache";
import { createTreeView } from "../../tree/createTreeView";
import { TreeDataItem } from "../../tree/ResourceGroupsItem";
import { wrapTreeForVSCode } from "../../tree/wrapTreeForVSCode";
import { localize } from "../../utils/localize";

interface RegisterActivityLogTreeOptions {
    activityLogResourceBranchDataProviderManager: ActivityLogResourceBranchDataProviderManager,
    activityLogResourceProviderManager: ActivityLogResourceProviderManager,
    refreshEvent: Event<void | TreeDataItem | TreeDataItem[] | null | undefined>,
}

export function registerActivityLogTree(context: ExtensionContext, options: RegisterActivityLogTreeOptions): ActivityLogTreeDataProvider {
    const { activityLogResourceBranchDataProviderManager, activityLogResourceProviderManager, refreshEvent } = options;

    const branchItemCache = new BranchDataItemCache();
    const activityLogTreeDataProvider =
        new ActivityLogTreeDataProvider(activityLogResourceBranchDataProviderManager, refreshEvent, activityLogResourceProviderManager, branchItemCache);
    context.subscriptions.push(activityLogTreeDataProvider);

    const treeView = createTreeView('azureActivityLog', {
        canSelectMany: true,
        showCollapseAll: true,
        itemCache: branchItemCache,
        title: localize('activityLog', 'Activity Log'),
        treeDataProvider: wrapTreeForVSCode(activityLogTreeDataProvider, branchItemCache),
        findItemById: activityLogTreeDataProvider.findItemById.bind(activityLogTreeDataProvider) as typeof activityLogTreeDataProvider.findItemById,
    });
    context.subscriptions.push(treeView);
    ext.activityLogTreeView = treeView as unknown as TreeView<AzExtTreeItem>;

    return activityLogTreeDataProvider;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext, TreeElementBase } from '@microsoft/vscode-azext-utils';
import { Activity } from '@microsoft/vscode-azext-utils/hostapi';
import { commands, Event } from 'vscode';
import { ActivityLogResourceProviderManager } from '../../api/ResourceProviderManagers';
import { ext } from '../../extensionVariables';
import { settingUtils } from '../../utils/settingUtils';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { ResourceTreeDataProviderBase } from '../ResourceTreeDataProviderBase';
import { WorkspaceResourceBranchDataProviderManager } from '../workspace/WorkspaceResourceBranchDataProviderManager';
import { ActivityItem, ActivityStatus } from './ActivityItem';

export class ActivityLogTreeDataProvider extends ResourceTreeDataProviderBase {
    private activityTreeItems: Record<string, ActivityItem> = {};
    constructor(
        branchDataProviderManager: WorkspaceResourceBranchDataProviderManager,
        onRefresh: Event<void | TreeElementBase | TreeElementBase[] | null | undefined>,
        resourceProviderManager: ActivityLogResourceProviderManager,
        branchItemCache: BranchDataItemCache) {
        super(
            branchItemCache,
            branchDataProviderManager.onDidChangeTreeData,
            resourceProviderManager.onDidChangeResourceChange,
            onRefresh);
    }

    async onGetChildren(element?: TreeElementBase | undefined): Promise<TreeElementBase[] | null | undefined> {
        if (element?.getChildren) {
            return await element.getChildren();
        } else {
            return Object.values(this.activityTreeItems).filter((activity) => !!activity.status);
        }
    }

    public async addActivity(activity: Activity): Promise<void> {
        await callWithTelemetryAndErrorHandling('registerActivity', async (_context: IActionContext) => {
            this.activityTreeItems[activity.id] = new ActivityItem(activity);
            if ((await settingUtils.getWorkspaceSetting('autoOpenActivityPanel'))) {
                await commands.executeCommand('azureActivityLog.focus');
            }

            ext.actions.refreshActivityLogTree();
        });
    }

    public async clearActivities(_context: IActionContext): Promise<void> {
        Object.entries(this.activityTreeItems).forEach(([id, activity]: [string, ActivityItem]) => {
            if (activity.status === ActivityStatus.Done) {
                activity.dispose();
                delete this.activityTreeItems[id];
            }
        });
        ext.actions.refreshActivityLogTree();
    }
}

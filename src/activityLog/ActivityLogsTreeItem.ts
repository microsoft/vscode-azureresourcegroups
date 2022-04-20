/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, callWithTelemetryAndErrorHandling, IActionContext } from '@microsoft/vscode-azext-utils';
import { Activity } from '@microsoft/vscode-azext-utils/hostapi';
import { commands, Disposable } from 'vscode';
import { localize } from '../utils/localize';
import { settingUtils } from '../utils/settingUtils';
import { ActivityStatus, ActivityTreeItem } from './ActivityTreeItem';

export class ActivityLogTreeItem extends AzExtParentTreeItem implements Disposable {
    public label: string = localize('activityLog', 'Activity Log');
    public contextValue: string = 'azureActivityLog';

    private activityTreeItems: Record<string, ActivityTreeItem> = {};

    public constructor() {
        super(undefined);
    }

    public dispose(): void {
        Object.values(this.activityTreeItems).forEach((activity: ActivityTreeItem) => {
            activity.dispose();
        });
    }

    public async addActivity(activity: Activity): Promise<void> {
        await callWithTelemetryAndErrorHandling('registerActivity', async (context: IActionContext) => {
            this.activityTreeItems[activity.id] = new ActivityTreeItem(this, activity);
            if ((await settingUtils.getWorkspaceSetting('autoOpenActivityPanel'))) {
                await commands.executeCommand('azureActivityLog.focus');
            }
            await this.refresh(context);
        });
    }

    public async clearActivities(context: IActionContext): Promise<void> {
        Object.entries(this.activityTreeItems).forEach(([id, activity]: [string, ActivityTreeItem]) => {
            if (activity.status === ActivityStatus.Done) {
                activity.dispose();
                delete this.activityTreeItems[id];
            }
        });
        await this.refresh(context);
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        // no status means activity hasn't started yet
        return Object.values(this.activityTreeItems).filter((activity) => !!activity.status);
    }

    public compareChildrenImpl(item1: ActivityTreeItem, item2: ActivityTreeItem): number {
        return item1.startedAtMs - item2.startedAtMs;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }
}

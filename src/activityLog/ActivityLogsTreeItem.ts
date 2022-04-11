/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Activity, AzExtParentTreeItem, AzExtTreeItem, callWithTelemetryAndErrorHandling, IActionContext } from '@microsoft/vscode-azext-utils';
import { localize } from '../utils/localize';
import { ActivityTreeItem } from './ActivityTreeItem';

export class ActivityLogTreeItem extends AzExtParentTreeItem {
    public label: string = localize('activityLog', 'Activity Log');
    public contextValue: string = 'azureActivityLog';

    private activityTreeItems: Record<string, ActivityTreeItem> = {};

    public constructor() {
        super(undefined);
    }

    public async addActivity(activity: Activity): Promise<void> {
        await callWithTelemetryAndErrorHandling('registerActivity', async (context: IActionContext) => {
            this.activityTreeItems[activity.id] = new ActivityTreeItem(this, activity);
            await this.refresh(context);
        });
    }

    public async clearActivities(context: IActionContext): Promise<void> {
        this.activityTreeItems = {};
        await this.refresh(context);
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        return Object.values(this.activityTreeItems).filter((activity) => activity.started);
    }

    public compareChildrenImpl(item1: ActivityTreeItem, item2: ActivityTreeItem): number {
        return item1.startedAtMs - item2.startedAtMs;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityTreeItem, AzExtParentTreeItem, AzExtTreeItem, IActionContext } from '@microsoft/vscode-azext-utils';
import { localize } from '../utils/localize';
import { activities } from './registerActivity';

export class ActivityLogTreeItem extends AzExtParentTreeItem {
    public label: string = localize('activityLog', 'Activity Log');
    public contextValue: string = 'azureActivityLog';

    public constructor() {
        super(undefined);
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        return activities.map((activity) => new ActivityTreeItem(this, activity));
    }

    public compareChildrenImpl(item1: ActivityTreeItem, item2: ActivityTreeItem): number {
        return item1.activity.startedAtMs - item2.activity.startedAtMs;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }
}

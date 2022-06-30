/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, GenericTreeItem, IActionContext } from '@microsoft/vscode-azext-utils';
import { ThemeIcon } from 'vscode';
import { localize } from '../utils/localize';

export class HelpTreeItem extends AzExtParentTreeItem {
    public label: string = localize('helpAndFeedback', 'Help and Feedback');
    public contextValue: string = 'helpAndFeedback';

    constructor() {
        super(undefined);
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        const getStartedTI: AzExtTreeItem = new GenericTreeItem(this, {
            label: localize('getStarted', 'Get Started'),
            contextValue: 'getStarted',
            commandId: 'ms-azuretools.getStarted',
            iconPath: new ThemeIcon('star-empty')
        });
        const openWalkthroughTI: AzExtTreeItem = new GenericTreeItem(this, {
            label: localize('openWalkthrough', 'Open Azure Extensions Walkthrough'),
            contextValue: 'openWalkthrough',
            commandId: 'ms-azuretools.openWalkthrough',
            iconPath: new ThemeIcon('extensions')
        });
        const reportIssueTI: AzExtTreeItem = new GenericTreeItem(this, {
            label: localize('reportIssue', 'Report Issue'),
            contextValue: 'reportIssue',
            commandId: 'ms-azuretools.reportIssue',
            iconPath: new ThemeIcon('comment')
        });
        const reviewIssuesTI: AzExtTreeItem = new GenericTreeItem(this, {
            label: localize('reviewIssues', 'Review Issues'),
            contextValue: 'reviewIssues',
            commandId: 'ms-azuretools.reviewIssues',
            iconPath: new ThemeIcon('issues')
        });
        return [getStartedTI, openWalkthroughTI, reviewIssuesTI, reportIssueTI];
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public compareChildrenImpl(): number {
        return 0; // Already sorted
    }
}

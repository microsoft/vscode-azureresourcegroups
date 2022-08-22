/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, IActionContext } from '@microsoft/vscode-azext-utils';
import { workspaceResourceProviders } from '../api/registerWorkspaceResourceProvider';
import { localize } from '../utils/localize';

export class WorkspaceTreeItem extends AzExtParentTreeItem {
    public static contextValue: string = 'azureWorkspace';
    public contextValue: string = WorkspaceTreeItem.contextValue;

    public label: string = localize('workspace', 'Workspace');
    public childTypeLabel: string = localize('attachedAccount', 'Attached Account');

    constructor() {
        super(undefined);
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        const children: AzExtTreeItem[] = [];
        await Promise.all(Object.values(workspaceResourceProviders).map(async (provider) =>
            children.push(...(await provider.provideResources(this) ?? []))
        ));

        return children;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }
}

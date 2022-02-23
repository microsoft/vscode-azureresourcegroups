/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, registerEvent } from '@microsoft/vscode-azext-utils';
import { ConfigurationChangeEvent, workspace } from 'vscode';
import { ext } from '../extensionVariables';
import { localize } from '../utils/localize';

export abstract class RootTreeItemBase extends AzExtParentTreeItem {
    public readonly childTypeLabel: string = localize('groupBy', 'Group');

    private _nextLink: string | undefined;
    public treeMap: { [key: string]: AzExtTreeItem } = {};

    public constructor(parent: AzExtParentTreeItem) {
        super(parent);
    }

    public hasMoreChildrenImpl(): boolean {
        return !!this._nextLink;
    }

    public registerRefreshEvents(key: string): void {
        registerEvent('treeView.onDidChangeConfiguration', workspace.onDidChangeConfiguration, async (context: IActionContext, e: ConfigurationChangeEvent) => {
            context.errorHandling.suppressDisplay = true;
            context.telemetry.suppressIfSuccessful = true;
            context.telemetry.properties.isActivationEvent = 'true';

            if (e.affectsConfiguration(`${ext.prefix}.${key}`)) {
                await this.refresh(context);
            }
        });
    }
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, IActionContext } from '@microsoft/vscode-azext-utils';
import { AppResource } from '../api';
import { localize } from '../utils/localize';
import { OperationTreeItem } from './ActivityTreeItem';
import { ActivityTreeItemBase, CreateOperationOptions } from './ActivityTreeItemBase';

export interface RegisterOperationOptions {
    label: string;
    task: () => Thenable<AppResource>;
}

export interface Operation extends RegisterOperationOptions {
    timestamp: number;
}

export class ActivityLogsTreeItem extends AzExtParentTreeItem {
    public label: string = localize('operations', 'Operations');
    public contextValue: string = 'azureOperations';

    private _operations: Operation[] = [];
    private _operations2: CreateOperationOptions[] = [];

    public constructor() {
        super(undefined);
    }

    public registerOperation(context: IActionContext, options: RegisterOperationOptions): void {
        const operation: Operation = {
            ...options,
            timestamp: Date.now()
        }

        this._operations.push(operation);
        void this.refresh(context);
    }

    public registerOperation2(context: IActionContext, options: CreateOperationOptions): void {
        this._operations2.push(options);
        void this.refresh(context);
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        return this._operations2.map((operation) => new ActivityTreeItemBase(this, operation));
    }

    public compareChildrenImpl(item1: OperationTreeItem, item2: OperationTreeItem): number {
        return item2.timestamp - item1.timestamp;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }
}

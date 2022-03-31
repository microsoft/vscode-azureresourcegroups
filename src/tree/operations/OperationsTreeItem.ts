/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, IActionContext } from '@microsoft/vscode-azext-utils';
import { AppResource } from '../../api';
import { localize } from '../../utils/localize';
import { OperationTreeItem } from './OperationTreeItem';

export interface RegisterOperationOptions {
    label: string;
    task: () => Thenable<AppResource>;
}

export interface Operation extends RegisterOperationOptions {
    timestamp: number;
}

export class OperationsTreeItem extends AzExtParentTreeItem {
    public label: string = localize('operations', 'Operations');
    public contextValue: string = 'azureOperations';

    private _operations: Operation[] = [];

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

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        return this._operations.map((operation) => new OperationTreeItem(this, operation));
    }

    public compareChildrenImpl(item1: OperationTreeItem, item2: OperationTreeItem): number {
        return item2.data.timestamp - item1.data.timestamp;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }
}

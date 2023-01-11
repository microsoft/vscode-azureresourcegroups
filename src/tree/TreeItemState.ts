/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ResourceGroupsItem } from './ResourceGroupsItem';

interface TreeItemState {
    /**
     * Apply a temporary description to the tree item
     */
    temporaryDescription?: string;
    /**
     * Set the tree item icon to a spinner
     */
    spinner?: boolean;
}

export class TreeItemStateStore implements vscode.Disposable {
    private readonly store: Record<string, Partial<TreeItemState> | undefined> = {};
    private readonly disposables: vscode.Disposable[] = [];
    private readonly onDidUpdateStateEmitter = new vscode.EventEmitter<string>();
    private readonly onDidUpdateStateEvent: vscode.Event<string> = this.onDidUpdateStateEmitter.event;

    /**
     * Notify a resource that its children have changed.
     */
    notifyChildrenChanged(id: string): void {
        this.onDidUpdateStateEmitter.fire(id);
    }

    wrapItemInStateHandling(item: ResourceGroupsItem, refresh: (item: ResourceGroupsItem) => void): ResourceGroupsItem {
        const getTreeItem = item.getTreeItem.bind(item) as typeof item.getTreeItem;
        item.getTreeItem = async () => {
            const treeItem = await getTreeItem();
            if (treeItem.id) {
                return this.applyToTreeItem({ ...treeItem, id: treeItem.id });
            }
            return treeItem;
        }

        this.onDidRequestRefresh(item.id, () => refresh(item));

        return item;
    }

    dispose(): void {
        this.disposables.forEach((disposable) => {
            disposable.dispose();
        });
    }

    async runWithTemporaryDescription<T = void>(id: string, description: string, callback: () => Promise<T>): Promise<T> {
        let result: T;
        this.update(id, { ...this.getState(id), temporaryDescription: description, spinner: true });
        try {
            result = await callback();
        } finally {
            this.update(id, { ...this.getState(id), temporaryDescription: undefined, spinner: false });
        }
        return result;
    }

    private applyStateToTreeItem(state: Partial<TreeItemState>, treeItem: vscode.TreeItem): vscode.TreeItem {
        treeItem.description = state.temporaryDescription;

        if (state.spinner) {
            treeItem.iconPath = new vscode.ThemeIcon('loading~spin');
        }

        return treeItem;
    }

    private onDidRequestRefresh(id: string, callback: () => void): void {
        this.disposables.push(this.onDidUpdateStateEvent((eventId: string) => {
            if (eventId === id) {
                callback();
            }
        }));
    }

    private applyToTreeItem(treeItem: vscode.TreeItem & { id: string }): vscode.TreeItem {
        const state = this.getState(treeItem.id);
        return this.applyStateToTreeItem(state, { ...treeItem });
    }

    private getState(id: string): Partial<TreeItemState> {
        return this.store[id] ?? {};
    }

    private update(id: string, state: Partial<TreeItemState>): void {
        this.store[id] = { ...this.getState(id), ...state };
        this.onDidUpdateStateEmitter.fire(id);
    }
}

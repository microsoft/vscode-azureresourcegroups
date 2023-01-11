/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ResourceGroupsItem } from './ResourceGroupsItem';

// TODO: move to shared utils
export abstract class TreeItemStateStoreBase<TState = {}, TItem extends ResourceGroupsItem = ResourceGroupsItem> implements vscode.Disposable {
    abstract applyStateToTreeItem(state: Partial<TState>, treeItem: vscode.TreeItem): vscode.TreeItem;

    private readonly store: Record<string, Partial<TState> | undefined> = {};
    private readonly disposables: vscode.Disposable[] = [];

    private readonly onDidUpdateStateEmitter = new vscode.EventEmitter<string>();
    private readonly onDidUpdateStateEvent: vscode.Event<string> = this.onDidUpdateStateEmitter.event;

    dispose(): void {
        this.disposables.forEach((disposable) => {
            disposable.dispose();
        });
    }

    onDidRequestRefresh(id: string, callback: () => void): void {
        this.disposables.push(this.onDidUpdateStateEvent((eventId: string) => {
            if (eventId === id) {
                callback();
            }
        }));
    }

    /**
     * Notify a resource that its children have changed.
     */
    notifyChildrenChanged(id: string): void {
        this.onDidUpdateStateEmitter.fire(id);
    }

    wrapItemInStateHandling(item: TItem, refresh: (item: TItem) => void): TItem {
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

    /**
     * Apply state (if any) to a tree item.
     */
    private applyToTreeItem(treeItem: vscode.TreeItem & { id: string }): vscode.TreeItem {
        const state = this.getState(treeItem.id);
        return this.applyStateToTreeItem(state, { ...treeItem });
    }

    protected async runWithState<T = void>(id: string, state: Partial<TState>, callback: () => Promise<T>): Promise<T> {
        let result: T;
        const initialState = { ...this.getState(id) };
        this.update(id, state);
        try {
            result = await callback();
        } finally {
            this.update(id, initialState);
        }
        return result;
    }

    private getState(id: string): Partial<TState> {
        return this.store[id] ?? {};
    }

    private update(id: string, state: Partial<TState>): void {
        this.store[id] = { ...this.getState(id), ...state };
        this.onDidUpdateStateEmitter.fire(id);
    }
}

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

// TODO: move to shared utils so it can be extended by client extensions to add their own custom state handling
export class ResourcesTreeItemStateStore<TState extends TreeItemState = TreeItemState, TItem extends ResourceGroupsItem = ResourceGroupsItem> extends TreeItemStateStoreBase<TState, TItem> {
    applyStateToTreeItem(state: Partial<TState>, treeItem: vscode.TreeItem): vscode.TreeItem {
        treeItem.description = state.temporaryDescription;

        if (state.spinner) {
            treeItem.iconPath = new vscode.ThemeIcon('loading~spin');
        }

        return treeItem;
    }

    async runWithTemporaryDescription<T = void>(id: string, description: string, callback: () => Promise<T>): Promise<T> {
        return this.runWithState(id, { temporaryDescription: description, spinner: true } as Partial<TState>, callback);
    }
}

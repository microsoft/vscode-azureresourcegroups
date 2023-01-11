/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

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

class TreeItemStateStore implements vscode.Disposable {
    private readonly store: Record<string, TreeItemState | undefined> = {};
    private readonly disposables: vscode.Disposable[] = [];

    private readonly onDidUpdateStateEmitter = new vscode.EventEmitter<string>();
    private readonly onDidUpdateStateEvent: vscode.Event<string> = this.onDidUpdateStateEmitter.event;

    dispose() {
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

    /**
     * Apply state (if any) to a tree item.
     */
    applyToTreeItem(treeItem: vscode.TreeItem & { id: string }): vscode.TreeItem {
        const state = this.getState(treeItem.id);

        treeItem.description = state.temporaryDescription;

        if (state.spinner) {
            treeItem.iconPath = new vscode.ThemeIcon('loading~spin');
        }

        return treeItem;
    }

    async runWithTemporaryDescription<T = void>(id: string, options: Pick<TreeItemState, 'spinner' | 'temporaryDescription'>, callback: () => Promise<T>): Promise<T> {
        let result: T;
        this.update(id, options);
        try {
            result = await callback();
        } finally {
            this.update(id, { temporaryDescription: undefined, spinner: undefined });
        }
        return result;
    }

    private getState(id: string): TreeItemState {
        return this.store[id] ?? {};
    }

    private update(id: string, state: Partial<TreeItemState>): void {
        this.store[id] = { ...this.getState(id), ...state };
        this.onDidUpdateStateEmitter.fire(id);
    }
}

export const treeItemState = new TreeItemStateStore();

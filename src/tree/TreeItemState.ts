/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { TreeElementBase } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { GenericItem } from './GenericItem';

interface TreeItemState {
    /**
     * Apply a temporary description to the tree item
     */
    temporaryDescription?: string;
    /**
     * Set the tree item icon to a spinner
     */
    spinner?: boolean;
    /**
     * Add temporary children to the tree item.
     */
    temporaryChildren?: TreeElementBase[];
}

export class TreeItemStateStore implements vscode.Disposable {
    private readonly store: Record<string, Partial<TreeItemState> | undefined> = {};
    private readonly disposables: vscode.Disposable[] = [];
    private readonly onDidUpdateStateEmitter = new vscode.EventEmitter<string>();
    private readonly onDidUpdateStateEvent: vscode.Event<string> = this.onDidUpdateStateEmitter.event;
    private nextTemporaryChildId = 0;

    /**
     * Notify a resource that its children have changed.
     *
     * @param id id needs to include the account and tenant id
     */
    notifyChildrenChanged(id: string): void {
        this.onDidUpdateStateEmitter.fire(id);
    }

    wrapItemInStateHandling(item: TreeElementBase, refresh: (item: TreeElementBase) => void): TreeElementBase {
        const getTreeItem = item.getTreeItem.bind(item) as typeof item.getTreeItem;
        const getChildren = item.getChildren?.bind(item);
        item.getTreeItem = async () => {
            const treeItem = await getTreeItem();
            if (treeItem.id) {
                return this.applyToTreeItem(treeItem.id, treeItem);
            }
            return treeItem;
        };
        if (getChildren) {
            item.getChildren = async () => {
                const children = await getChildren();
                const temporaryChildren = item.id ? this.getState(item.id).temporaryChildren : undefined;
                return temporaryChildren?.length ? [...temporaryChildren, ...children ?? []] : children;
            };
        }

        this.onDidRequestRefresh(item.id, () => refresh(item));

        return item;
    }

    dispose(): void {
        this.disposables.forEach((disposable) => {
            disposable.dispose();
        });
    }

    /**
     * @param id id needs to include the account and tenant id
     */
    async runWithTemporaryDescription<T = void>(id: string, description: string, callback: () => Promise<T>, refresh?: () => void): Promise<T> {
        let result: T;
        this.update(id, { ...this.getState(id), temporaryDescription: description, spinner: true });
        refresh?.();
        try {
            result = await callback();
        } finally {
            this.update(id, { ...this.getState(id), temporaryDescription: undefined, spinner: false });
            refresh?.();
        }
        return result;
    }

    async showCreatingChild<T = void>(id: string, label: string, callback: () => Promise<T>, refresh?: () => void): Promise<T> {
        const creatingItem = new GenericItem(label, {
            id: `${id}/creating/${this.nextTemporaryChildId++}`,
            description: vscode.l10n.t('Creating...'),
            iconPath: new vscode.ThemeIcon('loading~spin'),
        });
        const temporaryChildren = this.getState(id).temporaryChildren ?? [];
        this.update(id, { temporaryChildren: [...temporaryChildren, creatingItem] });
        refresh?.();
        try {
            return await callback();
        } finally {
            const remainingChildren = this.getState(id).temporaryChildren?.filter(child => child !== creatingItem);
            this.update(id, { temporaryChildren: remainingChildren?.length ? remainingChildren : undefined });
            refresh?.();
        }
    }

    applyToTreeItem(id: string, treeItem: vscode.TreeItem): vscode.TreeItem {
        const state = this.getState(id);
        return this.applyStateToTreeItem(state, { ...treeItem, id });
    }

    private applyStateToTreeItem(state: Partial<TreeItemState>, treeItem: vscode.TreeItem): vscode.TreeItem {
        if (state.temporaryDescription) {
            treeItem.description = state.temporaryDescription;
        }

        if (state.spinner) {
            treeItem.iconPath = new vscode.ThemeIcon('loading~spin');
        }

        return treeItem;
    }

    private onDidRequestRefresh(id: string | undefined, callback: () => void): void {
        this.disposables.push(this.onDidUpdateStateEvent((eventId: string) => {
            if (eventId === id) {
                callback();
            }
        }));
    }

    private getState(id: string): Partial<TreeItemState> {
        return this.store[id] ?? {};
    }

    private update(id: string, state: Partial<TreeItemState>): void {
        this.store[id] = { ...this.getState(id), ...state };
        this.onDidUpdateStateEmitter.fire(id);
    }
}

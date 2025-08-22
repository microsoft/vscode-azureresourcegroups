/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class ActivitySelectionCache {
    private static _instance: ActivitySelectionCache;
    private readonly _selectedActivityItemIds: Set<string> = new Set();

    private constructor() {
        // Private constructor to enforce singleton
    }

    static getInstance(): ActivitySelectionCache {
        if (!ActivitySelectionCache._instance) {
            ActivitySelectionCache._instance = new ActivitySelectionCache();
        }
        return ActivitySelectionCache._instance;
    }

    get selectionCount(): number {
        return this._selectedActivityItemIds.size;
    }

    hasActivityItem(itemId: string): boolean {
        return this._selectedActivityItemIds.has(itemId);
    }

    getActivityItems(): string[] {
        return Array.from(this._selectedActivityItemIds);
    }

    addActivityItems(...itemIds: string[]): void {
        for (const itemId of itemIds) {
            this._selectedActivityItemIds.add(itemId);
        }
    }

    resetActivityItems(): void {
        this._selectedActivityItemIds.clear();
    }
}

export const activitySelectionCache = ActivitySelectionCache.getInstance();

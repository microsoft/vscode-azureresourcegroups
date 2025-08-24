/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class ActivitySelectionCache {
    private static _instance: ActivitySelectionCache;
    private readonly _selectedActivityItemIds: Set<string> = new Set();

    private constructor() {
        // Private constructor to enforce a singleton pattern
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

    hasActivity(id: string): boolean {
        return this._selectedActivityItemIds.has(id);
    }

    getActivityIds(): string[] {
        return Array.from(this._selectedActivityItemIds);
    }

    addActivity(id: string): void {
        this._selectedActivityItemIds.add(id);
    }

    reset(): void {
        this._selectedActivityItemIds.clear();
    }
}

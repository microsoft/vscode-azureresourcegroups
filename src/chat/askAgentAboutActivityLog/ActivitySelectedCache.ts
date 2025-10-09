/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class ActivitySelectedCache {
    private static _instance: ActivitySelectedCache;
    private readonly _selectedActivityItemIds: Set<string> = new Set();

    private constructor() {
        // Private constructor to enforce a singleton pattern
    }

    static getInstance(): ActivitySelectedCache {
        if (!ActivitySelectedCache._instance) {
            ActivitySelectedCache._instance = new ActivitySelectedCache();
        }
        return ActivitySelectedCache._instance;
    }

    get selectionCount(): number {
        return this._selectedActivityItemIds.size;
    }

    listIds(): string[] {
        return Array.from(this._selectedActivityItemIds);
    }

    hasActivity(id: string): boolean {
        return this._selectedActivityItemIds.has(id);
    }

    addActivity(id: string): void {
        this._selectedActivityItemIds.add(id);
    }

    reset(): void {
        this._selectedActivityItemIds.clear();
    }
}

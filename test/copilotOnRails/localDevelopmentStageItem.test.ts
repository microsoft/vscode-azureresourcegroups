/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';
import { copilotOnRailsCommandIds } from '../../src/commands/copilotOnRails/registerCopilotOnRailsCommands';
import { LocalDevelopmentStageItem } from '../../src/tree/project/LocalDevelopmentStageItem';
import type { DebugConfigurationSummary } from '../../src/tree/project/projectPlanFiles';

class TestLocalDevelopmentStageItem extends LocalDevelopmentStageItem {
    constructor(currentStage: number, hasPlanFile: boolean, private readonly configs: DebugConfigurationSummary[]) {
        super(currentStage, hasPlanFile);
    }

    protected getDebugConfigurations(): DebugConfigurationSummary[] {
        return this.configs;
    }
}

function makeConfig(name: string): DebugConfigurationSummary {
    return {
        name,
        type: 'node',
        folder: {
            uri: vscode.Uri.file(`/tmp/${name}`),
            name,
            index: 0,
        },
    };
}

suite('LocalDevelopmentStageItem', () => {
    test('shows only the start node when no plan file exists', () => {
        const item = new TestLocalDevelopmentStageItem(1, false, []);
        const children = item.getChildren();

        assert.strictEqual(children.length, 1);
        const treeItem = children[0].getTreeItem();
        assert.strictEqual(treeItem.command?.command, copilotOnRailsCommandIds.startLocalDevelopment);
    });

    test('shows the Open plan node when a plan file exists but no debug configs', () => {
        const item = new TestLocalDevelopmentStageItem(1, true, []);
        const children = item.getChildren();

        assert.strictEqual(children.length, 1);
        const treeItem = children[0].getTreeItem();
        assert.strictEqual(treeItem.command?.command, copilotOnRailsCommandIds.openDebugPlanView);
        assert.strictEqual((treeItem.iconPath as vscode.ThemeIcon).id, 'preview');
    });

    test('shows the Open plan node alongside debug configuration nodes when debug configs exist', () => {
        const item = new TestLocalDevelopmentStageItem(1, true, [makeConfig('Launch API'), makeConfig('Launch Web')]);
        const children = item.getChildren();

        assert.strictEqual(children.length, 3);

        // The "Open plan" review node comes first.
        const openPlan = children[0].getTreeItem();
        assert.strictEqual(openPlan.command?.command, copilotOnRailsCommandIds.openDebugPlanView);
        assert.strictEqual((openPlan.iconPath as vscode.ThemeIcon).id, 'preview');

        // Followed by the generated F5 debug-configuration nodes.
        const first = children[1].getTreeItem();
        const second = children[2].getTreeItem();
        assert.strictEqual(first.command?.command, copilotOnRailsCommandIds.startDebugConfiguration);
        assert.strictEqual(second.command?.command, copilotOnRailsCommandIds.startDebugConfiguration);

        // Ids remain unique across all children.
        const ids = children.map((c) => c.getTreeItem().id);
        assert.strictEqual(new Set(ids).size, ids.length);
    });
});

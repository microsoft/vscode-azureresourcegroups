/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTestActionContext } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import * as vscode from 'vscode';
import { ensureRequiredCopilotOnRailsContext } from '../../src/utils/copilotOnRails/CopilotOnRailsContext';
import {
    COR_PROJECT_MARKER_PATH,
    parseCorProjectMarker,
} from '../../src/utils/copilotOnRails/corProjectMarker';
import {
    OPEN_PROJECT_FOLDER_OPTIONS,
    PROJECT_FOLDER_SELECTION_TELEMETRY_KEY,
    ProjectFolderSelection,
    recordProjectFolderSelection,
    validateProjectSubfolderName,
} from '../../src/webviews/copilotOnRails/extension/createProjectWithCopilot';
import { getWorkspaceFolderUri } from '../testUtils';
import { getCachedTestApi } from '../utils/testApiAccess';

suite('Create Project with Copilot folder selection', () => {
    for (const selection of ['newSubfolder', 'selectedEmptyFolder'] satisfies ProjectFolderSelection[]) {
        test(`records ${selection} in telemetry and diagnostics`, async () => {
            const context = ensureRequiredCopilotOnRailsContext(await createTestActionContext());

            recordProjectFolderSelection(context, selection);

            assert.strictEqual(context.telemetry.properties[PROJECT_FOLDER_SELECTION_TELEMETRY_KEY], selection);
            assert.strictEqual(context.diagnostics.properties[PROJECT_FOLDER_SELECTION_TELEMETRY_KEY], selection);
        });
    }

    test('always opens the project folder in a new window', () => {
        assert.deepStrictEqual(OPEN_PROJECT_FOLDER_OPTIONS, { forceNewWindow: true });
    });

    test('writes the CoR project marker before planning begins', async () => {
        const workspace = getWorkspaceFolderUri('testWorkspace');
        const markerUri = vscode.Uri.joinPath(workspace, ...COR_PROJECT_MARKER_PATH.split('/'));
        try {
            await getCachedTestApi().testing.prepareNewCorProject('Build a test project');
            const marker = parseCorProjectMarker(Buffer.from(await vscode.workspace.fs.readFile(markerUri)).toString('utf8'));
            assert.ok(marker);
            assert.strictEqual(marker.schemaVersion, 1);
            assert.strictEqual(marker.source, 'copilot-on-rails');
            assert.match(marker.corProjectId, /^[0-9a-f-]{36}$/i);
        } finally {
            try {
                await vscode.workspace.fs.delete(markerUri, { useTrash: false });
            } catch {
                // The assertion may fail before the marker is created.
            }
        }
    });

    test('rejects malformed CoR project markers', () => {
        assert.strictEqual(parseCorProjectMarker('{"schemaVersion":1,"source":"copilot-on-rails"}'), undefined);
        assert.strictEqual(parseCorProjectMarker('{"schemaVersion":2,"source":"copilot-on-rails","corProjectId":"id"}'), undefined);
        assert.strictEqual(parseCorProjectMarker('not json'), undefined);
    });

    test('accepts a direct child folder name', () => {
        assert.strictEqual(validateProjectSubfolderName('my-project'), undefined);
        assert.strictEqual(validateProjectSubfolderName('My Project'), undefined);
    });

    for (const value of ['', '   ', '.', '..', '../outside', '..\\outside', 'nested/project', 'nested\\project']) {
        test(`rejects unsafe folder name ${JSON.stringify(value)}`, () => {
            assert.ok(validateProjectSubfolderName(value));
        });
    }
});

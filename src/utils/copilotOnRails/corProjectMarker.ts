/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { isJsonObject } from '../../webviews/copilotOnRails/shared/jsonUtils';
import { getCorProjectId } from './telemetryUtils';

export const COR_PROJECT_MARKER_PATH = '.azure/created-by-cor.json';

export interface CorProjectMarker {
    schemaVersion: 1;
    source: 'copilot-on-rails';
    corProjectId: string;
}

export async function writeCorProjectMarker(): Promise<CorProjectMarker> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error(vscode.l10n.t('Creating a Copilot on Rails project requires an open workspace folder.'));
    }

    const marker: CorProjectMarker = {
        schemaVersion: 1,
        source: 'copilot-on-rails',
        corProjectId: getCorProjectId(),
    };
    const azureFolder = vscode.Uri.joinPath(workspaceFolder.uri, '.azure');
    const markerUri = vscode.Uri.joinPath(workspaceFolder.uri, ...COR_PROJECT_MARKER_PATH.split('/'));
    const temporaryUri = vscode.Uri.joinPath(azureFolder, '.created-by-cor.json.tmp');
    await vscode.workspace.fs.createDirectory(azureFolder);
    await vscode.workspace.fs.writeFile(temporaryUri, Buffer.from(`${JSON.stringify(marker, undefined, 2)}\n`, 'utf8'));
    await vscode.workspace.fs.rename(temporaryUri, markerUri, { overwrite: true });
    return marker;
}

export function parseCorProjectMarker(content: string): CorProjectMarker | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return undefined;
    }
    if (!isJsonObject(parsed)
        || parsed.schemaVersion !== 1
        || parsed.source !== 'copilot-on-rails'
        || typeof parsed.corProjectId !== 'string'
        || !parsed.corProjectId.trim()) {
        return undefined;
    }
    return {
        schemaVersion: 1,
        source: 'copilot-on-rails',
        corProjectId: parsed.corProjectId,
    };
}

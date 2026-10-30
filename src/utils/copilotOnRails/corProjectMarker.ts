/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const COR_PROJECT_MARKER_PATH = '.azure/created-by-cor.json';
export const COR_PROJECT_MARKER_SCHEMA_VERSION = 1;
export const COR_PROJECT_MARKER_SOURCE = 'copilot-on-rails';

export interface CorProjectMarker {
    schemaVersion: typeof COR_PROJECT_MARKER_SCHEMA_VERSION;
    source: typeof COR_PROJECT_MARKER_SOURCE;
    corProjectId: string;
}

const markerKeys = new Set<keyof CorProjectMarker>(['schemaVersion', 'source', 'corProjectId']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createCorProjectMarker(corProjectId: string): CorProjectMarker {
    if (!uuidPattern.test(corProjectId)) {
        throw new TypeError('corProjectId must be a valid UUID.');
    }

    return {
        schemaVersion: COR_PROJECT_MARKER_SCHEMA_VERSION,
        source: COR_PROJECT_MARKER_SOURCE,
        corProjectId,
    };
}

/**
 * Parses the durable CoR project marker as an exact, versioned contract.
 * The workspace file is untrusted, so unknown fields and unsupported values are rejected.
 */
export function parseCorProjectMarker(content: string | Uint8Array): CorProjectMarker | undefined {
    try {
        const parsed: unknown = JSON.parse(typeof content === 'string' ? content : Buffer.from(content).toString('utf-8'));
        if (!isJsonObject(parsed)
            || Object.keys(parsed).length !== markerKeys.size
            || !Object.keys(parsed).every(key => markerKeys.has(key as keyof CorProjectMarker))
            || parsed.schemaVersion !== COR_PROJECT_MARKER_SCHEMA_VERSION
            || parsed.source !== COR_PROJECT_MARKER_SOURCE
            || typeof parsed.corProjectId !== 'string'
            || !uuidPattern.test(parsed.corProjectId)) {
            return undefined;
        }

        return {
            schemaVersion: COR_PROJECT_MARKER_SCHEMA_VERSION,
            source: COR_PROJECT_MARKER_SOURCE,
            corProjectId: parsed.corProjectId,
        };
    } catch {
        return undefined;
    }
}

/**
 * Writes the authoritative project breadcrumb, replacing stale or tampered file contents.
 * Repeated writes for the same project are a no-op when the exact payload is already present.
 */
export async function writeCorProjectMarker(folder: vscode.Uri, corProjectId: string): Promise<void> {
    const markerDirectory = vscode.Uri.joinPath(folder, '.azure');
    const markerUri = vscode.Uri.joinPath(folder, ...COR_PROJECT_MARKER_PATH.split('/'));
    const content = Buffer.from(JSON.stringify(createCorProjectMarker(corProjectId)), 'utf-8');

    await vscode.workspace.fs.createDirectory(markerDirectory);
    try {
        const existing = await vscode.workspace.fs.readFile(markerUri);
        if (Buffer.from(existing).equals(content)) {
            return;
        }
    } catch (error) {
        if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
            throw error;
        }
    }

    await vscode.workspace.fs.writeFile(markerUri, content);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

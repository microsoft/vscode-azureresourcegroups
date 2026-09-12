/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Matches the canonical `**Status**:` metadata row in a plan file. Anchored to a
 * line start (`m` flag) so an incidental "Status:" elsewhere in the document
 * can't be matched. Capture group 1 is the label + separator (preserved when
 * rewriting); group 2 is the raw value up to end of line.
 */
const STATUS_LINE_REGEX = /^(\*\*Status\*\*:[ \t]*)([^\r\n]*)/m;

/** Replaces only the canonical status metadata value in plan markdown. */
export function replaceProjectPlanStatus(content: string, newStatus: string): string | undefined {
    if (!STATUS_LINE_REGEX.test(content)) {
        return undefined;
    }
    return content.replace(STATUS_LINE_REGEX, (_full, prefix: string) => `${prefix}${newStatus}`);
}

/**
 * Overwrites the status metadata row in one specific plan file. Returns the
 * original content when the status changed so callers can roll the write back.
 */
export async function writeProjectPlanStatusAtUri(uri: vscode.Uri, newStatus: string): Promise<string | undefined> {
    let content: string;
    try {
        content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
    } catch {
        return undefined;
    }

    const updated = replaceProjectPlanStatus(content, newStatus);
    if (updated === undefined) {
        return undefined;
    }
    if (updated === content) {
        return content;
    }

    try {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf-8'));
        const persisted = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
        if (STATUS_LINE_REGEX.exec(persisted)?.[2]?.trim() !== newStatus) {
            return undefined;
        }
    } catch {
        return undefined;
    }
    return content;
}

/**
 * Overwrites the value of the `**Status**:` metadata row of the plan file matched
 * by `glob`, preserving the label. Used to make plan-state transitions that must
 * be immediate and reliable from extension code (e.g. flipping to `Integrating`
 * when the user approves the UI) rather than leaving them to a chat agent.
 * Returns `true` if the file was updated.
 */
export async function writeProjectPlanStatus(glob: string, newStatus: string): Promise<boolean> {
    const [uri] = await vscode.workspace.findFiles(glob, undefined, 1);
    if (!uri) {
        return false;
    }
    const previous = await writeProjectPlanStatusAtUri(uri, newStatus);
    return previous !== undefined && STATUS_LINE_REGEX.exec(previous)?.[2]?.trim() !== newStatus;
}

/**
 * Reads the first `Status:` value from the plan file matched by `glob`. Uses the
 * same regex as {@link writeProjectPlanStatus}, so reads and writes stay
 * symmetric. Returns the trimmed value, or `undefined` when no file or status
 * line is found.
 */
export async function readProjectPlanStatus(glob: string): Promise<string | undefined> {
    const [uri] = await vscode.workspace.findFiles(glob, undefined, 1);
    if (!uri) {
        return undefined;
    }

    let content: string;
    try {
        content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
    } catch {
        return undefined;
    }

    return STATUS_LINE_REGEX.exec(content)?.[2]?.trim();
}

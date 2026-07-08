/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Matches the first `Status:` metadata row in a plan file. Anchored to a line
 * start (`m` flag) so an incidental "status:" elsewhere in the document can't be
 * matched, and tolerant of markdown decoration on the label (e.g. `**Status**:`).
 * Capture group 1 is the label + separator (preserved when rewriting); group 2
 * is the raw value up to end of line.
 */
const STATUS_LINE_REGEX = /^([ \t]*\*{0,2}status\*{0,2}[ \t]*:[ \t]*)([^\r\n]*)/im;

/**
 * Overwrites the `Status:` value of the plan file matched by `glob`, preserving
 * the label and any markdown decoration on it (e.g. `**Status**:`). Used to make
 * plan-state transitions that must be immediate and reliable from extension code
 * (e.g. flipping to `Integrating` when the user approves the UI) rather than
 * leaving them to a chat agent. Returns `true` if the file was updated.
 */
export async function writeProjectPlanStatus(glob: string, newStatus: string): Promise<boolean> {
    const [uri] = await vscode.workspace.findFiles(glob, undefined, 1);
    if (!uri) {
        return false;
    }

    let content: string;
    try {
        content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
    } catch {
        return false;
    }

    if (!STATUS_LINE_REGEX.test(content)) {
        return false;
    }
    // Replace only the value on the first `Status:` line, keeping the label
    // (and any `**`/`_` decoration around it) exactly as authored.
    const updated = content.replace(STATUS_LINE_REGEX, (_full, prefix: string) => `${prefix}${newStatus}`);
    if (updated === content) {
        return false;
    }

    await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf-8'));
    return true;
}

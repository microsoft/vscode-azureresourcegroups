/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtFsExtra } from "@microsoft/vscode-azext-utils";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ext } from "../../../../extensionVariables";

/**
 * Installs the local diagnostics hooks into the user's `~/.agents/hooks`
 * directory so the agent's own tool calls (read/edit/terminal/MCP) can be timed
 * and tagged with the active phase.
 *
 * This is additive and non-destructive: it copies our own `diagnostics-*`
 * scripts and merges our hook registrations into `hooks.json` while preserving
 * any existing entries (notably the code-signed `track-telemetry` hook, which is
 * never modified).
 */

const SCRIPT_FILES = [
    'diagnostics-pretool.ps1',
    'diagnostics-pretool.sh',
    'diagnostics-posttool.ps1',
    'diagnostics-posttool.sh',
] as const;

/** Stamp file recording which extension version last copied the scripts. */
const VERSION_STAMP_FILE = '.diagnostics-hooks-version';

interface HookCommandEntry {
    type: 'command';
    command: string;
    windows: string;
    linux: string;
    osx: string;
}

interface HooksConfig {
    hooks?: {
        PreToolUse?: HookCommandEntry[];
        PostToolUse?: HookCommandEntry[];
        [event: string]: HookCommandEntry[] | undefined;
    };
    [key: string]: unknown;
}

function hookEntry(scriptBase: string): HookCommandEntry {
    return {
        type: 'command',
        command: `bash --noprofile --norc -c 'cd "$HOME/.agents/hooks" && chmod +x ./scripts/${scriptBase}.sh && ./scripts/${scriptBase}.sh'`,
        windows: `powershell -NoProfile -ExecutionPolicy Bypass -Command "& { Set-Location (Join-Path $env:USERPROFILE '.agents\\hooks'); & '.\\scripts\\${scriptBase}.ps1' }"`,
        linux: `bash --noprofile --norc -c 'cd "$HOME/.agents/hooks" && chmod +x ./scripts/${scriptBase}.sh && ./scripts/${scriptBase}.sh'`,
        osx: `bash --noprofile --norc -c 'cd "$HOME/.agents/hooks" && chmod +x ./scripts/${scriptBase}.sh && ./scripts/${scriptBase}.sh'`,
    };
}

function getHomeHooksDir(): vscode.Uri {
    return vscode.Uri.file(path.join(os.homedir(), '.agents', 'hooks'));
}

function getBundledScriptsDir(): vscode.Uri {
    return vscode.Uri.joinPath(ext.context.extensionUri, '.agents', 'hooks', 'scripts');
}

function getExtensionVersion(): string {
    return (ext.context.extension.packageJSON as { version: string }).version;
}

async function readTextIfExists(uri: vscode.Uri): Promise<string | undefined> {
    if (!(await AzExtFsExtra.pathExists(uri))) {
        return undefined;
    }
    try {
        return await AzExtFsExtra.readFile(uri);
    } catch {
        return undefined;
    }
}

/** Copies the bundled diagnostics scripts into `~/.agents/hooks/scripts`, version-gated. */
async function copyScripts(hooksDir: vscode.Uri): Promise<void> {
    const version = getExtensionVersion();
    const stampUri = vscode.Uri.joinPath(hooksDir, VERSION_STAMP_FILE);
    if ((await readTextIfExists(stampUri))?.trim() === version) {
        return; // Scripts already current.
    }
    const scriptsDir = vscode.Uri.joinPath(hooksDir, 'scripts');
    await AzExtFsExtra.ensureDir(scriptsDir);
    const bundled = getBundledScriptsDir();
    for (const file of SCRIPT_FILES) {
        const src = vscode.Uri.joinPath(bundled, file);
        const content = await readTextIfExists(src);
        if (content !== undefined) {
            await AzExtFsExtra.writeFile(vscode.Uri.joinPath(scriptsDir, file), content);
        }
    }
    await AzExtFsExtra.writeFile(stampUri, version);
}

function hasEntryFor(entries: HookCommandEntry[] | undefined, scriptBase: string): boolean {
    return !!entries?.some((e) => JSON.stringify(e).includes(scriptBase));
}

/** Merges our Pre/PostToolUse entries into `hooks.json`, preserving existing hooks. */
async function ensureHookEntries(hooksDir: vscode.Uri): Promise<void> {
    const hooksJsonUri = vscode.Uri.joinPath(hooksDir, 'hooks.json');
    const existing = await readTextIfExists(hooksJsonUri);

    let config: HooksConfig;
    if (existing) {
        try {
            config = JSON.parse(existing) as HooksConfig;
        } catch {
            // Don't clobber a file we can't parse.
            ext.outputChannel.appendLog('[ProjectDiagnostics] ~/.agents/hooks/hooks.json is not valid JSON; skipping hook registration.');
            return;
        }
    } else {
        config = {};
    }

    config.hooks ??= {};
    config.hooks.PreToolUse ??= [];
    config.hooks.PostToolUse ??= [];

    let changed = false;
    if (!hasEntryFor(config.hooks.PreToolUse, 'diagnostics-pretool')) {
        config.hooks.PreToolUse.push(hookEntry('diagnostics-pretool'));
        changed = true;
    }
    if (!hasEntryFor(config.hooks.PostToolUse, 'diagnostics-posttool')) {
        config.hooks.PostToolUse.push(hookEntry('diagnostics-posttool'));
        changed = true;
    }

    if (changed) {
        await AzExtFsExtra.writeFile(hooksJsonUri, `${JSON.stringify(config, null, 4)}\n`);
    }
}

/**
 * Best-effort installation of the diagnostics hooks. Safe to call on every
 * activation — it is idempotent and only writes when something is missing or
 * out of date. Never throws.
 */
export async function installDiagnosticsHooks(): Promise<void> {
    try {
        const hooksDir = getHomeHooksDir();
        await AzExtFsExtra.ensureDir(hooksDir);
        await copyScripts(hooksDir);
        await ensureHookEntries(hooksDir);
        ext.outputChannel.appendLog('[ProjectDiagnostics] Diagnostics hooks installed/verified in ~/.agents/hooks.');
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ext.outputChannel.appendLog(`[ProjectDiagnostics] Failed to install diagnostics hooks: ${message}`);
    }
}

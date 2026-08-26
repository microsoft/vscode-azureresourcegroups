/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Activation shim for the debug probe.
 *
 * Harmless by default: with no `debug-probe.json` in the workspace the extension
 * activates, records that it did, and does nothing else. That makes it safe to
 * install unconditionally alongside the product VSIX.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Recorder, runProbe } from './probe';
import { parseProbeSpec, SpecError } from './spec';
import type { DebugProbeVerdict, ProbeSpec } from './verdict';
import { PROBE_SCHEMA_VERSION, SPEC_RELATIVE_PATH, VERDICT_RELATIVE_PATH } from './verdict';

/** Overrides where the spec is read from. Lets a stimulus keep it out of the project tree. */
const SPEC_PATH_ENV_VAR = 'COR_DEBUG_PROBE_SPEC';

/**
 * Append to `.eval/probe.log` the moment we activate, before anything can fail.
 *
 * "Never activated" and "activated then stalled" are indistinguishable from
 * outside the container and have completely different owners. Workspace Trust
 * blocks activation outright and its only symptom is an absent verdict, so this
 * breadcrumb is the difference between a diagnosis and a shrug. Written with
 * plain `fs` rather than `workspace.fs` so it cannot itself await anything.
 */
function breadcrumb(folder: vscode.WorkspaceFolder, message: string): void {
    try {
        const dir = path.join(folder.uri.fsPath, '.eval');
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, 'probe.log'), `${new Date().toISOString()} ${message}\n`, 'utf8');
    } catch {
        // Best effort by definition — there is nowhere else to report this.
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        console.log('[cor-debug-probe] no workspace folder — idle');
        return;
    }

    const recorder = new Recorder();
    breadcrumb(folder, `activated; trusted=${vscode.workspace.isTrusted}; folder=${folder.uri.fsPath}`);
    recorder.log(`activated; trusted=${vscode.workspace.isTrusted}; folder=${folder.uri.fsPath}`);

    const specUri = specLocation(folder);
    let spec: ProbeSpec | undefined;
    try {
        const raw = await readJson(specUri);
        if (raw === undefined) {
            recorder.log(`no ${SPEC_RELATIVE_PATH} — probe idle`);
            return;
        }
        spec = parseProbeSpec(raw);
        const verdict = await runProbe({ folder, spec, subscriptions: context.subscriptions }, recorder);
        await writeVerdict(folder, verdict, recorder);
        await maybeQuit(spec);
    } catch (error) {
        // Anything escaping runProbe is a harness fault by construction: every
        // way the product can fail is already classified into an outcome inside it.
        const detail = error instanceof SpecError
            ? `${SPEC_RELATIVE_PATH} is malformed: ${error.message}`
            : error instanceof Error ? (error.stack ?? error.message) : String(error);
        await writeVerdict(folder, {
            schemaVersion: PROBE_SCHEMA_VERSION,
            outcome: 'probeError',
            detail,
            spec,
            timeline: recorder.timeline,
            output: recorder.output,
        }, recorder);
        await maybeQuit(spec);
    }
}

function specLocation(folder: vscode.WorkspaceFolder): vscode.Uri {
    const override = process.env[SPEC_PATH_ENV_VAR];
    return override ? vscode.Uri.file(override) : vscode.Uri.joinPath(folder.uri, SPEC_RELATIVE_PATH);
}

async function readJson(uri: vscode.Uri): Promise<unknown | undefined> {
    let bytes: Uint8Array;
    try {
        bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
        return undefined;
    }
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

async function writeVerdict(folder: vscode.WorkspaceFolder, verdict: DebugProbeVerdict, recorder: Recorder): Promise<void> {
    const target = vscode.Uri.joinPath(folder.uri, VERDICT_RELATIVE_PATH);
    try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
        await vscode.workspace.fs.writeFile(target, Buffer.from(`${JSON.stringify(verdict, null, 2)}\n`, 'utf8'));
        recorder.log(`verdict: ${verdict.outcome}`);
    } catch (error) {
        // Nothing left to write the failure into; the grader treats a missing
        // verdict as a harness fault, which is the correct reading of this.
        console.error(`[cor-debug-probe] could not write verdict: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function maybeQuit(spec: ProbeSpec | undefined): Promise<void> {
    if (!spec?.exitWhenDone) {
        return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    await vscode.commands.executeCommand('workbench.action.quit');
}

export function deactivate(): void { /* nothing to clean up */ }

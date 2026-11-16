/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdtemp, rm, utimes } from 'fs/promises';
import { mock } from 'node:test';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { findAppOnboardArtifact } from '../../src/tree/project/findAppOnboardArtifact';
import { APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB } from '../../src/tree/project/projectPlanFiles';

suite('findAppOnboardArtifact', () => {
    let folder: vscode.WorkspaceFolder;

    setup(async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'cor-artifact-'));
        folder = { uri: vscode.Uri.file(directory), index: 0, name: 'artifact-resolution' };
    });

    teardown(async () => {
        mock.restoreAll();
        await rm(folder.uri.fsPath, { recursive: true, force: true });
    });

    async function write(relativePath: string, value: unknown, modifiedSeconds = 100): Promise<vscode.Uri> {
        const uri = vscode.Uri.joinPath(folder.uri, relativePath);
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(value)));
        await utimes(uri.fsPath, modifiedSeconds, modifiedSeconds);
        return uri;
    }

    test('prefers the active session plan over newer competing and root plans', async () => {
        const active = await write('.copilot-azure/sessions/active/prepare-plan.json', { sessionId: 'active' });
        await write('.copilot-azure/sessions/older/prepare-plan.json', { sessionId: 'older' }, 300);
        await write('.azure/prepare-plan.json', { sessionId: 'older' }, 400);
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'active' });

        assert.strictEqual((await findAppOnboardArtifact('prepare-plan.json', folder))?.toString(), active.toString());
    });

    test('uses the root fallback only when it belongs to the active session', async () => {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.copilot-azure/sessions/active'));
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'active' });
        const root = await write('.azure/prepare-plan.json', { deploymentVariables: { sessionId: 'active' } });
        await write('.copilot-azure/sessions/older/prepare-plan.json', { sessionId: 'older' }, 300);

        assert.strictEqual((await findAppOnboardArtifact('prepare-plan.json', folder))?.toString(), root.toString());
    });

    test('does not show an older plan while the active session is still preparing', async () => {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.copilot-azure/sessions/active'));
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'active' });
        await write('.azure/prepare-plan.json', { sessionId: 'older' }, 300);
        await write('.copilot-azure/sessions/older/prepare-plan.json', { sessionId: 'older' }, 400);

        assert.strictEqual(await findAppOnboardArtifact('prepare-plan.json', folder), undefined);
    });

    test('recovers the newest plan when the pointer is missing', async () => {
        await write('.azure/prepare-plan.json', { sessionId: 'older' });
        const newest = await write('.copilot-azure/sessions/newest/prepare-plan.json', { sessionId: 'newest' }, 300);

        assert.strictEqual((await findAppOnboardArtifact('prepare-plan.json', folder))?.toString(), newest.toString());
    });

    test('recovers the newest plan when the pointer names a removed session', async () => {
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'removed' });
        const newest = await write('.azure/prepare-plan.json', { sessionId: 'newest' }, 300);
        await write('.copilot-azure/sessions/older/prepare-plan.json', { sessionId: 'older' });

        assert.strictEqual((await findAppOnboardArtifact('prepare-plan.json', folder))?.toString(), newest.toString());
    });

    test('breaks equal-timestamp recovery ties deterministically', async () => {
        const first = await write('.copilot-azure/sessions/a/prepare-plan.json', {});
        await write('.copilot-azure/sessions/z/prepare-plan.json', {});

        assert.strictEqual((await findAppOnboardArtifact('prepare-plan.json', folder))?.toString(), first.toString());
    });

    test('returns undefined when no plan exists', async () => {
        assert.strictEqual(await findAppOnboardArtifact('prepare-plan.json', folder), undefined);
    });

    for (const pointer of [null, [], {}, { activeSessionId: 7 }, { activeSessionId: '' }, { activeSessionId: '..' }, { activeSessionId: '../outside' }, { activeSessionId: 'a/b' }, { activeSessionId: 'a\\b' }, { activeSessionId: '%2e%2e' }]) {
        test(`recovers safely from an invalid pointer ${JSON.stringify(pointer)}`, async () => {
            await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, pointer);
            const plan = await write('.azure/prepare-plan.json', {});

            assert.strictEqual((await findAppOnboardArtifact('prepare-plan.json', folder))?.toString(), plan.toString());
        });
    }

    test('recovers safely while the pointer contains a partial JSON write', async () => {
        const pointer = await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, {});
        await vscode.workspace.fs.writeFile(pointer, Buffer.from('{"activeSessionId":'));
        const plan = await write('.azure/prepare-plan.json', {});

        assert.strictEqual((await findAppOnboardArtifact('prepare-plan.json', folder))?.toString(), plan.toString());
    });

    test('does not trust an unscoped root plan for a valid active session', async () => {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.copilot-azure/sessions/active'));
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'active' });
        await write('.azure/prepare-plan.json', { deploymentVariables: { sessionId: 7 } });

        assert.strictEqual(await findAppOnboardArtifact('prepare-plan.json', folder), undefined);
    });

    test('can resolve a deploy result with the same active-session rules', async () => {
        const active = await write('.copilot-azure/sessions/active/deploy-result.json', { sessionId: 'active' });
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'active' });
        await write('.copilot-azure/sessions/older/deploy-result.json', { sessionId: 'older' }, 300);

        assert.strictEqual((await findAppOnboardArtifact('deploy-result.json', folder))?.toString(), active.toString());
    });

    test('prefers an active session in another workspace folder over timestamp recovery', async () => {
        await write('.azure/prepare-plan.json', {}, 500);
        const secondUri = vscode.Uri.joinPath(folder.uri, 'second-project');
        const active = await write('second-project/.copilot-azure/sessions/active/prepare-plan.json', {});
        await write('second-project/.copilot-azure/sessions/active-session.json', { activeSessionId: 'active' });
        mock.method(vscode.workspace, 'workspaceFolders', () => [folder, { uri: secondUri, index: 1, name: 'second-project' }], { getter: true });

        assert.strictEqual((await findAppOnboardArtifact('prepare-plan.json'))?.toString(), active.toString());
    });

    test('does not borrow a same-named session from another workspace folder', async () => {
        const active = await write('.copilot-azure/sessions/active/prepare-plan.json', {});
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'active' });
        await write('second-project/.copilot-azure/sessions/active/prepare-plan.json', {}, 500);
        const second = { uri: vscode.Uri.joinPath(folder.uri, 'second-project'), index: 1, name: 'second-project' };
        mock.method(vscode.workspace, 'workspaceFolders', () => [folder, second], { getter: true });

        assert.strictEqual((await findAppOnboardArtifact('prepare-plan.json'))?.toString(), active.toString());
    });

    test('does not recover another project plan while an active session is preparing', async () => {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.copilot-azure/sessions/active'));
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'active' });
        await write('second-project/.azure/prepare-plan.json', {}, 500);
        const second = { uri: vscode.Uri.joinPath(folder.uri, 'second-project'), index: 1, name: 'second-project' };
        mock.method(vscode.workspace, 'workspaceFolders', () => [folder, second], { getter: true });

        assert.strictEqual(await findAppOnboardArtifact('prepare-plan.json'), undefined);
    });
});

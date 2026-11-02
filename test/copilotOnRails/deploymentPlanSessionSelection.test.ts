/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTestActionContext } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import { mkdtemp, rm } from 'fs/promises';
import { mock } from 'node:test';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { resourcesExtensionId } from '../../src/constants';
import { ext } from '../../src/extensionVariables';
import { APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, PREPARE_PLAN_SESSION_FILE_GLOB } from '../../src/tree/project/projectPlanFiles';
import { ensureRequiredCopilotOnRailsContext } from '../../src/utils/copilotOnRails/CopilotOnRailsContext';
import { isJsonObject } from '../../src/webviews/copilotOnRails/shared/jsonUtils';
import { isDeploymentPlanViewOpen, openDeploymentPlanViewFromWorkspace, recordDeployPrerequisites, registerDeploymentPlanAutoOpen } from '../../src/webviews/copilotOnRails/extension/openDeploymentPlanView';
import { getDeployPrerequisites } from '../../src/webviews/copilotOnRails/extension/utils/deployPrerequisites';
import { isDeploymentPlanApproved, recordDeploymentPlanApproved } from '../../src/webviews/copilotOnRails/extension/utils/deploymentPlanApprovalState';
import { MockAzureSubscriptionProvider } from '../api/MockAzureSubscriptionProvider';
import { MockResources } from '../api/mockServiceFactory';

suite('deployment plan session selection', function () {
    this.timeout(10_000);
    let folder: vscode.WorkspaceFolder;
    let provider: MockAzureSubscriptionProvider;
    let subscriptions: vscode.Disposable[];
    let panels: vscode.WebviewPanel[];
    let renders: { region: unknown; approved: unknown }[];
    let watchers: Map<string, { create: vscode.EventEmitter<vscode.Uri>; change: vscode.EventEmitter<vscode.Uri> }>;
    let previousContext: vscode.ExtensionContext;
    let previousProviderFactory: typeof ext.subscriptionProviderFactory;

    setup(async () => {
        folder = { uri: vscode.Uri.file(await mkdtemp(path.join(os.tmpdir(), 'cor-plan-view-'))), name: 'plan-view', index: 0 };
        subscriptions = [];
        panels = [];
        renders = [];
        watchers = new Map();
        provider = new MockAzureSubscriptionProvider(new MockResources());
        previousContext = ext.context;
        previousProviderFactory = ext.subscriptionProviderFactory;
        ext.subscriptionProviderFactory = async () => provider;
        const extension = vscode.extensions.getExtension(resourcesExtensionId);
        assert.ok(extension);
        const values = new Map<string, unknown>();
        const state = {
            keys: () => [...values.keys()],
            get: <T>(key: string, defaultValue?: T): T => (values.get(key) ?? defaultValue) as T,
            update: async (key: string, value: unknown): Promise<void> => { values.set(key, value); },
            setKeysForSync: (): void => { throw new Error('Unexpected state synchronization'); },
        };
        // Source modules have their own ext singleton, separate from the bundled extension.
        ext.context = {
            subscriptions,
            workspaceState: state,
            globalState: state,
            extension,
            extensionPath: extension.extensionPath,
            extensionUri: extension.extensionUri,
            extensionMode: vscode.ExtensionMode.Test,
            asAbsolutePath: relative => path.join(extension.extensionPath, relative),
            storageUri: folder.uri,
            storagePath: folder.uri.fsPath,
            globalStorageUri: folder.uri,
            globalStoragePath: folder.uri.fsPath,
            logUri: folder.uri,
            logPath: folder.uri.fsPath,
            get secrets(): vscode.SecretStorage { throw new Error('Unexpected secret access'); },
            get environmentVariableCollection(): vscode.GlobalEnvironmentVariableCollection { throw new Error('Unexpected terminal access'); },
            get languageModelAccessInformation(): vscode.LanguageModelAccessInformation { throw new Error('Unexpected language model access'); },
        };
        mock.method(vscode.workspace, 'workspaceFolders', () => [folder], { getter: true });
        mock.method(vscode.workspace, 'createFileSystemWatcher', (pattern: vscode.GlobPattern): vscode.FileSystemWatcher => {
            const create = new vscode.EventEmitter<vscode.Uri>();
            const change = new vscode.EventEmitter<vscode.Uri>();
            const remove = new vscode.EventEmitter<vscode.Uri>();
            const watcher: vscode.FileSystemWatcher = {
                ignoreCreateEvents: false,
                ignoreChangeEvents: false,
                ignoreDeleteEvents: false,
                onDidCreate: create.event,
                onDidChange: change.event,
                onDidDelete: remove.event,
                dispose: () => { create.dispose(); change.dispose(); remove.dispose(); },
            };
            watchers.set(typeof pattern === 'string' ? pattern : pattern.pattern, { create, change });
            subscriptions.push(watcher);
            return watcher;
        });
        const createPanel = vscode.window.createWebviewPanel;
        mock.method(vscode.window, 'createWebviewPanel', (...args: Parameters<typeof createPanel>) => {
            const panel = createPanel(...args);
            panels.push(panel);
            const postMessage = panel.webview.postMessage.bind(panel.webview);
            mock.method(panel.webview, 'postMessage', (message: unknown) => {
                if (isJsonObject(message) && message.command === 'setDeploymentPlanData' && isJsonObject(message.data)) {
                    renders.push({ region: message.data.locationCode, approved: message.data.approved });
                }
                return postMessage(message);
            });
            return panel;
        });
        registerDeploymentPlanAutoOpen(ext.context);
    });

    teardown(async () => {
        for (const panel of panels) {
            panel.dispose();
        }
        for (const disposable of subscriptions) {
            disposable.dispose();
        }
        mock.restoreAll();
        ext.context = previousContext;
        ext.subscriptionProviderFactory = previousProviderFactory;
        await rm(folder.uri.fsPath, { recursive: true, force: true });
    });

    async function write(relativePath: string, value: unknown): Promise<vscode.Uri> {
        const uri = vscode.Uri.joinPath(folder.uri, relativePath);
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(value)));
        return uri;
    }

    async function plan(sessionId: string, region: string): Promise<vscode.Uri> {
        return write(`.copilot-azure/sessions/${sessionId}/prepare-plan.json`, {
            services: [{ name: 'Functions', sku: 'FC1', resourceName: 'api', region }],
            deploymentVariables: { sessionId, location: region },
        });
    }

    async function open(): Promise<void> {
        await openDeploymentPlanViewFromWorkspace(ensureRequiredCopilotOnRailsContext(await createTestActionContext()));
    }

    async function waitForRegion(region: string): Promise<void> {
        const deadline = Date.now() + 3000;
        while (renders[renders.length - 1]?.region !== region && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.strictEqual(renders[renders.length - 1]?.region, region);
    }

    test('inactive-session creations cannot replace the open active plan', async () => {
        await plan('active', 'eastus');
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'active' });
        await open();
        await waitForRegion('eastus');
        const renderCount = renders.length;
        const older = await plan('older', 'westus');
        watchers.get(PREPARE_PLAN_SESSION_FILE_GLOB)?.create.fire(older);
        await new Promise(resolve => setTimeout(resolve, 300));

        assert.strictEqual(renders.length, renderCount);
        assert.strictEqual(panels.length, 1);
    });

    test('pointer changes update an open view but do not reopen a closed view', async () => {
        await plan('first', 'eastus');
        await plan('second', 'westus');
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'first' });
        await open();
        await waitForRegion('eastus');
        const pointer = await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'second' });
        watchers.get(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB)?.change.fire(pointer);
        await waitForRegion('westus');
        assert.strictEqual(panels.length, 1);

        panels[0].dispose();
        assert.strictEqual(isDeploymentPlanViewOpen(), false);
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'first' });
        watchers.get(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB)?.change.fire(pointer);
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.strictEqual(panels.length, 1);
        assert.strictEqual(isDeploymentPlanViewOpen(), false);
    });

    test('a delayed open cannot overwrite a newly selected session', async () => {
        await plan('first', 'eastus');
        await plan('second', 'westus');
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'first' });
        let release: (() => void) | undefined;
        let signalStarted: (() => void) | undefined;
        const started = new Promise<void>(resolve => { signalStarted = resolve; });
        const blocked = new Promise<void>(resolve => { release = resolve; });
        let calls = 0;
        mock.method(provider, 'getAvailableSubscriptions', async () => {
            if (++calls === 1) {
                signalStarted?.();
                await blocked;
            }
            return [];
        });

        const firstOpen = open();
        try {
            await started;
            await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'second' });
            await open();
            await waitForRegion('westus');
        } finally {
            release?.();
            await firstOpen;
        }

        assert.ok(renders.every(render => render.region === 'westus'));
    });

    test('a pending active session closes the previous plan until its own plan appears', async () => {
        await plan('first', 'eastus');
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'first' });
        await open();
        await waitForRegion('eastus');
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.copilot-azure/sessions/second'));

        const pointer = await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'second' });
        watchers.get(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB)?.change.fire(pointer);
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.strictEqual(isDeploymentPlanViewOpen(), false);

        const second = await plan('second', 'westus');
        watchers.get(PREPARE_PLAN_SESSION_FILE_GLOB)?.create.fire(second);
        await waitForRegion('westus');
        assert.strictEqual(isDeploymentPlanViewOpen(), true);
    });

    test('a delayed pointer refresh cannot reopen a view closed while regions load', async () => {
        await plan('first', 'eastus');
        await plan('second', 'westus');
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'first' });
        await open();
        await waitForRegion('eastus');
        let release: (() => void) | undefined;
        let signalStarted: (() => void) | undefined;
        const started = new Promise<void>(resolve => { signalStarted = resolve; });
        const blocked = new Promise<void>(resolve => { release = resolve; });
        mock.method(provider, 'getAvailableSubscriptions', async () => {
            signalStarted?.();
            await blocked;
            return [];
        });

        const pointer = await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'second' });
        watchers.get(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB)?.change.fire(pointer);
        try {
            await started;
            panels[0].dispose();
        } finally {
            release?.();
        }
        await new Promise(resolve => setTimeout(resolve, 300));

        assert.strictEqual(panels.length, 1);
        assert.strictEqual(isDeploymentPlanViewOpen(), false);
        assert.ok(renders.every(render => render.region === 'eastus'));
    });

    test('prerequisites and approval remain tied to the selected artifact and content', async () => {
        const active = await plan('active', 'eastus');
        const older = await plan('older', 'westus');
        await write(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, { activeSessionId: 'active' });
        const content = Buffer.from(await vscode.workspace.fs.readFile(active)).toString('utf-8');
        await recordDeploymentPlanApproved(active, content);
        const prerequisites = [{ tool: 'az', installed: true, version: 'test' }];
        assert.strictEqual(await recordDeployPrerequisites(prerequisites), true);
        assert.deepStrictEqual(getDeployPrerequisites(active), prerequisites);
        assert.notDeepStrictEqual(getDeployPrerequisites(older), prerequisites);

        await open();
        await waitForRegion('eastus');
        assert.strictEqual(renders[renders.length - 1]?.approved, true);
        assert.strictEqual(isDeploymentPlanApproved(active, `${content} `), false);
        assert.strictEqual(isDeploymentPlanApproved(older, content), false);
    });
});

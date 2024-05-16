/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TenantIdDescription } from '@azure/arm-resources-subscriptions';
import { AzureSubscriptionProvider, getConfiguredAzureEnv } from '@microsoft/vscode-azext-azureauth';
import { IActionContext, IAzureQuickPickItem, IParsedError, callWithTelemetryAndErrorHandlingSync, nonNullProp, parseError } from '@microsoft/vscode-azext-utils';
import * as cp from 'child_process';
import * as FormData from 'form-data';
import { ReadStream } from 'fs';
import { ClientRequest } from 'http';
import { Socket } from 'net';
import * as path from 'path';
import * as semver from 'semver';
import { UrlWithStringQuery, parse } from 'url';
import { CancellationToken, EventEmitter, MessageItem, Terminal, TerminalOptions, TerminalProfile, ThemeIcon, Uri, authentication, commands, env, window, workspace } from 'vscode';
import { ext } from '../extensionVariables';
import { localize } from '../utils/localize';
import { fetchWithLogging } from '../utils/logging/nodeFetch/nodeFetch';
import { CloudShell, CloudShellInternal, CloudShellStatus, UploadOptions } from './CloudShellInternal';
import { Deferred, delay, logAttemptingToReachUrlMessage } from './cloudConsoleUtils';
import { readJSON } from './cloudShellChildProcess/readJSON';
import { Queue, Server, createServer } from './ipc';

function ensureEndingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
}

function getArmEndpoint(): string {
    return ensureEndingSlash(getConfiguredAzureEnv().resourceManagerEndpointUrl);
}

interface OS {
    id: 'linux' | 'windows';
    shellName: string;
    otherOS: OS;
}

export type OSName = 'Linux' | 'Windows';

type OSes = { Linux: OS, Windows: OS };

export const OSes: OSes = {
    Linux: {
        id: 'linux',
        shellName: localize('bash', "Bash"),
        get otherOS(): OS { return OSes.Windows; },
    },
    Windows: {
        id: 'windows',
        shellName: localize('powershell', "PowerShell"),
        get otherOS(): OS { return OSes.Linux; },
    }
};

async function waitForConnection(this: CloudShell): Promise<boolean> {
    const handleStatus = () => {
        switch (this.status) {
            case 'Connecting':
                return new Promise<boolean>(resolve => {
                    const subs = this.onStatusChanged(() => {
                        subs.dispose();
                        resolve(handleStatus());
                    });
                });
            case 'Connected':
                return true;
            case 'Disconnected':
                return false;
            default:
                const status: never = this.status;
                throw new Error(`Unexpected status '${status}'`);
        }
    };
    return handleStatus();
}

function getUploadFile(tokens: Promise<AccessTokens>, uris: Promise<ConsoleUris>): (this: CloudShell, filename: string, stream: ReadStream, options?: UploadOptions) => Promise<void> {
    return async function (this: CloudShell, filename: string, stream: ReadStream, options: UploadOptions = {}) {
        if (options.progress) {
            options.progress.report({ message: localize('connectingForUpload', "Connecting to upload '{0}'...", filename) });
        }

        const accessTokens: AccessTokens = await tokens;
        const { terminalUri } = await uris;

        if (options.token && options.token.isCancellationRequested) {
            throw 'canceled';
        }

        return new Promise<void>((resolve, reject) => {
            const form = new FormData();
            form.append('uploading-file', stream, {
                filename,
                knownLength: options.contentLength
            });
            const uploadUri: string = `${terminalUri}/upload`;
            logAttemptingToReachUrlMessage(uploadUri);
            const uri: UrlWithStringQuery = parse(uploadUri);
            const req: ClientRequest = form.submit(
                {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
                    protocol: <any>uri.protocol,
                    hostname: uri.hostname,
                    port: uri.port,
                    path: uri.path,
                    headers: {
                        'Authorization': `Bearer ${accessTokens.resource}`
                    },
                },
                (err, res) => {
                    if (err) {
                        reject(err);
                    } if (res && res.statusCode && (res.statusCode < 200 || res.statusCode > 299)) {
                        reject(`${res.statusMessage} (${res.statusCode})`)
                    } else {
                        resolve();
                    }
                    if (res) {
                        res.resume(); // Consume response.
                    }
                }
            );

            if (options.token) {
                options.token.onCancellationRequested(() => {
                    reject('canceled');
                    req.abort();
                });
            }
            if (options.progress) {
                req.on('socket', (socket: Socket) => {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    options.progress!.report({
                        message: localize('uploading', "Uploading '{0}'...", filename),
                        increment: 0
                    });

                    let previous: number = 0;
                    socket.on('drain', () => {
                        const total: number = req.getHeader('Content-Length') as number;
                        if (total) {
                            const worked: number = Math.min(Math.round(100 * socket.bytesWritten / total), 100);
                            const increment: number = worked - previous;
                            if (increment) {
                                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                                options.progress!.report({
                                    message: localize('uploading', "Uploading '{0}'...", filename),
                                    increment
                                });
                            }
                            previous = worked;
                        }
                    });
                });
            }
        });
    }
}

export const shells: CloudShellInternal[] = [];
export function createCloudConsole(subscriptionProvider: AzureSubscriptionProvider, osName: OSName, terminalProfileToken?: CancellationToken): CloudShellInternal {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return (callWithTelemetryAndErrorHandlingSync('azureResourceGroups.createCloudConsole', (context: IActionContext) => {

        const os: OS = OSes[osName];
        context.telemetry.properties.cloudShellType = os.shellName;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let liveServerQueue: Queue<any> | undefined;
        const event: EventEmitter<CloudShellStatus> = new EventEmitter<CloudShellStatus>();
        let deferredTerminal: Deferred<Terminal>;
        let deferredTerminalProfile: Deferred<TerminalProfile>;
        // let deferredSession: Deferred<AzureSession>;
        let deferredTokens: Deferred<AccessTokens>;
        const tokensPromise: Promise<AccessTokens> = new Promise<AccessTokens>((resolve, reject) => deferredTokens = { resolve, reject });
        let deferredUris: Deferred<ConsoleUris>;
        const urisPromise: Promise<ConsoleUris> = new Promise<ConsoleUris>((resolve, reject) => deferredUris = { resolve, reject });
        let deferredInitialSize: Deferred<Size>;
        const initialSizePromise: Promise<Size> = new Promise<Size>((resolve, reject) => deferredInitialSize = { resolve, reject });
        const state: CloudShellInternal = {
            status: 'Connecting',
            onStatusChanged: event.event,
            waitForConnection,
            terminal: new Promise<Terminal>((resolve, reject) => deferredTerminal = { resolve, reject }),
            terminalProfile: new Promise<TerminalProfile>((resolve, reject) => deferredTerminalProfile = { resolve, reject }),
            // session: new Promise<AzureSession>((resolve, reject) => deferredSession = { resolve, reject }),
            uploadFile: getUploadFile(tokensPromise, urisPromise)
        };

        // eslint-disable-next-line @typescript-eslint/no-empty-function
        state.terminal?.catch(() => { }); // ignore
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        // state.session.catch(() => { }); // ignore
        shells.push(state);

        function updateStatus(status: CloudShellStatus) {
            state.status = status;
            event.fire(state.status);
            if (status === 'Disconnected') {
                deferredTerminal.reject(status);
                deferredTerminalProfile.reject(status);
                // deferredSession.reject(status);
                deferredTokens.reject(status);
                deferredUris.reject(status);
                shells.splice(shells.indexOf(state), 1);
                void commands.executeCommand('setContext', 'azureResourcesOpenCloudConsoleCount', `${shells.length}`);
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (async function (): Promise<any> {
            if (!workspace.isTrusted) {
                updateStatus('Disconnected');
                return requiresWorkspaceTrust(context);
            }

            void commands.executeCommand('setContext', 'azureResourcesOpenCloudConsoleCount', `${shells.length}`);

            const isWindows: boolean = process.platform === 'win32';
            if (isWindows) {
                // See below
                try {
                    const { stdout } = await exec('node.exe --version');
                    const version: string | boolean = stdout[0] === 'v' && stdout.substr(1).trim();
                    if (version && semver.valid(version) && !semver.gte(version, '6.0.0')) {
                        updateStatus('Disconnected');
                        return requiresNode(context);
                    }
                } catch (err) {
                    updateStatus('Disconnected');
                    return requiresNode(context);
                }
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const serverQueue: Queue<any> = new Queue<any>();
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            const server: Server = await createServer('vscode-cloud-console', async (req, res) => {
                let dequeue: boolean = false;
                for (const message of await readJSON(req)) {
                    /* eslint-disable @typescript-eslint/no-unsafe-member-access */
                    if (message.type === 'poll') {
                        dequeue = true;
                    } else if (message.type === 'log') {
                        Array.isArray(message.args) && ext.outputChannel.appendLog((<string[]>message.args).join(' '));
                    } else if (message.type === 'size') {
                        deferredInitialSize.resolve(message.size as Size);
                    } else if (message.type === 'status') {
                        updateStatus(message.status as CloudShellStatus);
                    }
                }

                let response = [];
                if (dequeue) {
                    try {
                        response = await serverQueue.dequeue(60000);
                    } catch (err) {
                        // ignore timeout
                    }
                }
                res.write(JSON.stringify(response));
                res.end();
            });

            if (!await subscriptionProvider.isSignedIn()) {
                serverQueue.push({ type: 'log', args: [localize('loggingIn', "Signing in...")] });
                try {
                    if (await subscriptionProvider.signIn()) {
                        serverQueue.push({ type: 'log', args: [localize('loggingIn', "Signed in successful.")] });
                    }
                } catch (e) {
                    serverQueue.push({ type: 'log', args: [localize('loggingIn', parseError(e).message)] });
                    // We used to delay for a second then exit here, but then the user can't read or copy the error message
                    // await delay(1000);
                    // serverQueue.push({ type: 'exit' });
                    updateStatus('Disconnected');
                    return;
                }
            }

            // open terminal
            let shellPath: string = path.join(ext.context.asAbsolutePath('bin'), `node.${isWindows ? 'bat' : 'sh'}`);
            let cloudConsoleLauncherPath: string = path.join(ext.context.asAbsolutePath('dist'), 'cloudConsoleLauncher');
            if (isWindows) {
                cloudConsoleLauncherPath = cloudConsoleLauncherPath.replace(/\\/g, '\\\\');
            }
            const shellArgs: string[] = [
                process.execPath,
                '-e',
                `require('${cloudConsoleLauncherPath}').main()`,
            ];

            if (isWindows) {
                // Work around https://github.com/electron/electron/issues/4218 https://github.com/nodejs/node/issues/11656
                shellPath = 'node.exe';
                shellArgs.shift();
            }

            const terminalOptions: TerminalOptions = {
                name: localize('azureCloudShell', 'Azure Cloud Shell ({0})', os.shellName),
                iconPath: new ThemeIcon('azure'),
                shellPath,
                shellArgs,
                env: {
                    // Child process uses this ipc handle to communicate with the extension host
                    CLOUD_CONSOLE_IPC: server.ipcHandlePath,
                },
                isTransient: true
            };

            const cleanupCloudShell = () => {
                liveServerQueue = undefined;
                server.dispose();
                updateStatus('Disconnected');
            }

            // Open the appropriate type of VS Code terminal depending on the entry point
            if (terminalProfileToken) {
                // Entry point: Terminal profile provider
                const terminalProfileCloseSubscription = terminalProfileToken.onCancellationRequested(() => {
                    terminalProfileCloseSubscription.dispose();
                    cleanupCloudShell();
                });

                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                deferredTerminalProfile!.resolve(new TerminalProfile(terminalOptions));
            } else {
                // Entry point: Extension API
                const terminal: Terminal = window.createTerminal(terminalOptions);
                const terminalCloseSubscription = window.onDidCloseTerminal(t => {
                    if (t === terminal) {
                        terminalCloseSubscription.dispose();
                        cleanupCloudShell();
                    }
                });

                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                deferredTerminal!.resolve(terminal);
            }

            liveServerQueue = serverQueue;

            const tenants = await subscriptionProvider.getTenants();
            let selectedTenant: TenantIdDescription | undefined = undefined;

            if (tenants.length <= 1) {
                serverQueue.push({ type: 'log', args: [localize('foundOneTenant', `Found 1 tenant.`)] });
                // if they have only one tenant, use it
                selectedTenant = tenants[0];
            } else {
                // If the user has multiple tenants, then we check which tenants have subscriptions.
                // This also checks if this tenant is authenticated.
                // If a tenant is not authenticated, users will have to use the "Sign in to Directory..." command before launching cloud shell.
                const tenantsIdsWithSubs = new Set<string>();
                const subscriptions = await subscriptionProvider.getSubscriptions(false);
                subscriptions.forEach((sub) => {
                    tenantsIdsWithSubs.add(sub.tenantId);
                });
                const tenantsWithSubs = tenants.filter(tenant => tenantsIdsWithSubs.has(nonNullProp(tenant, 'tenantId')));
                serverQueue.push({ type: 'log', args: [localize('foundTenants', `Found ${tenantsWithSubs.length} authenticated tenant${tenants.length > 1 ? 's' : ''}. Please use the "Sign in to directory..." command to sign in to additional tenants.`)] });

                if (tenantsWithSubs.length <= 1) {
                    // If they have only one tenant with subscriptions, use it. If there's no tenant with subscriptions, use the first tenant.
                    selectedTenant = tenantsWithSubs[0] ?? tenants[0];
                } else {
                    // Multipe tenants with subscriptions, user must pick a tenant
                    serverQueue.push({ type: 'log', args: [localize('selectingTenant', `Selecting tenant...`)] });
                    const picks = tenantsWithSubs.map(tenant => {
                        const defaultDomainName: string | undefined = tenant.defaultDomain;
                        return <IAzureQuickPickItem<TenantIdDescription>>{
                            label: tenant.displayName,
                            description: defaultDomainName,
                            data: tenant,
                        };
                    }).sort((a, b) => a.label.localeCompare(b.label));

                    const pick = await window.showQuickPick<IAzureQuickPickItem<TenantIdDescription>>(picks, {
                        placeHolder: localize('selectDirectoryPlaceholder', "Select tenant"),
                        ignoreFocusOut: true // The terminal opens concurrently and can steal focus (https://github.com/microsoft/vscode-azure-account/issues/77).
                    });

                    if (!pick) {
                        context.telemetry.properties.outcome = 'noTenantPicked';
                        serverQueue.push({ type: 'exit' });
                        updateStatus('Disconnected');
                        return;
                    }
                    selectedTenant = pick.data;
                }
            }
            serverQueue.push({ type: 'log', args: [localize('usingTenant', `Using "${selectedTenant.displayName}" tenant.`)] });

            const session = await authentication.getSession('microsoft', ['https://management.core.windows.net//.default', `VSCODE_TENANT:${selectedTenant.tenantId}`], {
                createIfNone: false,
            });
            const result = session && await findUserSettings(session.accessToken);
            if (!result) {
                serverQueue.push({ type: 'log', args: [localize('setupNeeded', "Setup needed.")] });
                await requiresSetUp(context);
                serverQueue.push({ type: 'exit' });
                updateStatus('Disconnected');
                return;
            }

            // provision
            let consoleUri: string;
            const provisionTask: () => Promise<void> = async () => {
                consoleUri = await provisionConsole(session.accessToken, result, OSes.Linux.id);
                context.telemetry.properties.outcome = 'provisioned';
            }
            try {
                serverQueue.push({ type: 'log', args: [localize('requestingCloudConsole', "Requesting a Cloud Shell...")] });
                await provisionTask();
            } catch (err) {
                if (parseError(err).message === Errors.DeploymentOsTypeConflict) {
                    const reset = await deploymentConflict(context, os);
                    if (reset) {
                        await resetConsole(session.accessToken, getArmEndpoint());
                        return provisionTask();
                    } else {
                        serverQueue.push({ type: 'exit' });
                        updateStatus('Disconnected');
                        return;
                    }
                } else {
                    throw err;
                }
            }

            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            deferredTokens!.resolve({ resource: session.accessToken });

            // Connect to terminal
            const connecting: string = localize('connectingTerminal', "Connecting terminal...");
            serverQueue.push({ type: 'log', args: [connecting] });
            const progressTask: (i: number) => void = (i: number) => {
                serverQueue.push({ type: 'log', args: [`\x1b[A${connecting}${'.'.repeat(i)}`] });
            };
            const initialSize: Size = await initialSizePromise;
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const consoleUris: ConsoleUris = await connectTerminal(session.accessToken, consoleUri!, /* TODO: Separate Shell from OS */ osName === 'Linux' ? 'bash' : 'pwsh', initialSize, progressTask);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            deferredUris!.resolve(consoleUris);

            // Connect to WebSocket
            serverQueue.push({
                type: 'connect',
                accessToken: session.accessToken,
                consoleUris
            });
        })().catch(err => {
            const parsedError: IParsedError = parseError(err);
            ext.outputChannel.appendLog(parsedError.message);
            parsedError.stack && ext.outputChannel.appendLog(parsedError.stack);
            updateStatus('Disconnected');
            context.telemetry.properties.outcome = 'error';
            context.telemetry.properties.message = parsedError.message;
            if (liveServerQueue) {
                liveServerQueue.push({ type: 'log', args: [localize('error', "Error: {0}", parsedError.message)] });
            }
        });
        return state;
    }))!;
}

async function findUserSettings(accessToken: string): Promise<UserSettings | undefined> {
    const userSettings: UserSettings | undefined = await getUserSettings(accessToken);
    // Valid settings will have either a storage profile (mounted) or a session type of 'Ephemeral'.
    if (userSettings && (userSettings.storageProfile || userSettings.sessionType === 'Ephemeral')) {
        return userSettings;
    }

    return undefined;
}

async function requiresSetUp(context: IActionContext) {
    context.telemetry.properties.outcome = 'requiresSetUp';
    const open: MessageItem = { title: localize('open', "Open") };
    const message: string = localize('setUpInWeb', "First launch of Cloud Shell in a directory requires setup in the web application (https://shell.azure.com).");
    const response: MessageItem | undefined = await window.showInformationMessage(message, open);
    if (response === open) {
        context.telemetry.properties.outcome = 'requiresSetUpOpen';
        void env.openExternal(Uri.parse('https://shell.azure.com'));
    } else {
        context.telemetry.properties.outcome = 'requiresSetUpCancel';
    }
}

async function requiresNode(context: IActionContext) {
    context.telemetry.properties.outcome = 'requiresNode';
    const open: MessageItem = { title: localize('open', "Open") };
    const message: string = localize('requiresNode', "Opening a Cloud Shell currently requires Node.js 6 or later to be installed (https://nodejs.org).");
    const response: MessageItem | undefined = await window.showInformationMessage(message, open);
    if (response === open) {
        context.telemetry.properties.outcome = 'requiresNodeOpen';
        void env.openExternal(Uri.parse('https://nodejs.org'));
    } else {
        context.telemetry.properties.outcome = 'requiresNodeCancel';
    }
}

async function requiresWorkspaceTrust(context: IActionContext) {
    context.telemetry.properties.outcome = 'requiresWorkspaceTrust';
    const ok: MessageItem = { title: localize('ok', "OK") };
    const message: string = localize('cloudShellRequiresTrustedWorkspace', 'Opening a Cloud Shell only works in a trusted workspace.');
    return await window.showInformationMessage(message, ok) === ok;
}

async function deploymentConflict(context: IActionContext, os: OS) {
    context.telemetry.properties.outcome = 'deploymentConflict';
    const ok: MessageItem = { title: localize('ok', "OK") };
    const message: string = localize('deploymentConflict', "Starting a {0} session will terminate all active {1} sessions. Any running processes in active {1} sessions will be terminated.", os.shellName, os.otherOS.shellName);
    const response: MessageItem | undefined = await window.showWarningMessage(message, ok);
    const reset: boolean = response === ok;
    context.telemetry.properties.outcome = reset ? 'deploymentConflictReset' : 'deploymentConflictCancel';
    return reset;
}

export interface ExecResult {
    error: Error | null;
    stdout: string;
    stderr: string;
}

async function exec(command: string): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve, reject) => {
        cp.exec(command, (error, stdout, stderr) => {
            (error || stderr ? reject : resolve)({ error, stdout, stderr });
        });
    });
}

const consoleApiVersion = '2023-02-01-preview';

export enum Errors {
    DeploymentOsTypeConflict = 'DeploymentOsTypeConflict'
}

function getConsoleUri(armEndpoint: string) {
    return `${armEndpoint}/providers/Microsoft.Portal/consoles/default?api-version=${consoleApiVersion}`;
}

export interface UserSettings {
    preferredLocation: string;
    preferredOsType: string; // The last OS chosen in the portal.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storageProfile: any;
    sessionType: 'Ephemeral' | 'Mounted';
}

export interface AccessTokens {
    resource: string;
    // graph: string;
    keyVault?: string;
}

export interface ConsoleUris {
    consoleUri: string;
    terminalUri: string;
    socketUri: string;
}

export interface Size {
    cols: number;
    rows: number;
}

export async function getUserSettings(accessToken: string): Promise<UserSettings | undefined> {
    const targetUri = `${getArmEndpoint()}/providers/Microsoft.Portal/userSettings/cloudconsole?api-version=${consoleApiVersion}`;
    const response = await fetch(targetUri, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
    });

    if (response.status < 200 || response.status > 299) {
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return (await response.json()).properties;
}

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
export async function provisionConsole(accessToken: string, userSettings: UserSettings, osType: string): Promise<string> {
    let response = await createTerminal(accessToken, userSettings, osType, true);
    for (let i = 0; i < 10; i++, response = await createTerminal(accessToken, userSettings, osType, false)) {
        if (response.status < 200 || response.status > 299) {
            const body = await response.json();
            if (response.status === 409 && response.body && body.error && body.error.code === Errors.DeploymentOsTypeConflict) {
                throw new Error(Errors.DeploymentOsTypeConflict);
            } else if (body && body.error && body.error.message) {
                throw new Error(`${body.error.message} (${response.status})`);
            } else {
                throw new Error(`${response.status} ${response.headers} ${body}`);
            }
        }

        const consoleResource = await response.json();
        if (consoleResource.properties.provisioningState === 'Succeeded') {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return consoleResource.properties.uri;
        } else if (consoleResource.properties.provisioningState === 'Failed') {
            break;
        }
    }
    throw new Error(`Sorry, your Cloud Shell failed to provision. Please retry later. Request correlation id: ${response.headers.get('x-ms-routing-request-id')}`);
}
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

async function createTerminal(accessToken: string, userSettings: UserSettings, osType: string, initial: boolean): Promise<Response> {
    return fetchWithLogging(getConsoleUri(getArmEndpoint()), {
        method: initial ? 'PUT' : 'GET',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'x-ms-console-preferred-location': userSettings.preferredLocation
        },
        body: JSON.stringify(initial ? {
            properties: {
                osType
            }
        } : {}),
    });
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export async function resetConsole(accessToken: string, armEndpoint: string) {
    const response = await fetchWithLogging(getConsoleUri(armEndpoint), {
        method: 'DELETE',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
    });

    /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
    const body = await response.json();
    /* eslint-disable @typescript-eslint/no-unsafe-member-access */
    if (response.status < 200 || response.status > 299) {
        if (body && body.error && body.error.message) {
            throw new Error(`${body.error.message} (${response.status})`);
        } else {
            throw new Error(`${response.status} ${response.headers} ${body}`);
        }
    }
}

export async function connectTerminal(accessToken: string, consoleUri: string, shellType: string, initialSize: Size, progress: (i: number) => void): Promise<ConsoleUris> {

    for (let i = 0; i < 10; i++) {
        /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
        const response = await initializeTerminal(accessToken, consoleUri, shellType, initialSize);

        const body = await response.json();
        if (response.status < 200 || response.status > 299) {
            if (response.status !== 503 && response.status !== 504 && body && body.error) {
                if (body && body.error && body.error.message) {
                    throw new Error(`${body.error.message} (${response.status})`);
                } else {
                    throw new Error(`${response.status} ${response.headers} ${await response.text()}`);
                }
            }
            await delay(1000 * (i + 1));
            progress(i + 1);
            continue;
        }

        return {
            consoleUri,
            terminalUri: `${consoleUri}/terminals/${body.id}`,
            socketUri: body.socketUri
        };
    }

    throw new Error('Failed to connect to the terminal.');
}

async function initializeTerminal(accessToken: string, consoleUri: string, shellType: string, initialSize: Size): Promise<Response> {
    const consoleUrl = new URL(consoleUri);
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
    const response = fetchWithLogging(consoleUri + '/terminals?cols=' + initialSize.cols + '&rows=' + initialSize.rows + '&shell=' + shellType, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'Referer': consoleUrl.protocol + "//" + consoleUrl.hostname + '/$hc' + consoleUrl.pathname + '/terminals',
        },
        body: JSON.stringify({}),
    });

    return response;
}

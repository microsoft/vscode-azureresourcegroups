/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'net';
import * as vscode from 'vscode';
import { GenericItem } from '../GenericItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';

// Parsed data structures from local-plan.md
interface ServiceMapping {
    azureService: string;
    emulator: string;
    dockerImage: string;
    ports: number[];
}

interface AppEndpoint {
    name: string;
    port: number;
}

interface LocalPlanData {
    services: ServiceMapping[];
    endpoints: AppEndpoint[];
    prerequisites: string[]; // retained for future use
    configFiles: string[];
}

export class LocalDevelopmentItem implements ResourceGroupsItem {
    readonly id = 'projectCreation/localDevelopment';
    private cachedChildren?: ResourceGroupsItem[];

    getTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem('Local Development', vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = 'projectCreationPhase';
        item.iconPath = new vscode.ThemeIcon('code', new vscode.ThemeColor('charts.blue'));
        item.description = 'Phase 2 \u2014 Build and debug locally';
        item.tooltip = '$(info) Local Development\n\nConfigure local settings, prerequisites, emulators, and launch configuration.';
        return item;
    }

    getChildren(): vscode.ProviderResult<ResourceGroupsItem[]> {
        if (this.cachedChildren) {
            return this.cachedChildren;
        }
        return this.buildChildren();
    }

    clearCache(): void {
        this.cachedChildren = undefined;
    }

    private async buildChildren(): Promise<ResourceGroupsItem[]> {
        const planContent = await readWorkspaceFile('.azure/local-dev.plan.md');

        if (!planContent) {
            const children: ResourceGroupsItem[] = [
                new GenericItem('Set up Local Environment', {
                    id: 'projectCreation/localDevelopment/setup',
                    contextValue: 'projectCreationAction',
                    iconPath: new vscode.ThemeIcon('gear', new vscode.ThemeColor('charts.blue')),
                    tooltip: 'Create a local development plan to configure prerequisites, emulators, and launch settings.',
                    commandId: 'azureProjectCreation.setupLocalDev',
                }),
            ];
            this.cachedChildren = children;
            return children;
        }

        const plan = parseLocalPlan(planContent);

        // Detect which ports are actually listening (emulator ports only)
        const allPorts = plan.services.flatMap(s => s.ports);
        const portStatus = await checkPorts(allPorts);

        const scanDate = new Date().toLocaleDateString();

        const children: ResourceGroupsItem[] = [
            this.buildInstructionsSection(scanDate),
            this.buildEmulatorsSection(plan.services, portStatus),
            this.buildLaunchConfigSection(),
        ];

        this.cachedChildren = children;
        return children;
    }

    private buildInstructionsSection(scanDate: string): ResourceGroupsItem {
        return new GenericItem('Local Plan', {
            id: 'projectCreation/localDevelopment/localPlan',
            contextValue: 'projectCreationPlanFile',
            iconPath: new vscode.ThemeIcon('file-text'),
            description: `.azure/local-plan.md \u2014 ${scanDate}`,
        });
    }

    private buildEmulatorsSection(services: ServiceMapping[], portStatus: Map<number, boolean>): ResourceGroupsItem {
        const emulatorItems: ResourceGroupsItem[] = services.map((svc) => {
            const anyRunning = svc.ports.some(p => portStatus.get(p));
            const idPrefix = `projectCreation/localDevelopment/emulators/${sanitizeId(svc.emulator)}`;
            return new GenericItem(svc.emulator, {
                id: idPrefix,
                contextValue: 'projectCreationEmulator',
                iconPath: emulatorStatusIcon(anyRunning),
                description: anyRunning ? 'running' : 'not started',
                tooltip: `${svc.azureService} \u2192 ${svc.emulator}\nDocker: ${svc.dockerImage}\nPorts: ${svc.ports.join(', ')}`,
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                children: buildEmulatorActions(idPrefix),
            });
        });

        if (services.length > 1) {
            emulatorItems.push(new GenericItem('All Emulators', {
                id: 'projectCreation/localDevelopment/emulators/all',
                contextValue: 'projectCreationEmulatorGroup',
                iconPath: new vscode.ThemeIcon('play'),
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                children: [
                    new GenericItem('Start All Emulators w/ Copilot', {
                        id: 'projectCreation/localDevelopment/emulators/all/start',
                        contextValue: 'projectCreationAction',
                        iconPath: new vscode.ThemeIcon('play'),
                    }),
                    new GenericItem('Add as preLaunchTasks', {
                        id: 'projectCreation/localDevelopment/emulators/all/preLaunchTasks',
                        contextValue: 'projectCreationAction',
                        iconPath: new vscode.ThemeIcon('gear'),
                    }),
                    new GenericItem('Add as docker-compose', {
                        id: 'projectCreation/localDevelopment/emulators/all/dockerCompose',
                        contextValue: 'projectCreationAction',
                        iconPath: new vscode.ThemeIcon('server-environment'),
                    }),
                ],
            }));
        }

        return new GenericItem('Emulators', {
            id: 'projectCreation/localDevelopment/emulators',
            contextValue: 'projectCreationSection',
            iconPath: new vscode.ThemeIcon('server'),
            description: `${services.length} emulator${services.length !== 1 ? 's' : ''}`,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            children: emulatorItems,
        });
    }

    private buildLaunchConfigSection(): ResourceGroupsItem {
        const children: ResourceGroupsItem[] = [];

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const launchConfig = vscode.workspace.getConfiguration('launch', workspaceFolder?.uri);
        const configurations = launchConfig.get<{ name: string }[]>('configurations') ?? [];
        const compounds = launchConfig.get<{ name: string }[]>('compounds') ?? [];

        // Individual service configurations
        for (const config of configurations) {
            children.push(new GenericItem(config.name, {
                id: `projectCreation/localDevelopment/launchConfig/service/${sanitizeId(config.name)}`,
                contextValue: 'projectCreationLaunchService',
                iconPath: new vscode.ThemeIcon('play', new vscode.ThemeColor('testing.iconPassed')),
            }));
        }

        // Compound configurations
        for (const compound of compounds) {
            children.push(new GenericItem(compound.name, {
                id: `projectCreation/localDevelopment/launchConfig/compound/${sanitizeId(compound.name)}`,
                contextValue: 'projectCreationLaunchCompound',
                iconPath: new vscode.ThemeIcon('play', new vscode.ThemeColor('testing.iconPassed')),
            }));
        }

        if (children.length === 0) {
            children.push(new GenericItem('No launch configurations found', {
                id: 'projectCreation/localDevelopment/launchConfig/empty',
                contextValue: 'projectCreationStatus',
                iconPath: new vscode.ThemeIcon('info'),
                description: 'Add configurations to .vscode/launch.json',
            }));
        }

        return new GenericItem('Launch Configuration', {
            id: 'projectCreation/localDevelopment/launchConfig',
            contextValue: 'projectCreationSection',
            iconPath: new vscode.ThemeIcon('debug-alt'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            children,
        });
    }
}

// --- Plan parser ---

function parseLocalPlan(content: string): LocalPlanData {
    return {
        services: parseServiceMappingTable(content),
        endpoints: parseAppEndpoints(content),
        prerequisites: parsePrerequisites(content),
        configFiles: parseConfigFiles(content),
    };
}

function parseServiceMappingTable(content: string): ServiceMapping[] {
    const services: ServiceMapping[] = [];

    // Match a markdown table under a heading containing "Service Mapping"
    // Allow blank lines between heading and table
    const sectionMatch = content.match(/###?\s*Service Mapping[^\n]*\n+((?:\|.*\n?)+)/i);
    if (!sectionMatch) { return services; }

    const tableLines = sectionMatch[1].trim().split('\n');
    for (const line of tableLines) {
        // Skip header/separator rows
        if (line.match(/^\|[\s\-:|]+\|?\s*$/)) { continue; }

        const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
        if (cells.length < 4) { continue; }

        // Skip header row by checking if first cell looks like a header
        if (cells[0].toLowerCase() === 'azure service') { continue; }

        const ports = (cells[3].match(/\d+/g) ?? []).map(Number);
        services.push({
            azureService: cells[0],
            emulator: cells[1],
            dockerImage: cells[2].replace(/`/g, ''),
            ports,
        });
    }

    return services;
}

function parseAppEndpoints(content: string): AppEndpoint[] {
    const endpoints: AppEndpoint[] = [];

    // Match the Architecture section up to the next heading or horizontal rule
    const archMatch = content.match(/##?\s*Architecture[\s\S]*?(?=\n##?\s|\n---\s*\n|$)/i);
    if (!archMatch) { return endpoints; }

    const archSection = archMatch[0];

    // Pattern: "service name @ :port" or "→ service @ :port"
    const portPattern = /(?:\u2192|->|→)\s*(.+?)\s*@\s*:(\d+)/g;
    let match;
    while ((match = portPattern.exec(archSection)) !== null) {
        endpoints.push({
            name: match[1].trim(),
            port: parseInt(match[2], 10),
        });
    }

    // Also try pattern: "service @ :port" without arrow
    if (endpoints.length === 0) {
        const altPattern = /(\S[\w\s/]+?)\s*@\s*:(\d+)/g;
        while ((match = altPattern.exec(archSection)) !== null) {
            endpoints.push({
                name: match[1].trim(),
                port: parseInt(match[2], 10),
            });
        }
    }

    return endpoints;
}

function parsePrerequisites(content: string): string[] {
    const prereqs: string[] = [];

    // Extract from Detection Summary table
    const detectionMatch = content.match(/##?\s*Detection Summary[^\n]*\n+((?:\|.*\n?)+)/i);
    if (detectionMatch) {
        const lines = detectionMatch[1].trim().split('\n');
        for (const line of lines) {
            if (line.match(/^\|[\s-:|]+\|$/)) { continue; }
            const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
            if (cells.length < 2 || cells[0].toLowerCase() === 'signal') { continue; }

            const signal = cells[0];
            // Extract tool names like "Docker", "Node", etc.
            if (/docker/i.test(signal)) { prereqs.push('Docker'); }
        }
    }

    // Always check for common prerequisites
    if (!prereqs.some(p => /docker/i.test(p))) { prereqs.push('Docker'); }
    if (!prereqs.some(p => /node/i.test(p))) { prereqs.push('Node.js & npm'); }

    // Check for Azure Functions if mentioned
    if (/azure functions/i.test(content) && !prereqs.some(p => /func/i.test(p))) {
        prereqs.push('Azure Functions Core Tools');
    }

    return prereqs;
}

function parseConfigFiles(content: string): string[] {
    const files: string[] = [];

    // Look for "Files to Create" table
    const filesMatch = content.match(/##?\s*Files to Create[^\n]*\n+((?:\|.*\n?)+)/i);
    if (!filesMatch) { return files; }

    const lines = filesMatch[1].trim().split('\n');
    for (const line of lines) {
        if (line.match(/^\|[\s-:|]+\|$/)) { continue; }
        const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
        if (cells.length < 1 || cells[0].toLowerCase() === 'file') { continue; }

        const fileName = cells[0].replace(/`/g, '');
        if (fileName) { files.push(fileName); }
    }

    return files;
}

// --- Helpers ---

function buildEmulatorActions(idPrefix: string): ResourceGroupsItem[] {
    return [
        new GenericItem('Start Emulator w/ Copilot', {
            id: `${idPrefix}/start`,
            contextValue: 'projectCreationAction',
            iconPath: new vscode.ThemeIcon('play'),
        }),
        new GenericItem('Add as preLaunchTask', {
            id: `${idPrefix}/preLaunchTask`,
            contextValue: 'projectCreationAction',
            iconPath: new vscode.ThemeIcon('gear'),
        }),
        new GenericItem('Add as docker-compose', {
            id: `${idPrefix}/dockerCompose`,
            contextValue: 'projectCreationAction',
            iconPath: new vscode.ThemeIcon('server-environment'),
        }),
    ];
}

function sanitizeId(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function statusIcon(ok: boolean): vscode.ThemeIcon {
    return ok
        ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
        : new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
}

function emulatorStatusIcon(running: boolean): vscode.ThemeIcon {
    return running
        ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
        : new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
}

async function checkPorts(ports: number[]): Promise<Map<number, boolean>> {
    const results = new Map<number, boolean>();
    const unique = [...new Set(ports)];
    const checks = await Promise.all(unique.map(async (port) => ({
        port,
        listening: await checkPortListening(port),
    })));
    for (const { port, listening } of checks) {
        results.set(port, listening);
    }
    return results;
}

function checkPortListening(port: number, host: string = '127.0.0.1'): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.on('error', () => {
            resolve(false);
        });
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.connect(port, host);
    });
}

async function checkWorkspaceFile(pattern: string): Promise<boolean> {
    const files = await vscode.workspace.findFiles(pattern, null, 1);
    return files.length > 0;
}

async function readWorkspaceFile(pattern: string): Promise<string | undefined> {
    const files = await vscode.workspace.findFiles(pattern, null, 1);
    if (files.length === 0) { return undefined; }
    const content = await vscode.workspace.fs.readFile(files[0]);
    return Buffer.from(content).toString('utf-8');
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** Zero-based index of the furthest stage the workspace has reached. */
export type ProjectStage = 0 | 1 | 2;

export interface ProjectPlanFiles {
    hasProjectPlan: boolean;
    hasLocalDevelopmentPlan: boolean;
    hasDeploymentPlan: boolean;
    /** True when any of the plan files exist. */
    hasAny: boolean;
    /** The furthest stage reached: 0 = project creation, 1 = local dev, 2 = deployment. */
    currentStage: ProjectStage;
}

const PLAN_FILE_GLOBS = [
    '**/.azure/project-plan.md',
    '**/vscode-debug-plan.md',
    '**/.azure/deployment-plan.md',
] as const;

export async function getProjectPlanFiles(): Promise<ProjectPlanFiles> {
    const [projectPlanFiles, localDevelopmentPlanFiles, deploymentPlanFiles] = await Promise.all(
        PLAN_FILE_GLOBS.map((glob) => vscode.workspace.findFiles(glob, '**/node_modules/**', 1)),
    );

    const hasProjectPlan = projectPlanFiles.length > 0;
    const hasLocalDevelopmentPlan = localDevelopmentPlanFiles.length > 0;
    const hasDeploymentPlan = deploymentPlanFiles.length > 0;

    return {
        hasProjectPlan,
        hasLocalDevelopmentPlan,
        hasDeploymentPlan,
        hasAny: hasProjectPlan || hasLocalDevelopmentPlan || hasDeploymentPlan,
        currentStage: hasDeploymentPlan ? 2 : hasLocalDevelopmentPlan ? 1 : 0,
    };
}

/**
 * Watches the workspace for changes that could affect which project plan files
 * exist, and raises a single `onDidChange` event. Owning one instance and
 * sharing it (tree provider + context-key updater) avoids registering the same
 * set of workspace listeners and file-system watchers twice.
 */
export class ProjectPlanFilesWatcher implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this.emitter.event;

    private readonly disposables: vscode.Disposable[] = [];

    constructor() {
        const fire = () => this.emitter.fire();

        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(fire),
            vscode.workspace.onDidCreateFiles(fire),
            vscode.workspace.onDidDeleteFiles(fire),
            vscode.workspace.onDidRenameFiles(fire),
        );

        for (const glob of PLAN_FILE_GLOBS) {
            const watcher = vscode.workspace.createFileSystemWatcher(glob);
            watcher.onDidCreate(fire);
            watcher.onDidDelete(fire);
            watcher.onDidChange(fire);
            this.disposables.push(watcher);
        }
    }

    dispose(): void {
        this.emitter.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

export interface DebugConfigurationSummary {
    readonly name: string;
    readonly folder: vscode.WorkspaceFolder;
}

export function getDebugConfigurations(): DebugConfigurationSummary[] {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const results: DebugConfigurationSummary[] = [];
    for (const folder of folders) {
        const launch = vscode.workspace.getConfiguration('launch', folder.uri);
        const configs = launch.get<Array<{ name?: string; type?: string }>>('configurations');
        if (Array.isArray(configs)) {
            for (const config of configs) {
                if (config && typeof config.name === 'string' && config.name.length > 0 && config.type) {
                    results.push({ name: config.name, folder });
                }
            }
        }
        const compounds = launch.get<Array<{ name?: string; configurations?: unknown[] }>>('compounds');
        if (Array.isArray(compounds)) {
            for (const compound of compounds) {
                if (compound && typeof compound.name === 'string' && compound.name.length > 0 && Array.isArray(compound.configurations) && compound.configurations.length > 0) {
                    results.push({ name: compound.name, folder });
                }
            }
        }
    }
    return results;
}

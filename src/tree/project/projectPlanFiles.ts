/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** The furthest stage reached: 0 = project creation, 1 = local dev, 2 = deployment. */
export type ProjectStage = 0 | 1 | 2;

export interface ProjectPlanFiles {
    hasRequirements: boolean;
    hasProjectPlan: boolean;
    hasLocalDevelopmentPlan: boolean;
    hasDeploymentPlan: boolean;
    hasAppOnboardSession: boolean;
    /** True when any project artifact exists (requirements, a plan file, or an App Onboard session). */
    hasAny: boolean;
    /** The furthest stage reached. */
    currentStage: ProjectStage;
}

/**
 * Workspace-relative globs for each Copilot-on-Rails project artifact. These are
 * the single source of truth for `.azure/*` and App Onboard session locations; other modules
 * import these constants instead of re-hard-coding the paths.
 */
/** The requirements file marks the very start of a project, before any plan. */
export const REQUIREMENTS_FILE_GLOB = '.azure/requirements.json';
export const PROJECT_PLAN_FILE_GLOB = '.azure/project-plan.md';
export const INTEGRATION_PLAN_FILE_GLOB = '.azure/integration-plan.md';
export const DEBUG_PLAN_FILE_GLOB = '.azure/vscode-debug-plan.md';
export const DEPLOYMENT_PLAN_FILE_GLOB = '.azure/deployment-plan.md';
export const APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB = '.copilot-azure/sessions/active-session.json';

/**
 * The deploy phase's result artifact. The App Onboard session protocol writes it
 * to the active session folder, but it is also seen at the `.azure/` root, so
 * both locations are searched.
 */
export const DEPLOY_RESULT_FILE_GLOB = '.azure/deploy-result.json';
export const DEPLOY_RESULT_SESSION_FILE_GLOB = '.copilot-azure/sessions/*/deploy-result.json';
export const DEPLOY_RESULT_FILE_GLOBS = [DEPLOY_RESULT_FILE_GLOB, DEPLOY_RESULT_SESSION_FILE_GLOB] as const;


const PLAN_FILE_GLOBS = [
    PROJECT_PLAN_FILE_GLOB,
    INTEGRATION_PLAN_FILE_GLOB,
    DEBUG_PLAN_FILE_GLOB,
    DEPLOYMENT_PLAN_FILE_GLOB,
] as const;

/** All artifacts that indicate an in-progress project, for watching. */
const ALL_PROJECT_FILE_GLOBS = [REQUIREMENTS_FILE_GLOB, ...PLAN_FILE_GLOBS, APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB] as const;

export function createProjectPlanFileWatcher(glob: string): vscode.FileSystemWatcher {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const pattern: vscode.GlobPattern = folder ? new vscode.RelativePattern(folder, glob) : glob;
    return vscode.workspace.createFileSystemWatcher(pattern);
}

export async function getProjectPlanFiles(): Promise<ProjectPlanFiles> {
    const [requirementsFiles, projectPlanFiles, , localDevelopmentPlanFiles, deploymentPlanFiles, appOnboardSessionFiles] = await Promise.all(
        ALL_PROJECT_FILE_GLOBS.map((glob) => vscode.workspace.findFiles(glob, undefined, 1)),
    );

    const hasRequirements = requirementsFiles.length > 0;
    const hasProjectPlan = projectPlanFiles.length > 0;
    const hasLocalDevelopmentPlan = localDevelopmentPlanFiles.length > 0;
    const hasDeploymentPlan = deploymentPlanFiles.length > 0;
    const hasAppOnboardSession = appOnboardSessionFiles.length > 0;

    let currentStage: ProjectStage = 0;
    if (hasDeploymentPlan || hasAppOnboardSession) {
        currentStage = 2;
    } else if (hasLocalDevelopmentPlan) {
        currentStage = 1;
    }

    return {
        hasRequirements,
        hasProjectPlan,
        hasLocalDevelopmentPlan,
        hasDeploymentPlan,
        hasAppOnboardSession,
        hasAny: hasRequirements || hasProjectPlan || hasLocalDevelopmentPlan || hasDeploymentPlan || hasAppOnboardSession,
        currentStage,
    };
}

/**
 * Returns true when the given workspace folder contains any Copilot on Rails
 * project artifact under `.azure/`. Unlike {@link getProjectPlanFiles}, which
 * scans the whole workspace, this is scoped to a single folder so a debug
 * session can be attributed to the specific folder it runs in.
 */
export async function isCopilotOnRailsProjectFolder(folder: vscode.WorkspaceFolder): Promise<boolean> {
    const fileNames = [REQUIREMENTS_FILE_GLOB, ...PLAN_FILE_GLOBS].map((glob) => glob.replace('.azure/', ''));
    const pattern = new vscode.RelativePattern(folder, `.azure/{${fileNames.join(',')}}`);
    const matches = await vscode.workspace.findFiles(pattern, undefined, 1);
    return matches.length > 0;
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

        for (const glob of ALL_PROJECT_FILE_GLOBS) {
            const watcher = createProjectPlanFileWatcher(glob);
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
    readonly type: string;
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
                if (config && typeof config.name === 'string' && config.name.length > 0 && typeof config.type === 'string') {
                    results.push({ name: config.name, type: config.type, folder });
                }
            }
        }
        const compounds = launch.get<Array<{ name?: string; configurations?: unknown[] }>>('compounds');
        if (Array.isArray(compounds)) {
            for (const compound of compounds) {
                if (compound && typeof compound.name === 'string' && compound.name.length > 0 && Array.isArray(compound.configurations) && compound.configurations.length > 0) {
                    results.push({ name: compound.name, type: 'compound', folder });
                }
            }
        }
    }
    return results;
}

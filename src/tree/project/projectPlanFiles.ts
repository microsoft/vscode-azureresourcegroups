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
export const PREPARE_PLAN_FILE_GLOB = '.azure/prepare-plan.json';
export const PREPARE_PLAN_SESSION_FILE_GLOB = '.copilot-azure/sessions/*/prepare-plan.json';
/** Every location a `prepare-plan.json` may live in, most-canonical first. */
export const PREPARE_PLAN_FILE_GLOBS = [PREPARE_PLAN_FILE_GLOB, PREPARE_PLAN_SESSION_FILE_GLOB] as const;
export const APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB = '.copilot-azure/sessions/active-session.json';

const PLAN_FILE_GLOBS = [
    PROJECT_PLAN_FILE_GLOB,
    INTEGRATION_PLAN_FILE_GLOB,
    DEBUG_PLAN_FILE_GLOB,
    ...PREPARE_PLAN_FILE_GLOBS,
] as const;

/** All artifacts that indicate an in-progress project, for watching. */
const ALL_PROJECT_FILE_GLOBS = [REQUIREMENTS_FILE_GLOB, ...PLAN_FILE_GLOBS, APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB] as const;

export function createProjectPlanFileWatcher(glob: string): vscode.FileSystemWatcher {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const pattern: vscode.GlobPattern = folder ? new vscode.RelativePattern(folder, glob) : glob;
    return vscode.workspace.createFileSystemWatcher(pattern);
}

/**
 * Resolves a workspace-relative artifact glob against the file system directly.
 *
 * `vscode.workspace.findFiles` is backed by the search service, which honors `.gitignore`
 * whenever `search.useIgnoreFiles` is enabled (the default). The deploy agent's session
 * protocol git-ignores `.copilot-azure/` because session artifacts can hold secrets, so its
 * `prepare-plan.json` is invisible to `findFiles`. Walking the file system finds it regardless
 * of the user's ignore/exclude settings.
 *
 * Supports a single `*` wildcard per path segment (e.g. `.copilot-azure/sessions/{*}/prepare-plan.json`),
 * which is all the project artifact globs need.
 */
export async function findProjectFiles(glob: string, folder?: vscode.WorkspaceFolder): Promise<vscode.Uri[]> {
    const folders = folder ? [folder] : vscode.workspace.workspaceFolders ?? [];
    const results: vscode.Uri[] = [];
    for (const workspaceFolder of folders) {
        results.push(...await resolveGlobSegments(workspaceFolder.uri, glob.split('/')));
    }
    return results;
}

async function resolveGlobSegments(base: vscode.Uri, segments: readonly string[]): Promise<vscode.Uri[]> {
    const [segment, ...rest] = segments;
    if (segment === undefined) {
        return [];
    }

    if (segment !== '*') {
        const next = vscode.Uri.joinPath(base, segment);
        if (rest.length > 0) {
            return await resolveGlobSegments(next, rest);
        }
        try {
            const stat = await vscode.workspace.fs.stat(next);
            return stat.type === vscode.FileType.Directory ? [] : [next];
        } catch {
            return [];
        }
    }

    let entries: [string, vscode.FileType][];
    try {
        entries = await vscode.workspace.fs.readDirectory(base);
    } catch {
        return [];
    }

    const matches = await Promise.all(entries.map(async ([name, type]): Promise<vscode.Uri[]> => {
        const child = vscode.Uri.joinPath(base, name);
        if (rest.length === 0) {
            return type === vscode.FileType.Directory ? [] : [child];
        }
        return type === vscode.FileType.Directory ? await resolveGlobSegments(child, rest) : [];
    }));
    return matches.flat();
}

export async function getProjectPlanFiles(): Promise<ProjectPlanFiles> {
    const found = new Map<string, boolean>(await Promise.all(
        ALL_PROJECT_FILE_GLOBS.map(async (glob): Promise<[string, boolean]> =>
            [glob, (await findProjectFiles(glob)).length > 0]),
    ));
    const exists = (glob: string): boolean => found.get(glob) ?? false;

    const hasRequirements = exists(REQUIREMENTS_FILE_GLOB);
    const hasProjectPlan = exists(PROJECT_PLAN_FILE_GLOB);
    const hasLocalDevelopmentPlan = exists(DEBUG_PLAN_FILE_GLOB);
    const hasDeploymentPlan = PREPARE_PLAN_FILE_GLOBS.some(exists);
    const hasAppOnboardSession = exists(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB);

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
 * Returns true when the given workspace folder contains any Copilot on Rails project artifact.
 * Unlike {@link getProjectPlanFiles}, which scans the whole workspace, this is scoped to a single
 * folder so a debug session can be attributed to the specific folder it runs in.
 */
export async function isCopilotOnRailsProjectFolder(folder: vscode.WorkspaceFolder): Promise<boolean> {
    for (const glob of [REQUIREMENTS_FILE_GLOB, ...PLAN_FILE_GLOBS]) {
        if ((await findProjectFiles(glob, folder)).length > 0) {
            return true;
        }
    }
    return false;
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

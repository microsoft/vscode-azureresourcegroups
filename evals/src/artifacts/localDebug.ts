/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import { parse, ParseError, printParseErrorCode } from 'jsonc-parser';
import {
    findColumnIndex,
    findSection,
    findTable,
    flattenContent,
    isChecked,
    parseLocalDebugPlanMarkdown,
} from '../../../src/webviews/copilotOnRails/views/utils/parseLocalDebugPlanMarkdown';
import { ArtifactValidationIssue, ArtifactValidationResult } from './validationTypes';
import { SandboxLocalRuntimeValidationResult } from '../SandboxLocalRuntimeValidator';

export interface LocalDebugPlanValidationOptions {
    expectedStatus?: 'Planning' | 'Approved' | 'Executing' | 'Implemented';
    requireAutoMode?: boolean;
    requireSuccessfulChecklist?: boolean;
}

interface DebugConfiguration {
    name?: unknown;
    preLaunchTask?: unknown;
}

interface DebugCompound {
    name?: unknown;
    configurations?: unknown;
}

interface DebugTask {
    label?: unknown;
    command?: unknown;
    args?: unknown;
    dependsOn?: unknown;
    isBackground?: unknown;
    problemMatcher?: unknown;
    options?: {
        cwd?: unknown;
    };
    runOptions?: {
        instanceLimit?: unknown;
        instancePolicy?: unknown;
    };
}

export function validateLocalDebugPlanArtifact(
    content: string,
    options: LocalDebugPlanValidationOptions = {},
): ArtifactValidationResult {
    const issues: ArtifactValidationIssue[] = [];
    const plan = parseLocalDebugPlanMarkdown(content);
    if (!content.trim()) {
        addIssue(issues, 'emptyArtifact', '$', 'Local debug plan must not be empty.');
        return result(issues);
    }
    if (plan.title !== 'Azure Debug Plan') {
        addIssue(issues, 'invalidTitle', '$.title', 'Local debug plan title must be "Azure Debug Plan".');
    }
    if (!['Planning', 'Approved', 'Executing', 'Implemented'].includes(plan.status)) {
        addIssue(issues, 'invalidStatus', '$.status', `Unsupported local debug plan status "${plan.status}".`);
    } else if (options.expectedStatus && plan.status !== options.expectedStatus) {
        addIssue(
            issues,
            'unexpectedStatus',
            '$.status',
            `Expected local debug plan status "${options.expectedStatus}", found "${plan.status}".`,
        );
    }
    if (!['Auto', 'Guided'].includes(plan.executionMode)) {
        addIssue(issues, 'invalidExecutionMode', '$.executionMode', 'Execution Mode must be Auto or Guided.');
    } else if (options.requireAutoMode && plan.executionMode !== 'Auto') {
        addIssue(issues, 'unexpectedExecutionMode', '$.executionMode', 'Headless evaluation requires Execution Mode Auto.');
    }

    const prerequisites = findSection(plan, 'Prerequisites');
    const prerequisiteTable = prerequisites && findTable(prerequisites, ['Tool', 'Installed']);
    if (!prerequisiteTable?.rows.length) {
        addIssue(issues, 'missingPrerequisites', '$.sections.prerequisites', 'Prerequisites must contain a populated tool inventory.');
    }

    const configurationsSection = findSection(plan, 'Debug Configurations');
    const configurations = configurationsSection
        && findTable(configurationsSection, ['Generate', 'Debug Config Name', 'Service Root', 'Project Type', 'Runtime']);
    if (!configurations) {
        addIssue(
            issues,
            'missingDebugConfigurations',
            '$.sections.debugConfigurations',
            'Debug Configurations must contain the canonical service table.',
        );
    } else {
        const generateIndex = findColumnIndex(configurations.headers, 'Generate');
        const nameIndex = findColumnIndex(configurations.headers, 'Debug Config Name');
        const serviceRootIndex = findColumnIndex(configurations.headers, 'Service Root');
        const projectTypeIndex = findColumnIndex(configurations.headers, 'Project Type');
        const runtimeIndex = findColumnIndex(configurations.headers, 'Runtime');
        const checked = configurations.rows.filter(row => isChecked(row[generateIndex] ?? ''));
        if (!checked.length) {
            addIssue(issues, 'noGeneratedConfigurations', '$.sections.debugConfigurations', 'At least one debug configuration must be selected.');
        }
        checked.forEach((row, index) => {
            if (!row[nameIndex]?.trim()) {
                addIssue(issues, 'missingDebugConfigName', `$.sections.debugConfigurations.rows[${index}]`, 'Selected configuration must have a name.');
            }
            const compound = row.some(cell => /compound\s+config/i.test(cell));
            if (!compound && (!row[serviceRootIndex]?.trim() || !row[projectTypeIndex]?.trim() || !row[runtimeIndex]?.trim())) {
                addIssue(
                    issues,
                    'incompleteDebugConfiguration',
                    `$.sections.debugConfigurations.rows[${index}]`,
                    'Selected service configurations require Service Root, Project Type, and Runtime.',
                );
            }
        });
    }

    const orchestrator = findSection(plan, 'Orchestrator');
    if (!orchestrator || !findTable(orchestrator, ['Orchestrator'])?.rows.length) {
        addIssue(issues, 'missingOrchestrator', '$.sections.orchestrator', 'Orchestrator must contain a selected local orchestration strategy.');
    }
    const architecture = findSection(plan, 'Architecture');
    if (!architecture || !flattenContent(architecture.content).some(value => value.type === 'codeBlock')) {
        addIssue(issues, 'missingArchitectureDiagram', '$.sections.architecture', 'Architecture Diagram must contain a code block.');
    }

    const requireSuccessfulChecklist = options.requireSuccessfulChecklist ?? plan.status === 'Implemented';
    if (requireSuccessfulChecklist) {
        const checklist = findSection(plan, 'Debug Configuration Checklist');
        const checklistText = checklist
            ? flattenContent(checklist.content)
                .flatMap(value => {
                    switch (value.type) {
                        case 'paragraph':
                        case 'blockquote':
                            return [value.text];
                        case 'bulletList':
                            return value.items;
                        default:
                            return [];
                    }
                })
                .join('\n')
            : '';
        if (!checklistText.includes('✅')) {
            addIssue(issues, 'missingSuccessfulChecklist', '$.sections.debugConfigurationChecklist', 'Implemented plans require real successful validation evidence.');
        }
        if (/❌|<config-name>|placeholder|not run/i.test(checklistText)) {
            addIssue(issues, 'unsuccessfulChecklist', '$.sections.debugConfigurationChecklist', 'Implemented plans must not contain failed or placeholder checklist entries.');
        }
    }
    return result(issues);
}

export async function validateLocalDebugArtifacts(
    workspace: string,
    planContent: string,
    options: { requireSuccessfulChecklist?: boolean } = {},
): Promise<ArtifactValidationResult> {
    const planResult = validateLocalDebugPlanArtifact(planContent, {
        requireAutoMode: true,
        requireSuccessfulChecklist: options.requireSuccessfulChecklist,
    });
    const issues = [...planResult.issues];
    const selected = getSelectedConfigurations(planContent);
    const launch = await readJsoncFile(path.join(workspace, '.vscode', 'launch.json'), '$.launch', issues);
    const tasks = await readJsoncFile(path.join(workspace, '.vscode', 'tasks.json'), '$.tasks', issues);
    const extensions = await readJsoncFile(path.join(workspace, '.vscode', 'extensions.json'), '$.extensions', issues);
    await readJsoncFile(path.join(workspace, '.vscode', 'settings.json'), '$.settings', issues);

    const launchConfigurations = Array.isArray(launch?.configurations)
        ? launch.configurations as DebugConfiguration[]
        : [];
    const launchCompounds = Array.isArray(launch?.compounds)
        ? launch.compounds as DebugCompound[]
        : [];
    if (!launchConfigurations.length) {
        addIssue(issues, 'missingLaunchConfigurations', '$.launch.configurations', 'launch.json must contain at least one configuration.');
    }
    const configurationNames = new Set(
        launchConfigurations.flatMap(value => typeof value.name === 'string' ? [value.name] : []),
    );
    const compoundNames = new Set(
        launchCompounds.flatMap(value => typeof value.name === 'string' ? [value.name] : []),
    );
    for (const configuration of selected.services) {
        if (!configurationNames.has(configuration)) {
            addIssue(issues, 'missingLaunchConfiguration', '$.launch.configurations', `Missing selected launch configuration "${configuration}".`);
        }
    }
    for (const compound of selected.compounds) {
        if (!compoundNames.has(compound)) {
            addIssue(issues, 'missingCompoundConfiguration', '$.launch.compounds', `Missing selected compound configuration "${compound}".`);
        }
    }
    for (const [index, compound] of launchCompounds.entries()) {
        const members = Array.isArray(compound.configurations) ? compound.configurations : [];
        if (!members.length || members.some(value => typeof value !== 'string' || !configurationNames.has(value))) {
            addIssue(
                issues,
                'invalidCompoundMembers',
                `$.launch.compounds[${index}].configurations`,
                'Every compound member must reference an existing launch configuration.',
            );
        }
    }

    const taskValues = Array.isArray(tasks?.tasks) ? tasks.tasks as DebugTask[] : [];
    const taskLabels = taskValues.flatMap(task => typeof task.label === 'string' ? [task.label] : []);
    const uniqueTaskLabels = new Set(taskLabels);
    if (!taskValues.length) {
        addIssue(issues, 'missingTasks', '$.tasks.tasks', 'tasks.json must contain at least one task.');
    }
    if (uniqueTaskLabels.size !== taskLabels.length) {
        addIssue(issues, 'duplicateTaskLabels', '$.tasks.tasks', 'Task labels must be unique.');
    }
    taskValues.forEach((task, index) => {
        if (task.runOptions?.instanceLimit !== 1 || task.runOptions?.instancePolicy !== 'silent') {
            addIssue(
                issues,
                'invalidTaskRunOptions',
                `$.tasks.tasks[${index}].runOptions`,
                'Every generated task requires instanceLimit 1 and instancePolicy "silent".',
            );
        }
        if (task.isBackground === true && isEmptyProblemMatcher(task.problemMatcher)) {
            addIssue(
                issues,
                'missingBackgroundProblemMatcher',
                `$.tasks.tasks[${index}].problemMatcher`,
                'Background tasks require a non-empty problem matcher.',
            );
        }
        for (const dependency of normalizeStringList(task.dependsOn)) {
            if (!uniqueTaskLabels.has(dependency)) {
                addIssue(
                    issues,
                    'missingTaskDependency',
                    `$.tasks.tasks[${index}].dependsOn`,
                    `Task dependency "${dependency}" does not exist.`,
                );
            }
        }
    });
    for (const [index, configuration] of launchConfigurations.entries()) {
        if (typeof configuration.preLaunchTask !== 'string' || !uniqueTaskLabels.has(configuration.preLaunchTask)) {
            addIssue(
                issues,
                'invalidPreLaunchTask',
                `$.launch.configurations[${index}].preLaunchTask`,
                'Every launch configuration must reference an existing preLaunchTask.',
            );
        }
    }
    detectTaskCycles(taskValues, issues);
    const rootManifest = await readPackageManifest(path.resolve(workspace));
    validateNodeServiceInstallTasks(workspace, taskValues, issues, rootManifest?.declaresWorkspaces === true);
    await validateNpmWorkspaceTaskTooling(workspace, taskValues, issues, rootManifest);
    await validateWorkspaceDependencyBuildOrder(workspace, taskValues, issues, rootManifest);
    await validateRedactedSecretPlaceholders(workspace, issues);
    await validateComposeInterpolationSource(workspace, issues);
    await validateTaskEnvironmentAvailability(workspace, taskValues, issues, rootManifest);
    await validateDeclaredTestScripts(workspace, issues, rootManifest);
    await validateFluentUiTestInterop(workspace, issues, rootManifest);
    await validateKnexCheckConstraints(workspace, issues);
    await validateGeneratedConfigSyntax(workspace, issues);

    const recommendations = Array.isArray(extensions?.recommendations) ? extensions.recommendations : [];
    if (!recommendations.length || recommendations.some(value => typeof value !== 'string' || !value.includes('.'))) {
        addIssue(
            issues,
            'missingExtensionRecommendations',
            '$.extensions.recommendations',
            'extensions.json must contain valid VS Code extension recommendations.',
        );
    }

    if (planSectionHasRows(planContent, 'Emulators')) {
        const composePath = await findFirstExisting(workspace, ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']);
        if (!composePath) {
            addIssue(issues, 'missingComposeFile', '$.dockerCompose', 'Plans with emulators require a Docker Compose file.');
        } else if (/\bazurite\b/i.test(planContent)) {
            const composeContent = await fs.readFile(path.join(workspace, composePath), 'utf8');
            if (!/skipApiVersionCheck/i.test(composeContent)) {
                addIssue(
                    issues,
                    'azuriteApiVersionCheckEnabled',
                    '$.dockerCompose.services.azurite.command',
                    'Azurite must start with --skipApiVersionCheck so newer Azure Storage SDK API versions work locally.',
                );
            }
        }
        if (!uniqueTaskLabels.has('Start Emulators')) {
            addIssue(issues, 'missingEmulatorTask', '$.tasks.tasks', 'Plans with emulators require a "Start Emulators" task.');
        }
    }
    if (planSectionHasCheckedRows(planContent, 'API Test Collections')) {
        const apiTests = await listFilesIfPresent(path.join(workspace, 'api-test-collections'));
        if (!apiTests.some(file => /invoke\.(?:sh|ps1)$/i.test(file))) {
            addIssue(
                issues,
                'missingApiTestCollections',
                '$.apiTestCollections',
                'Selected API test collections require generated invoke.sh or invoke.ps1 scripts.',
            );
        }
    }

    return result(issues);
}

export function applyLocalRuntimeEvidence(
    content: string,
    validation: SandboxLocalRuntimeValidationResult,
    now: string = new Date().toISOString(),
): string {
    if (validation.outcome !== 'passed' || !validation.probes.length) {
        throw new Error('Successful local runtime evidence is required before implementing the debug plan.');
    }
    const checklist = [
        '## Debug Configuration Checklist',
        '',
        'Debug Configuration Checklist:',
        ...validation.probes.map(probe => probe.processPattern
            ? `✅ ${probe.name} — process matching \`${probe.processPattern}\` remained live.`
            : `✅ ${probe.name} — ${probe.method} ${probe.url} returned ${probe.expectedStatus}${probe.response ? `; response captured (${probe.response.length} characters)` : ''}.`),
        '',
    ].join('\n');
    let updated = content
        .replace(
            /^(\s*>\s*\*\*Status:?\*\*:?\s*)(Planning|Approved|Executing|Implemented)\s*$/im,
            '$1Implemented',
        )
        .replace(
            /^(\s*>\s*\*\*Last Updated:?\*\*:?\s*).+$/im,
            `$1${now}`,
        );
    if (/^##\s+Debug Configuration Checklist\s*$/im.test(updated)) {
        updated = updated.replace(/^##\s+Debug Configuration Checklist\s*$[\s\S]*$/im, checklist);
    } else {
        updated = `${updated.trimEnd()}\n\n---\n\n${checklist}`;
    }
    return `${updated.trimEnd()}\n`;
}

function getSelectedConfigurations(content: string): { services: string[]; compounds: string[] } {
    const plan = parseLocalDebugPlanMarkdown(content);
    const section = findSection(plan, 'Debug Configurations');
    const table = section && findTable(section, ['Generate', 'Debug Config Name']);
    if (!table) {
        return { services: [], compounds: [] };
    }
    const generateIndex = findColumnIndex(table.headers, 'Generate');
    const nameIndex = findColumnIndex(table.headers, 'Debug Config Name');
    const services: string[] = [];
    const compounds: string[] = [];
    for (const row of table.rows.filter(value => isChecked(value[generateIndex] ?? ''))) {
        const name = row[nameIndex]?.trim();
        if (!name) {
            continue;
        }
        (row.some(cell => /compound\s+config/i.test(cell)) ? compounds : services).push(name);
    }
    return { services, compounds };
}

async function readJsoncFile(
    filePath: string,
    issuePath: string,
    issues: ArtifactValidationIssue[],
): Promise<Record<string, unknown> | undefined> {
    let content: string;
    try {
        content = await fs.readFile(filePath, 'utf8');
    } catch {
        addIssue(issues, 'missingDebugArtifact', issuePath, `Required debug artifact is missing: ${filePath}.`);
        return undefined;
    }
    const errors: ParseError[] = [];
    const value: unknown = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) {
        const details = errors.map(error => printParseErrorCode(error.error)).join(', ');
        addIssue(issues, 'invalidDebugArtifactJson', issuePath, `Debug artifact must be valid JSONC${details ? `: ${details}` : ''}.`);
        return undefined;
    }
    return value as Record<string, unknown>;
}

function detectTaskCycles(tasks: DebugTask[], issues: ArtifactValidationIssue[]): void {
    const graph = new Map<string, string[]>();
    for (const task of tasks) {
        if (typeof task.label === 'string') {
            graph.set(task.label, normalizeStringList(task.dependsOn));
        }
    }
    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (label: string): boolean => {
        if (active.has(label)) {
            return true;
        }
        if (visited.has(label)) {
            return false;
        }
        visited.add(label);
        active.add(label);
        const cyclic = (graph.get(label) ?? []).some(visit);
        active.delete(label);
        return cyclic;
    };
    if ([...graph.keys()].some(visit)) {
        addIssue(issues, 'cyclicTaskDependency', '$.tasks.tasks', 'Task dependency graph must not contain cycles.');
    }
}

function validateNodeServiceInstallTasks(
    workspace: string,
    tasks: DebugTask[],
    issues: ArtifactValidationIssue[],
    isWorkspacesMonorepo: boolean,
): void {
    const byLabel = new Map(tasks.flatMap(task =>
        typeof task.label === 'string' ? [[task.label, task] as const] : []));
    const root = path.resolve(workspace);
    const installTasksByCwd = new Map<string, string[]>();
    const rootInstallLabels: string[] = [];
    for (const task of tasks) {
        const command = typeof task.command === 'string' ? task.command : '';
        const label = typeof task.label === 'string' ? task.label : '';
        const cwd = typeof task.options?.cwd === 'string' ? task.options.cwd : '';
        if (!label || !/\bnpm\s+(?:install|ci)\b/i.test(command)) {
            continue;
        }
        if (cwd) {
            installTasksByCwd.set(cwd, [...(installTasksByCwd.get(cwd) ?? []), label]);
        }
        if (resolveTaskDirectory(workspace, task.options?.cwd) === root) {
            rootInstallLabels.push(label);
        }
    }

    for (const [index, task] of tasks.entries()) {
        const command = typeof task.command === 'string' ? task.command : '';
        const cwd = typeof task.options?.cwd === 'string' ? task.options.cwd : '';
        if (!cwd || !/\bnpm\s+run\s+(?:dev|start|watch)\b/i.test(command) || /\bnpm\s+(?:install|ci)\b/i.test(command)) {
            continue;
        }
        // In a workspaces monorepo the correct install runs at the workspace root, so a shared
        // root install task satisfies a service whose own cwd is a workspace member.
        const installTasks = [
            ...(installTasksByCwd.get(cwd) ?? []),
            ...(isWorkspacesMonorepo ? rootInstallLabels : []),
        ];
        if (!installTasks.length) {
            addIssue(
                issues,
                'missingServiceInstallTask',
                `$.tasks.tasks[${index}]`,
                `Node service task "${String(task.label)}" requires an npm install or npm ci task with the same cwd.`,
            );
            continue;
        }
        const reachable = collectTaskDependencies(task, byLabel);
        if (!installTasks.some(label => reachable.has(label))) {
            addIssue(
                issues,
                'unreachableServiceInstallTask',
                `$.tasks.tasks[${index}].dependsOn`,
                `Node service task "${String(task.label)}" must depend on its same-cwd install task.`,
            );
        }
    }
}

/**
 * npm workspaces install scoping: running `npm install` inside a member directory installs only
 * that member's dependency graph and skips the root package's own devDependencies. A tool declared
 * only at the root is therefore never materialized, and the member script fails with exit code 127.
 */
async function validateNpmWorkspaceTaskTooling(
    workspace: string,
    tasks: DebugTask[],
    issues: ArtifactValidationIssue[],
    rootManifest: PackageManifestSummary | undefined,
): Promise<void> {
    const root = path.resolve(workspace);
    if (!rootManifest || !rootManifest.declaresWorkspaces) {
        return;
    }
    const byLabel = new Map(tasks.flatMap(task =>
        typeof task.label === 'string' ? [[task.label, task] as const] : []));
    const rootInstallLabels = new Set(tasks.flatMap(task => {
        const command = typeof task.command === 'string' ? task.command : '';
        const label = typeof task.label === 'string' ? task.label : '';
        if (!label || !/\bnpm\s+(?:install|ci)\b/i.test(command)) {
            return [];
        }
        return resolveTaskDirectory(workspace, task.options?.cwd) === root ? [label] : [];
    }));

    for (const [index, task] of tasks.entries()) {
        const command = typeof task.command === 'string' ? task.command : '';
        const script = /\bnpm\s+run\s+([\w:.-]+)/i.exec(command)?.[1];
        const directory = resolveTaskDirectory(workspace, task.options?.cwd);
        if (!script || directory === root) {
            continue;
        }
        const reachable = collectTaskDependencies(task, byLabel);
        if (![...rootInstallLabels].some(label => reachable.has(label))) {
            addIssue(
                issues,
                'missingWorkspaceRootInstallTask',
                `$.tasks.tasks[${index}].dependsOn`,
                `Task "${String(task.label)}" runs an npm script inside workspace member "${path.relative(root, directory) || '.'}" but never depends on a workspace-root install task. A member-scoped npm install does not install root dependencies.`,
            );
        }
        const manifest = await readPackageManifest(directory);
        const body = manifest?.scripts[script];
        if (!manifest || !body) {
            continue;
        }
        for (const executable of invokedExecutables(body)) {
            const owner = BIN_PACKAGE_OWNERS[executable] ?? executable;
            if (manifest.dependencyNames.has(owner) || !rootManifest.dependencyNames.has(owner)) {
                continue;
            }
            addIssue(
                issues,
                'undeclaredWorkspaceToolDependency',
                `$.tasks.tasks[${index}].command`,
                `Script "${script}" in "${path.relative(root, directory)}/package.json" invokes "${executable}", which is declared only in the workspace root package.json. Declare "${owner}" in the package that invokes it.`,
            );
        }
    }
}

interface PackageManifestSummary {
    declaresWorkspaces: boolean;
    dependencyNames: Set<string>;
    scripts: Record<string, string>;
    name?: string;
    workspacePatterns: string[];
    buildOutputEntries: string[];
}

const BIN_PACKAGE_OWNERS: Record<string, string> = {
    'cross-env': 'cross-env',
    eslint: 'eslint',
    jest: 'jest',
    nodemon: 'nodemon',
    prettier: 'prettier',
    rimraf: 'rimraf',
    'ts-node': 'ts-node',
    tsc: 'typescript',
    tsx: 'tsx',
    vite: 'vite',
    vitest: 'vitest',
};

const SHELL_KEYWORDS = new Set([
    'cd', 'do', 'done', 'echo', 'else', 'exit', 'export', 'false', 'fi', 'for', 'if', 'set', 'then', 'true', 'while',
]);

function resolveTaskDirectory(workspace: string, cwd: unknown): string {
    const root = path.resolve(workspace);
    if (typeof cwd !== 'string' || !cwd.trim()) {
        return root;
    }
    const expanded = cwd.replace(/\$\{workspaceFolder\}/g, root).replace(/\\/g, '/');
    return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(root, expanded));
}

async function readPackageManifest(directory: string): Promise<PackageManifestSummary | undefined> {
    let raw: Record<string, unknown>;
    try {
        raw = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')) as Record<string, unknown>;
    } catch {
        return undefined;
    }
    const dependencyNames = new Set<string>();
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        const value = raw[field];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            Object.keys(value).forEach(name => dependencyNames.add(name));
        }
    }
    const scripts: Record<string, string> = {};
    const rawScripts = raw.scripts;
    if (rawScripts && typeof rawScripts === 'object' && !Array.isArray(rawScripts)) {
        for (const [name, body] of Object.entries(rawScripts)) {
            if (typeof body === 'string') {
                scripts[name] = body;
            }
        }
    }
    const workspaces = raw.workspaces;
    const workspacePatterns = Array.isArray(workspaces)
        ? workspaces.filter((value): value is string => typeof value === 'string')
        : (workspaces && typeof workspaces === 'object' && Array.isArray((workspaces as { packages?: unknown }).packages)
            ? ((workspaces as { packages: unknown[] }).packages).filter((value): value is string => typeof value === 'string')
            : []);
    const declaresWorkspaces = Array.isArray(workspaces)
        || (!!workspaces && typeof workspaces === 'object' && Array.isArray((workspaces as { packages?: unknown }).packages));
    const buildOutputEntries = ['main', 'types', 'typings', 'module']
        .flatMap(field => typeof raw[field] === 'string' ? [raw[field] as string] : []);
    return {
        declaresWorkspaces,
        dependencyNames,
        scripts,
        name: typeof raw.name === 'string' ? raw.name : undefined,
        workspacePatterns,
        buildOutputEntries,
    };
}

function invokedExecutables(script: string): string[] {
    return script
        .split(/&&|\|\||[;|]/)
        .flatMap(segment => {
            const token = segment
                .trim()
                .split(/\s+/)
                .find(candidate => candidate && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(candidate));
            const normalized = token?.replace(/^["']|["']$/g, '') ?? '';
            if (!normalized || normalized.startsWith('-') || normalized.includes('/') || SHELL_KEYWORDS.has(normalized)) {
                return [];
            }
            return [normalized];
        });
}

function collectTaskDependencies(task: DebugTask, byLabel: Map<string, DebugTask>): Set<string> {
    const found = new Set<string>();
    const visit = (label: string): void => {
        if (found.has(label)) {
            return;
        }
        found.add(label);
        const dependency = byLabel.get(label);
        if (dependency) {
            normalizeStringList(dependency.dependsOn).forEach(visit);
        }
    };
    normalizeStringList(task.dependsOn).forEach(visit);
    return found;
}

function normalizeStringList(value: unknown): string[] {
    if (typeof value === 'string') {
        return [value];
    }
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isEmptyProblemMatcher(value: unknown): boolean {
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function planSectionHasRows(content: string, sectionName: string): boolean {
    const section = findSection(parseLocalDebugPlanMarkdown(content), sectionName);
    return !!section && flattenContent(section.content).some(value => value.type === 'table' && value.rows.length > 0);
}

function planSectionHasCheckedRows(content: string, sectionName: string): boolean {
    const section = findSection(parseLocalDebugPlanMarkdown(content), sectionName);
    if (!section) {
        return false;
    }
    return flattenContent(section.content).some(value =>
        value.type === 'table' && value.rows.some(row => row.some(isChecked)));
}

async function findFirstExisting(directory: string, names: string[]): Promise<string | undefined> {
    for (const name of names) {
        try {
            await fs.access(path.join(directory, name));
            return name;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }
    }
    return undefined;
}

async function listFilesIfPresent(directory: string): Promise<string[]> {
    let entries: import('fs').Dirent[];
    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    return (await Promise.all(entries.map(async entry => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? await listFilesIfPresent(entryPath) : [entryPath];
    }))).flat();
}

function addIssue(
    issues: ArtifactValidationIssue[],
    code: string,
    issuePath: string,
    message: string,
): void {
    issues.push({ code, path: issuePath, message });
}

/**
 * In an npm workspaces monorepo a member that imports another member resolves it through the
 * dependency's published entry points (`main` / `types`), which point at compiled output. Nothing
 * emits that output until the dependency's own build runs, so a service task that builds or watches
 * without first building its workspace dependencies compiles against missing type declarations.
 *
 * This fails silently: `tsc --watch` reports the errors but never exits, so the task stays "running"
 * and downstream hosts start against output that was never emitted.
 */
async function validateWorkspaceDependencyBuildOrder(
    workspace: string,
    tasks: DebugTask[],
    issues: ArtifactValidationIssue[],
    rootManifest: PackageManifestSummary | undefined,
): Promise<void> {
    if (!rootManifest?.declaresWorkspaces) {
        return;
    }
    const root = path.resolve(workspace);
    const members = await readWorkspaceMembers(root, rootManifest);
    if (members.size < 2) {
        return;
    }
    const byDirectory = new Map([...members.values()].map(member => [member.directory, member] as const));
    const byLabel = new Map(tasks.flatMap(task =>
        typeof task.label === 'string' ? [[task.label, task] as const] : []));

    for (const [index, task] of tasks.entries()) {
        const command = typeof task.command === 'string' ? task.command : '';
        if (!/\bnpm\s+run\s+(?:build|watch|dev|start)\b|\btsc\b/i.test(command)) {
            continue;
        }
        const member = byDirectory.get(resolveTaskDirectory(workspace, task.options?.cwd) ?? '');
        if (!member) {
            continue;
        }
        const internalDependencies = [...member.manifest.dependencyNames]
            .flatMap(name => {
                const dependency = members.get(name);
                return dependency && dependency.directory !== member.directory && dependency.producesBuildOutput
                    ? [dependency]
                    : [];
            });
        if (!internalDependencies.length) {
            continue;
        }
        const reachable = collectTaskDependencies(task, byLabel);
        const reachableTasks = tasks.filter(candidate =>
            typeof candidate.label === 'string' && reachable.has(candidate.label));

        for (const dependency of internalDependencies) {
            if (await hasProjectReferenceTo(member.directory, dependency.directory)) {
                continue;
            }
            const built = reachableTasks.some(candidate => buildsWorkspacePackage(
                workspace,
                candidate,
                dependency,
                root,
                rootManifest,
            ));
            if (!built) {
                addIssue(
                    issues,
                    'missingWorkspaceDependencyBuild',
                    `$.tasks.tasks[${index}].dependsOn`,
                    `Task "${String(task.label)}" builds workspace package ${member.name ?? member.directory}, which depends on `
                    + `${dependency.name}, but nothing builds ${dependency.name} first. `
                    + `${dependency.name} resolves through compiled output (${dependency.manifest.buildOutputEntries.join(', ')}), `
                    + 'so the compile sees missing type declarations. Add a build task for the dependency and depend on it, '
                    + 'or use TypeScript project references so `tsc -b` builds it automatically.',
                );
            }
        }
    }
}

interface WorkspaceMember {
    name?: string;
    directory: string;
    manifest: PackageManifestSummary;
    producesBuildOutput: boolean;
}

async function readWorkspaceMembers(
    root: string,
    rootManifest: PackageManifestSummary,
): Promise<Map<string, WorkspaceMember>> {
    const directories = new Set<string>();
    for (const pattern of rootManifest.workspacePatterns) {
        const normalized = pattern.replace(/\\/g, '/');
        if (!normalized.includes('*')) {
            directories.add(path.resolve(root, normalized));
            continue;
        }
        // Support the common `dir/*` shape without pulling in a glob dependency.
        const base = normalized.slice(0, normalized.indexOf('*')).replace(/\/$/, '');
        let entries: string[];
        try {
            entries = (await fs.readdir(path.resolve(root, base), { withFileTypes: true }))
                .filter(entry => entry.isDirectory())
                .map(entry => path.resolve(root, base, entry.name));
        } catch {
            continue;
        }
        entries.forEach(entry => directories.add(entry));
    }

    const members = new Map<string, WorkspaceMember>();
    for (const directory of directories) {
        const manifest = await readPackageManifest(directory);
        if (!manifest?.name) {
            continue;
        }
        const producesBuildOutput = typeof manifest.scripts.build === 'string'
            && manifest.buildOutputEntries.some(entry => /^(?:\.\/)?(?:dist|build|lib|out|es[m5]?)\b/i.test(entry));
        members.set(manifest.name, { name: manifest.name, directory, manifest, producesBuildOutput });
    }
    return members;
}

function buildsWorkspacePackage(
    workspace: string,
    task: DebugTask,
    dependency: WorkspaceMember,
    root: string,
    rootManifest: PackageManifestSummary,
): boolean {
    const command = typeof task.command === 'string' ? task.command : '';
    const args = normalizeStringList(task.args).join(' ');
    const full = `${command} ${args}`.trim();
    if (!/\b(?:npm\s+run\s+build|npm\s+run\s+watch|tsc)\b/i.test(full)) {
        return false;
    }
    const directory = resolveTaskDirectory(workspace, task.options?.cwd);
    // A task running inside the dependency's own directory builds it directly.
    if (directory === dependency.directory) {
        return true;
    }
    // `npm run build -w <name>` / `--workspace <name>` targets it explicitly.
    const name = dependency.name ?? '';
    if (name && new RegExp(`(?:-w|--workspace)[\\s=]+${escapeRegExp(name)}(?:\\s|$)`, 'i').test(full)) {
        return true;
    }
    // A root aggregate build counts when the root build script targets the dependency.
    if (directory === root && /\bnpm\s+run\s+build\b/i.test(full)) {
        const rootBuild = rootManifest.scripts.build ?? '';
        if (name && rootBuild.includes(name)) {
            return true;
        }
    }
    return false;
}

async function hasProjectReferenceTo(memberDirectory: string, dependencyDirectory: string): Promise<boolean> {
    const visited = new Set<string>();
    const visit = async (tsconfigPath: string, depth: number): Promise<boolean> => {
        if (depth > 3 || visited.has(tsconfigPath)) {
            return false;
        }
        visited.add(tsconfigPath);
        let content: string;
        try {
            content = await fs.readFile(tsconfigPath, 'utf8');
        } catch {
            return false;
        }
        const parsed = parse(content, [], { allowTrailingComma: true, disallowComments: false }) as
            { references?: { path?: unknown }[] } | undefined;
        const references = Array.isArray(parsed?.references) ? parsed.references : [];
        for (const reference of references) {
            if (typeof reference?.path !== 'string') {
                continue;
            }
            const resolved = path.resolve(path.dirname(tsconfigPath), reference.path);
            const directory = /\.json$/i.test(resolved) ? path.dirname(resolved) : resolved;
            if (directory === dependencyDirectory || directory.startsWith(`${dependencyDirectory}${path.sep}`)) {
                return true;
            }
            const nested = /\.json$/i.test(resolved) ? resolved : path.join(resolved, 'tsconfig.json');
            if (await visit(nested, depth + 1)) {
                return true;
            }
        }
        return false;
    };
    return await visit(path.join(memberDirectory, 'tsconfig.json'), 0);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CONFIG_FILE_PATTERN = /(^|[/\\])(docker-compose\.ya?ml|compose\.ya?ml|local\.settings\.json|\.env(\..+)?)$/i;const REDACTION_MASK_PATTERN = /\*{3,}/;

/**
 * Secret-redaction filters rewrite concrete `scheme://user:password@host` literals to a run of
 * asterisks. When that masked text reaches a generated config file it is silently corrupt, and in
 * YAML it is fatal: a leading `*` is an alias indicator, so the whole compose file fails to parse.
 */
async function validateRedactedSecretPlaceholders(
    workspace: string,
    issues: ArtifactValidationIssue[],
): Promise<void> {
    const candidates = (await listFilesIfPresent(workspace)).filter(filePath =>
        !filePath.includes(`${path.sep}node_modules${path.sep}`)
        && !filePath.includes(`${path.sep}.git${path.sep}`)
        && CONFIG_FILE_PATTERN.test(filePath));
    for (const filePath of candidates) {
        let content: string;
        try {
            content = await fs.readFile(filePath, 'utf8');
        } catch {
            continue;
        }
        const relative = path.relative(workspace, filePath) || path.basename(filePath);
        content.split('\n').forEach((line, index) => {
            const match = REDACTION_MASK_PATTERN.exec(line);
            // Skip glob patterns such as `**/*`, which legitimately contain adjacent asterisks.
            if (!match || line.includes('*/') || line.includes('/*')) {
                return;
            }
            addIssue(
                issues,
                'redactedSecretPlaceholder',
                `$.generatedConfig["${relative}"].line[${index + 1}]`,
                `${relative} line ${index + 1} contains a redaction mask ("${match[0]}") where a value is expected. `
                + 'A concrete credential literal was masked by a secret-redaction filter before it was written. '
                + 'Build connection strings from discrete variables instead of inlining user:password@host.',
            );
        });
    }
}

/**
 * `${VAR}` in a Compose file interpolates from `.env` or the shell, never from a service's own
 * `environment:` block. Without a `.env` the value resolves to an empty string and the database
 * fails to authenticate at runtime rather than failing fast.
 */
async function validateComposeInterpolationSource(
    workspace: string,
    issues: ArtifactValidationIssue[],
): Promise<void> {
    const composePath = await findFirstExisting(workspace, ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']);
    if (!composePath) {
        return;
    }
    let composeContent: string;
    try {
        composeContent = await fs.readFile(path.join(workspace, composePath), 'utf8');
    } catch {
        return;
    }
    const referenced = new Set<string>();
    for (const match of composeContent.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-[^}]*)?\}/g)) {
        // A default value (`${VAR:-fallback}`) makes the reference safe on its own.
        if (!match[0].includes('-')) {
            referenced.add(match[1]);
        }
    }
    if (!referenced.size) {
        return;
    }
    const envPath = await findFirstExisting(workspace, ['.env']);
    let declared = new Set<string>();
    if (envPath) {
        const envContent = await fs.readFile(path.join(workspace, envPath), 'utf8');
        declared = new Set(envContent
            .split('\n')
            .flatMap(line => {
                const parsed = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
                return parsed ? [parsed[1]] : [];
            }));
    }
    const missing = [...referenced].filter(name => !declared.has(name)).sort();
    if (missing.length) {
        addIssue(
            issues,
            'missingComposeEnvValues',
            '$.dockerCompose.interpolation',
            `${composePath} interpolates ${missing.map(name => `\${${name}}`).join(', ')} but ${envPath ? `.env does not declare ${missing.length === 1 ? 'it' : 'them'}` : 'no .env file exists'}. `
            + 'Compose resolves undeclared variables to an empty string, so services start with blank credentials instead of failing fast.',
        );
    }
}

/** Tasks whose process inherits environment from a runtime-owned settings file rather than the shell. */
const FUNCTIONS_HOST_COMMAND = /\bfunc\b[^\n]*\b(?:host\s+start|start)\b/;

/** `require('dotenv')`, `-r dotenv/config`, `dotenv -e .env --`, and the dotenvx equivalents. */
const DOTENV_LOADER_PATTERN = /\bdotenv(?:x|-cli)?\b/;

/** Reads a value straight out of the environment with no inline fallback of any kind. */
function readsEnvWithoutFallback(content: string, name: string): boolean {
    const pattern = new RegExp(
        `process\\.env\\.${escapeRegExp(name)}\\b|process\\.env\\[\\s*['"\`]${escapeRegExp(name)}['"\`]\\s*\\]`,
        'g',
    );
    for (const match of content.matchAll(pattern)) {
        const rest = content.slice(match.index + match[0].length, match.index + match[0].length + 40);
        // `?? 'x'`, `|| 'x'`, and `: 'x'` all supply a value when the variable is absent.
        if (/^\s*[!]?\s*(?:\?\?|\|\||\?\.|:)/.test(rest)) {
            continue;
        }
        return true;
    }
    return false;
}

function parseEnvKeys(content: string): Set<string> {
    return new Set(content.split('\n').flatMap(line => {
        const parsed = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        return parsed ? [parsed[1]] : [];
    }));
}

/**
 * A debug task that runs outside a runtime host gets its environment from the shell, so a `.env`
 * file only reaches it when something in the command chain actually loads dotenv. When the generated
 * project documents a value in `.env.example`, omits it from `.env`, and then reads it without a
 * fallback, the task starts with the variable undefined.
 *
 * This is how a database migration fails with a connection error that looks like an unready server:
 * the client never attempts a connection because it was handed `undefined` instead of a URL.
 */
async function validateTaskEnvironmentAvailability(
    workspace: string,
    tasks: DebugTask[],
    issues: ArtifactValidationIssue[],
    rootManifest: PackageManifestSummary | undefined,
): Promise<void> {
    const examplePath = await findFirstExisting(workspace, ['.env.example', '.env.sample', '.env.template']);
    if (!examplePath) {
        return;
    }
    let documented: Set<string>;
    try {
        documented = parseEnvKeys(await fs.readFile(path.join(workspace, examplePath), 'utf8'));
    } catch {
        return;
    }
    const envPath = await findFirstExisting(workspace, ['.env']);
    let declared = new Set<string>();
    if (envPath) {
        try {
            declared = parseEnvKeys(await fs.readFile(path.join(workspace, envPath), 'utf8'));
        } catch {
            return;
        }
    }
    const undeclared = [...documented].filter(name => !declared.has(name));
    if (!undeclared.length) {
        return;
    }

    const members = rootManifest ? await readWorkspaceMembers(path.resolve(workspace), rootManifest) : new Map();
    const byLabel = new Map<string, DebugTask>();
    tasks.forEach(task => {
        if (typeof task.label === 'string') {
            byLabel.set(task.label, task);
        }
    });

    for (const task of tasks) {
        const label = typeof task.label === 'string' ? task.label : '';
        const commandText = [task.command, ...(Array.isArray(task.args) ? task.args : [])]
            .filter((value): value is string => typeof value === 'string')
            .join(' ')
            .trim();
        if (!commandText) {
            continue;
        }
        const taskDirectory = resolveTaskDirectory(workspace, task.options?.cwd);
        const segments = await resolveScriptChain(commandText, taskDirectory, workspace, members);
        const chainText = [commandText, ...segments.map(segment => segment.body)].join('\n');
        // A runtime host injects its own settings file, so the shell environment is not the source.
        if (FUNCTIONS_HOST_COMMAND.test(chainText) || DOTENV_LOADER_PATTERN.test(chainText)) {
            continue;
        }
        // Compose supplies `environment:` to the container it starts.
        if (/\bdocker\s+compose\b/.test(chainText)) {
            continue;
        }
        // Resolve config paths against the directory each script segment actually runs in.
        const searchRoots = [taskDirectory, ...segments.map(segment => segment.directory), path.resolve(workspace)];
        const entryFiles = await collectCommandEntryFiles(chainText, searchRoots, workspace);
        if (!entryFiles.length) {
            continue;
        }
        const required = new Set<string>();
        for (const file of entryFiles) {
            let content: string;
            try {
                content = await fs.readFile(file, 'utf8');
            } catch {
                continue;
            }
            for (const name of undeclared) {
                if (readsEnvWithoutFallback(content, name)) {
                    required.add(name);
                }
            }
        }
        const missing = [...required].sort();
        if (missing.length) {
            addIssue(
                issues,
                'missingTaskEnvValue',
                `$.tasks["${label}"].environment`,
                `Task "${label}" runs \`${commandText}\`, which reads ${missing.join(', ')} from the environment with no fallback, `
                + `but ${envPath ? `.env does not declare ${missing.length === 1 ? 'it' : 'them'}` : 'no .env file exists'} `
                + `(${examplePath} does). The task starts with the value undefined instead of failing fast. `
                + 'Declare every value the debug tasks need in .env, or run the work through the docker compose service that already defines it.',
            );
        }
    }
}

/** Follows `npm run <script>` (including `-w <name>`/`--workspace <name>`) to the script bodies it executes. */
async function resolveScriptChain(
    commandText: string,
    taskDirectory: string,
    workspace: string,
    members: Map<string, WorkspaceMember>,
    depth = 0,
): Promise<{ body: string; directory: string }[]> {
    if (depth > 3) {
        return [];
    }
    const run = /\bnpm\s+(?:run|run-script)\s+([A-Za-z0-9:_-]+)([^\n]*)/.exec(commandText);
    if (!run) {
        return [];
    }
    const [, scriptName, rest] = run;
    const workspaceFlag = /(?:-w|--workspace(?:=|\s+))\s*([@A-Za-z0-9/._-]+)/.exec(rest ?? '');
    let directory = taskDirectory;
    if (workspaceFlag) {
        const member = members.get(workspaceFlag[1]);
        directory = member ? member.directory : path.resolve(workspace, workspaceFlag[1]);
    }
    const manifest = await readPackageManifest(directory);
    const body = manifest?.scripts?.[scriptName];
    if (typeof body !== 'string') {
        return [];
    }
    return [
        { body, directory },
        ...await resolveScriptChain(body, directory, workspace, members, depth + 1),
    ];
}

/** Config files a command names explicitly (`--knexfile x`, `--config x`) plus the script's own entry file. */
async function collectCommandEntryFiles(
    chainText: string,
    searchRoots: string[],
    workspace: string,
): Promise<string[]> {
    const candidates = new Set<string>();
    const flagPattern = /(?:--knexfile|--config|--configFile|-c)(?:=|\s+)([^\s'"]+)/g;
    for (const match of chainText.matchAll(flagPattern)) {
        candidates.add(match[1]);
    }
    for (const match of chainText.matchAll(/\b(?:node|tsx|ts-node)\s+([^\s'"]+\.(?:[cm]?[jt]s))\b/g)) {
        candidates.add(match[1]);
    }
    const resolved: string[] = [];
    for (const candidate of candidates) {
        if (path.isAbsolute(candidate) || candidate.startsWith('-')) {
            continue;
        }
        for (const base of searchRoots) {
            const full = path.resolve(base, candidate);
            // Never follow a path that escapes the workspace.
            if (path.relative(path.resolve(workspace), full).startsWith('..')) {
                continue;
            }
            try {
                await fs.access(full);
                resolved.push(full);
                break;
            } catch {
                continue;
            }
        }
    }
    return resolved;
}

/** Runners that treat "no tests collected" as a failing exit code unless explicitly told otherwise. */
const EMPTY_TEST_RUNNERS = /\b(vitest|jest)\b/;
const PASS_WITH_NO_TESTS = /--passWithNoTests\b/;
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;

/**
 * `vitest run` and `jest` exit non-zero when they collect no test files. A generated package that
 * advertises a `test` script it cannot satisfy fails the workspace-wide `npm test` even though every
 * package that does have tests passes.
 */
async function validateDeclaredTestScripts(
    workspace: string,
    issues: ArtifactValidationIssue[],
    rootManifest: PackageManifestSummary | undefined,
): Promise<void> {
    if (!rootManifest) {
        return;
    }
    const root = path.resolve(workspace);
    const members = await readWorkspaceMembers(root, rootManifest);
    // A single-package project fails the same way, so check the root package when it owns no members.
    const candidates = members.size
        ? [...members.values()].map(member => ({
            name: member.name,
            directory: member.directory,
            script: member.manifest.scripts.test,
            pointer: `$.workspaceMembers["${member.name}"].scripts.test`,
            scope: 'workspace-wide `npm test`',
        }))
        : [{
            name: rootManifest.name ?? 'the project',
            directory: root,
            script: rootManifest.scripts.test,
            pointer: '$.package.scripts.test',
            scope: '`npm test`',
        }];
    for (const candidate of candidates) {
        const script = candidate.script;
        if (typeof script !== 'string'
            || !EMPTY_TEST_RUNNERS.test(script)
            || PASS_WITH_NO_TESTS.test(script)) {
            continue;
        }
        if (await hasPassWithNoTestsConfig(candidate.directory)) {
            continue;
        }
        const files = (await listFilesIfPresent(candidate.directory)).filter(file =>
            !file.includes(`${path.sep}node_modules${path.sep}`)
            && !file.includes(`${path.sep}dist${path.sep}`)
            && TEST_FILE_PATTERN.test(file));
        if (files.length) {
            continue;
        }
        addIssue(
            issues,
            'testScriptWithoutTests',
            candidate.pointer,
            `Package "${candidate.name}" declares \`test\`: "${script}" but contains no *.test.* or *.spec.* files, `
            + `and the runner exits non-zero when it collects nothing. This fails ${candidate.scope}. `
            + 'Add at least one test, or set passWithNoTests when the package is intentionally untested.',
        );
    }
}

/**
 * Fluent UI v9 depends on `tabster`, which is CommonJS. Vitest externalizes it by default, so the
 * suite aborts at import time and every test fails before running. The failure looks like a broken
 * test but is a build-configuration defect, so catch it deterministically rather than in a paid run.
 */
async function validateFluentUiTestInterop(
    workspace: string,
    issues: ArtifactValidationIssue[],
    rootManifest: PackageManifestSummary | undefined,
): Promise<void> {
    if (!rootManifest) {
        return;
    }
    const root = path.resolve(workspace);
    const members = await readWorkspaceMembers(root, rootManifest);
    const candidates = members.size
        ? [...members.values()].map(member => ({
            name: member.name,
            directory: member.directory,
            manifest: member.manifest,
            pointer: `$.workspaceMembers["${member.name}"]`,
        }))
        : [{ name: rootManifest.name ?? 'the project', directory: root, manifest: rootManifest, pointer: '$.package' }];

    for (const candidate of candidates) {
        const script = candidate.manifest.scripts.test;
        if (typeof script !== 'string' || !/\bvitest\b/u.test(script)) {
            continue;
        }
        if (!FLUENT_UI_PACKAGES.some(name => candidate.manifest.dependencyNames.has(name))) {
            continue;
        }
        // Only components actually rendered under test trigger the import, so require a test file.
        const files = (await listFilesIfPresent(candidate.directory)).filter(file =>
            !file.includes(`${path.sep}node_modules${path.sep}`) && TEST_FILE_PATTERN.test(file));
        if (!files.length) {
            continue;
        }
        if (await hasCommonJsInlineConfig(candidate.directory)) {
            continue;
        }
        addIssue(
            issues,
            'fluentUiTestInteropMissing',
            candidate.pointer,
            `Package "${candidate.name}" tests Fluent UI components with vitest but no config inlines its `
            + 'CommonJS dependencies. `tabster` then fails to import and every test in the file aborts before '
            + 'running ("The requested module \'tabster\' is a CommonJS module"). '
            + "Set test.server.deps.inline to include '@fluentui/react-components' and 'tabster'.",
        );
    }
}

/**
 * The plan-independent code contracts, runnable as soon as source exists.
 *
 * These normally run at the `local-artifacts` gate, which is far too late: the repair budget is
 * shared across build/integration/local stages, so by the time a precise message like
 * "declares `test` but contains no test files" is produced, the agent has already spent both
 * repairs guessing at a bare `npm test` failure. Surfacing them at the moment a build or test
 * command fails makes the very first repair attempt an informed one.
 */
export async function diagnoseGeneratedCode(workspace: string): Promise<ArtifactValidationIssue[]> {
    const issues: ArtifactValidationIssue[] = [];
    const rootManifest = await readPackageManifest(path.resolve(workspace));
    await validateDeclaredTestScripts(workspace, issues, rootManifest);
    await validateFluentUiTestInterop(workspace, issues, rootManifest);
    await validateKnexCheckConstraints(workspace, issues);
    await validateGeneratedConfigSyntax(workspace, issues);
    return issues;
}

const FLUENT_UI_PACKAGES = ['@fluentui/react-components', '@fluentui/react-icons', 'tabster'];

/**
 * A syntax error in a generated config file fails `npm run build` — the very first gate — so it
 * costs a full paid run to discover. Run 10 died this way: the agent appended a `test: { … }`
 * block *after* the closing `});` of `defineConfig`, yielding TS1005/TS1128. Parsing the file
 * offline catches any such botched merge in milliseconds.
 */
const GENERATED_CONFIG_FILE = /[\\/](?:vite|vitest|playwright|jest|tailwind|postcss|knexfile)\.config\.(?:ts|mts|cts|js|mjs|cjs)$|[\\/]knexfile\.(?:ts|js)$/u;

async function validateGeneratedConfigSyntax(workspace: string, issues: ArtifactValidationIssue[]): Promise<void> {
    const ts = await import('typescript');
    const root = path.resolve(workspace);
    const files = (await listFilesIfPresent(root)).filter(file => {
        const normalized = file.replace(/\\/gu, '/');
        return !normalized.includes('/node_modules/') && GENERATED_CONFIG_FILE.test(normalized);
    });

    for (const file of files) {
        let source: string;
        try {
            source = await fs.readFile(file, 'utf8');
        } catch {
            continue;
        }
        const relative = path.relative(root, file).replace(/\\/gu, '/');
        const result = ts.transpileModule(source, {
            reportDiagnostics: true,
            fileName: path.basename(file),
            compilerOptions: { target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.Preserve, allowJs: true },
        });
        // transpileModule only surfaces syntactic diagnostics, so every hit here is a real parse error.
        const syntactic = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
        if (!syntactic.length) {
            continue;
        }
        const described = syntactic.slice(0, 3).map(diagnostic => {
            const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
            if (typeof diagnostic.start !== 'number') {
                return `TS${diagnostic.code}: ${message}`;
            }
            const { line, character } = ts.getLineAndCharacterOfPosition(
                ts.createSourceFile(path.basename(file), source, ts.ScriptTarget.ESNext, false),
                diagnostic.start,
            );
            return `${relative}(${line + 1},${character + 1}): TS${diagnostic.code}: ${message}`;
        });
        addIssue(
            issues,
            'generatedConfigSyntaxError',
            `$.configFiles["${relative}"]`,
            `${relative} is not syntactically valid TypeScript, so \`npm run build\` fails before any other `
            + `gate runs: ${described.join(' | ')}. This is usually a botched merge — a new block appended `
            + 'after the closing `});` of `export default defineConfig({ … })` instead of being added as a key '
            + 'inside the object. Re-read the whole file and confirm it has exactly one top-level export.',
        );
    }
}

/**
 * Knex exposes `check` on the table builder, but every constrained-value helper
 * (`checkIn`, `checkPositive`, …) exists only on the *column* builder. Calling one on the table
 * throws `TypeError: table.checkIn is not a function` at migrate time — which happens after build
 * and tests pass, so it consumes the entire repair budget before anything catches it.
 *
 * Verified empirically against knex 3.3.0: TableBuilder.prototype exposes only `check`.
 */
const KNEX_COLUMN_ONLY_CHECKS = [
    'checkIn', 'checkNotIn', 'checkPositive', 'checkNegative', 'checkBetween', 'checkLength', 'checkRegex',
];

function findKnexTableCheckMisuse(source: string): { method: string; line: number }[] {
    const found: { method: string; line: number }[] = [];
    const lines = source.split('\n');
    for (const [index, line] of lines.entries()) {
        // Ignore comments so documented counter-examples don't trip the contract.
        const code = line.replace(/\/\/.*$/u, '');
        for (const method of KNEX_COLUMN_ONLY_CHECKS) {
            // Only flag a *direct* call on the builder param (`table.checkIn(`), not a chained
            // column call (`table.string('x').checkIn(`), which is the correct form.
            if (new RegExp(`(^|[^.\\w])(\\w+)\\.${method}\\s*\\(`, 'u').test(code)
                && !new RegExp(`\\)\\s*(\\.\\w+\\s*\\([^)]*\\)\\s*)*\\.${method}\\s*\\(`, 'u').test(code)) {
                found.push({ method, line: index + 1 });
            }
        }
    }
    return found;
}

async function validateKnexCheckConstraints(workspace: string, issues: ArtifactValidationIssue[]): Promise<void> {
    const root = path.resolve(workspace);
    const files = (await listFilesIfPresent(root)).filter(file => {
        const normalized = file.replace(/\\/gu, '/');
        return !normalized.includes('/node_modules/') && /\/migrations?\/[^/]*\.(ts|js|mjs|cjs)$/u.test(normalized);
    });
    for (const file of files) {
        let source: string;
        try {
            source = await fs.readFile(file, 'utf8');
        } catch {
            continue;
        }
        const relative = path.relative(root, file).replace(/\\/gu, '/');
        if (!/\bknex\b/u.test(source) && !/TableBuilder|Knex\.Schema/u.test(source)) {
            continue;
        }
        for (const { method, line } of findKnexTableCheckMisuse(source)) {
            addIssue(
                issues,
                'knexTableCheckMisuse',
                `$.migrations["${relative}"]`,
                `${relative}:${line} calls `
                + `\`.${method}(…)\` on the table builder, but knex defines \`${method}\` only on the column `
                + `builder — the table builder exposes just \`check\`. This throws `
                + `"TypeError: table.${method} is not a function" when migrations run, after build and tests `
                + `have already passed. Chain it onto the column instead, e.g. `
                + `\`table.string('status', 20).notNullable().${method}([...])\`, or use a raw `
                + '`table.check("status in (\'a\',\'b\')")` predicate.',
            );
        }
    }
}

/**
 * Vitest matches `inline` entries against the module's **absolute path**, so an anchored pattern
 * such as `/^@fluentui\//` silently never matches and the package stays externalized. Replicate the
 * real matcher instead of looking for the package name, or a config that cannot work reads as valid.
 */
function inlineMatchesFluentUi(inlineSource: string): boolean {
    if (/\binline\s*:\s*true/u.test(inlineSource)) {
        return true;
    }
    const fluentPath = '/workspace/node_modules/@fluentui/react-components/dist/index.js';
    for (const literal of inlineSource.matchAll(/\/((?:[^/\\\n]|\\.)+)\/([gimsuy]*)/gu)) {
        try {
            if (new RegExp(literal[1], literal[2].replace(/[gy]/gu, '')).test(fluentPath)) {
                return true;
            }
        } catch {
            continue;
        }
    }
    // A string entry is matched as `id.includes('/node_modules/' + entry)`.
    for (const literal of inlineSource.matchAll(/['"`]([^'"`\n]+)['"`]/gu)) {
        if (fluentPath.includes(`/node_modules/${literal[1]}`)) {
            return true;
        }
    }
    return false;
}

async function hasCommonJsInlineConfig(directory: string): Promise<boolean> {
    const configNames = [
        'vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vitest.config.mjs',
        'vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs',
    ];
    for (const name of configNames) {
        let contents: string;
        try {
            contents = await fs.readFile(path.join(directory, name), 'utf8');
        } catch {
            continue;
        }
        const marker = contents.search(/\binline\s*:/u);
        if (marker < 0) {
            continue;
        }
        // Bound the scan to the inline value so unrelated config below cannot satisfy the check.
        if (inlineMatchesFluentUi(contents.slice(marker, marker + 400))) {
            return true;
        }
    }
    return false;
}

async function hasPassWithNoTestsConfig(directory: string): Promise<boolean> {
    const configNames = [
        'vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vite.config.ts', 'vite.config.js',
        'jest.config.ts', 'jest.config.js', 'jest.config.cjs', 'jest.config.json',
    ];
    for (const name of configNames) {
        try {
            if (/passWithNoTests\s*:\s*true/.test(await fs.readFile(path.join(directory, name), 'utf8'))) {
                return true;
            }
        } catch {
            continue;
        }
    }
    try {
        const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')) as Record<string, unknown>;
        const jest = manifest.jest;
        if (jest && typeof jest === 'object' && (jest as { passWithNoTests?: unknown }).passWithNoTests === true) {
            return true;
        }
    } catch {
        // A package without a readable manifest is reported by other contracts.
    }
    return false;
}

function result(issues: ArtifactValidationIssue[]): ArtifactValidationResult {
    return { valid: issues.length === 0, issues };
}

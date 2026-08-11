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
    validateNodeServiceInstallTasks(taskValues, issues);

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

function validateNodeServiceInstallTasks(tasks: DebugTask[], issues: ArtifactValidationIssue[]): void {
    const byLabel = new Map(tasks.flatMap(task =>
        typeof task.label === 'string' ? [[task.label, task] as const] : []));
    const installTasksByCwd = new Map<string, string[]>();
    for (const task of tasks) {
        const command = typeof task.command === 'string' ? task.command : '';
        const label = typeof task.label === 'string' ? task.label : '';
        const cwd = typeof task.options?.cwd === 'string' ? task.options.cwd : '';
        if (label && cwd && /\bnpm\s+(?:install|ci)\b/i.test(command)) {
            installTasksByCwd.set(cwd, [...(installTasksByCwd.get(cwd) ?? []), label]);
        }
    }

    for (const [index, task] of tasks.entries()) {
        const command = typeof task.command === 'string' ? task.command : '';
        const cwd = typeof task.options?.cwd === 'string' ? task.options.cwd : '';
        if (!cwd || !/\bnpm\s+run\s+(?:dev|start|watch)\b/i.test(command) || /\bnpm\s+(?:install|ci)\b/i.test(command)) {
            continue;
        }
        const installTasks = installTasksByCwd.get(cwd) ?? [];
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

function result(issues: ArtifactValidationIssue[]): ArtifactValidationResult {
    return { valid: issues.length === 0, issues };
}

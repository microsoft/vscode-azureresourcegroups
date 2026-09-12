/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Structural contract for the VS Code debug configuration the generation phase emits.
 *
 * This validator never launches anything — it answers the question a user hits on the
 * first F5: does `launch.json` reference tasks that exist, do the `dependsOn` chains
 * terminate, and can the compound start every service exactly once? Those are the
 * defects that make a generated setup unusable, and they are all visible statically.
 *
 * Rules come from `resources/agents/azure-debug-generate/references/multi-service.md`
 * and `validation.md`.
 */

import { parse, printParseErrorCode } from 'jsonc-parser';
import type { ParseError } from 'jsonc-parser';
import type { ArtifactValidationIssue, ArtifactValidationResult } from './validationTypes.ts';
import { createValidationResult } from './validationTypes.ts';

export interface LaunchConfiguration {
    name?: unknown;
    preLaunchTask?: unknown;
    type?: unknown;
}

export interface CompoundConfiguration {
    name?: unknown;
    configurations?: unknown;
    preLaunchTask?: unknown;
}

export interface TaskDefinition {
    label?: unknown;
    dependsOn?: unknown;
    dependsOrder?: unknown;
    isBackground?: unknown;
    problemMatcher?: unknown;
    runOptions?: { instancePolicy?: unknown; instanceLimit?: unknown };
}

export interface LaunchDocument {
    configurations: LaunchConfiguration[];
    compounds: CompoundConfiguration[];
}

export interface TasksDocument {
    tasks: TaskDefinition[];
}

/**
 * Parse JSONC — `launch.json` and `tasks.json` are commented by design, and the
 * generation phase leans on that to explain each configuration.
 *
 * Uses the same `jsonc-parser` the extension itself ships with, so a file the
 * grader accepts is a file the product can read.
 */
export function parseJsonc(text: string): unknown {
    const errors: ParseError[] = [];
    const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0) {
        const [first] = errors;
        throw new SyntaxError(`${printParseErrorCode(first.error)} at offset ${first.offset}`);
    }
    return value;
}

export function readLaunchDocument(text: string): LaunchDocument {
    const parsed = parseJsonc(text) as { configurations?: unknown; compounds?: unknown } | null;
    return {
        configurations: Array.isArray(parsed?.configurations) ? parsed.configurations as LaunchConfiguration[] : [],
        compounds: Array.isArray(parsed?.compounds) ? parsed.compounds as CompoundConfiguration[] : [],
    };
}

export function readTasksDocument(text: string): TasksDocument {
    const parsed = parseJsonc(text) as { tasks?: unknown } | null;
    return { tasks: Array.isArray(parsed?.tasks) ? parsed.tasks as TaskDefinition[] : [] };
}

/**
 * Validate `launch.json` against `tasks.json`.
 *
 * `tasksText` may be undefined — a workspace whose configs declare no `preLaunchTask`
 * legitimately has no tasks file, but one that references tasks must have it.
 */
export function validateDebugLaunchConfiguration(
    launchText: string,
    tasksText: string | undefined,
): ArtifactValidationResult {
    const issues: ArtifactValidationIssue[] = [];

    let launch: LaunchDocument;
    try {
        launch = readLaunchDocument(launchText);
    } catch (error) {
        return createValidationResult([issue('launchJsonUnparseable', '$.launch', describeError(error))]);
    }

    let tasks: TasksDocument = { tasks: [] };
    if (tasksText !== undefined) {
        try {
            tasks = readTasksDocument(tasksText);
        } catch (error) {
            return createValidationResult([issue('tasksJsonUnparseable', '$.tasks', describeError(error))]);
        }
    }

    if (launch.configurations.length === 0) {
        issues.push(issue('noLaunchConfigurations', '$.launch', 'launch.json declares no configurations.'));
    }

    const taskByLabel = new Map<string, TaskDefinition>();
    for (const task of tasks.tasks) {
        if (typeof task.label !== 'string' || !task.label.trim()) {
            issues.push(issue('unlabeledTask', '$.tasks', 'A task has no label.'));
            continue;
        }
        if (taskByLabel.has(task.label)) {
            // VS Code resolves a `dependsOn` by label, so a duplicate makes the
            // startup graph ambiguous.
            issues.push(issue('duplicateTaskLabels', '$.tasks', `Task label "${task.label}" is declared more than once.`));
        }
        taskByLabel.set(task.label, task);

        // Re-running F5, or a compound whose members share a chain, invokes the same
        // task again. Without a silent single-instance policy VS Code either prompts
        // the user or starts the service a second time.
        if (task.runOptions?.instanceLimit !== 1 || task.runOptions?.instancePolicy !== 'silent') {
            issues.push(issue(
                'invalidTaskRunOptions',
                '$.tasks',
                `Task "${task.label}" must set runOptions.instanceLimit to 1 and runOptions.instancePolicy to "silent" so a repeated invocation is a no-op.`,
            ));
        }
        // A background task with an empty problem matcher never signals "ready", so
        // the debugger attaches before the service is listening.
        if (task.isBackground === true && isEmptyProblemMatcher(task.problemMatcher)) {
            issues.push(issue(
                'missingBackgroundProblemMatcher',
                '$.tasks',
                `Background task "${task.label}" has no problem matcher, so nothing detects when the service is ready.`,
            ));
        }
    }

    const configByName = new Map<string, LaunchConfiguration>();
    for (const config of launch.configurations) {
        if (typeof config.name !== 'string' || !config.name.trim()) {
            issues.push(issue('unnamedLaunchConfig', '$.launch', 'A launch configuration has no name.'));
            continue;
        }
        if (configByName.has(config.name)) {
            issues.push(issue('duplicateLaunchConfig', '$.launch', `Launch configuration "${config.name}" is declared more than once.`));
        }
        configByName.set(config.name, config);
        if (typeof config.type !== 'string' || !config.type.trim()) {
            issues.push(issue('missingDebuggerType', '$.launch', `Launch configuration "${config.name}" has no debugger "type".`));
        }
    }

    // Every referenced task must exist, and the chains it pulls in must terminate.
    for (const [name, config] of configByName) {
        const preLaunchTask = config.preLaunchTask;
        if (preLaunchTask === undefined) {
            continue;
        }
        if (typeof preLaunchTask !== 'string') {
            issues.push(issue('invalidPreLaunchTask', '$.launch', `Launch configuration "${name}" has a non-string preLaunchTask.`));
            continue;
        }
        if (!taskByLabel.has(preLaunchTask)) {
            issues.push(issue('preLaunchTaskUnresolved', '$.launch', `Launch configuration "${name}" references task "${preLaunchTask}", which is not defined in tasks.json.`));
        }
    }

    validateTaskGraph(taskByLabel, issues);
    validateCompounds(launch, configByName, issues);

    return createValidationResult(issues);
}

function validateTaskGraph(taskByLabel: Map<string, TaskDefinition>, issues: ArtifactValidationIssue[]): void {
    for (const [label, task] of taskByLabel) {
        for (const dependency of dependsOnLabels(task)) {
            if (!taskByLabel.has(dependency)) {
                issues.push(issue('dependsOnUnresolved', '$.tasks', `Task "${label}" depends on "${dependency}", which is not defined.`));
            }
        }
    }

    // A cycle makes the chain never terminate, so VS Code would hang on F5.
    const visiting = new Set<string>();
    const settled = new Set<string>();
    const reported = new Set<string>();

    const visit = (label: string, trail: string[]): void => {
        if (settled.has(label)) {
            return;
        }
        if (visiting.has(label)) {
            const cycle = [...trail.slice(trail.indexOf(label)), label].join(' -> ');
            if (!reported.has(cycle)) {
                reported.add(cycle);
                issues.push(issue('dependsOnCycle', '$.tasks', `Task dependency cycle: ${cycle}.`));
            }
            return;
        }
        visiting.add(label);
        for (const dependency of dependsOnLabels(taskByLabel.get(label))) {
            if (taskByLabel.has(dependency)) {
                visit(dependency, [...trail, label]);
            }
        }
        visiting.delete(label);
        settled.add(label);
    };

    for (const label of taskByLabel.keys()) {
        visit(label, []);
    }
}

/**
 * The compound is where a broken startup graph shows up: a member that names a
 * configuration nobody defined simply never starts, leaving the user with a
 * partially-running stack and no error.
 */
function validateCompounds(
    launch: LaunchDocument,
    configByName: Map<string, LaunchConfiguration>,
    issues: ArtifactValidationIssue[],
): void {
    for (const compound of launch.compounds) {
        const name = typeof compound.name === 'string' ? compound.name : '(unnamed)';
        const members = Array.isArray(compound.configurations) ? compound.configurations : [];
        if (members.length === 0) {
            issues.push(issue('emptyCompound', '$.launch', `Compound "${name}" lists no member configurations.`));
            continue;
        }

        for (const member of members) {
            if (typeof member !== 'string') {
                issues.push(issue('compoundMemberUnresolved', '$.launch', `Compound "${name}" has a non-string member.`));
                continue;
            }
            if (!configByName.has(member)) {
                issues.push(issue('compoundMemberUnresolved', '$.launch', `Compound "${name}" references configuration "${member}", which is not defined.`));
            }
        }
    }
}

/** A missing or `[]` problem matcher gives VS Code no ready signal to wait on. */
function isEmptyProblemMatcher(problemMatcher: unknown): boolean {
    if (problemMatcher === undefined || problemMatcher === null) {
        return true;
    }
    return Array.isArray(problemMatcher) && problemMatcher.length === 0;
}

function dependsOnLabels(task: TaskDefinition | undefined): string[] {
    const dependsOn = task?.dependsOn;
    if (typeof dependsOn === 'string') {
        return [dependsOn];
    }
    if (Array.isArray(dependsOn)) {
        return dependsOn.filter((entry): entry is string => typeof entry === 'string');
    }
    return [];
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function issue(code: string, path: string, message: string): ArtifactValidationIssue {
    return { code, path, message };
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { createHmac, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { parse } from 'jsonc-parser';
import {
    findColumnIndex,
    findSection,
    findTable,
    isChecked,
    parseLocalDebugPlanMarkdown,
} from '../../src/webviews/copilotOnRails/views/utils/parseLocalDebugPlanMarkdown';
import {
    AcaCommandRunner,
    createSandboxManifest,
    createWorkspaceArchive,
    readSandboxId,
    readSandboxIds,
    ValidationEcosystem,
} from './SandboxProjectValidator';
import {
    CorEvaluationScenario,
    LocalAcceptanceProbe,
    StorageBlobEventContract,
    StorageEventContract,
    StorageQueueEventContract,
} from './scenario';

const execFileAsync = promisify(execFile);
const maxLogLength = 20_000;
export const debugpyEvaluationPort = 5678;

export interface PlannedDebugConfiguration {
    name: string;
    serviceRoot: string;
    projectType: string;
    runtime: string;
}

interface ProbeConfigurationGroup {
    configuration: PlannedDebugConfiguration;
    probes: LocalAcceptanceProbe[];
}

interface LaunchConfiguration {
    name?: unknown;
    type?: unknown;
    request?: unknown;
    preLaunchTask?: unknown;
    module?: unknown;
    program?: unknown;
    python?: unknown;
    runtimeExecutable?: unknown;
    runtimeArgs?: unknown;
    cwd?: unknown;
    args?: unknown;
    env?: unknown;
    processName?: unknown;
}

interface VsCodeTask {
    type?: unknown;
    label?: unknown;
    command?: unknown;
    script?: unknown;
    args?: unknown;
    dependsOn?: unknown;
    isBackground?: unknown;
    options?: {
        cwd?: unknown;
        env?: unknown;
    };
}

export interface LocalRuntimeCommandResult {
    kind: 'setup' | 'task' | 'probe' | 'debugger' | 'diagnostic' | 'restart' | 'storage-event';
    name: string;
    command: string;
    success: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
}

export interface LocalRuntimeProbeResult {
    name: string;
    target: LocalAcceptanceProbe['target'];
    method?: string;
    url?: string;
    expectedStatus?: number;
    processPattern?: string;
    success: boolean;
    durationMs: number;
    response?: string;
    responseStatus?: number;
    responseHeaders?: string;
    responseBody?: string;
    error?: string;
}

export interface LocalRuntimeBrowserResult {
    name: string;
    url: string;
    success: boolean;
    durationMs: number;
    title?: string;
    bodyTextLength?: number;
    interactiveElements?: number;
    seriousAccessibilityViolations?: string[];
    accessibilityScanned?: boolean;
    accessibilityScanError?: string;
    consoleErrors?: string[];
    actionsCompleted?: number;
    actionsExpected?: number;
    assertionsCompleted?: number;
    assertionsExpected?: number;
    viewport?: { width: number; height: number };
    currentUrl?: string;
    bodyTextExcerpt?: string;
    error?: string;
}

export interface LocalRuntimePersistenceResult {
    name: string;
    restartTargets: Array<'backend' | 'frontend'>;
    processIdsBefore: number[];
    processIdsAfter: number[];
    preservedProcessIds?: number[];
    readinessProbes: LocalRuntimeProbeResult[];
    postRestartBrowser: LocalRuntimeBrowserResult;
    success: boolean;
    durationMs: number;
    error?: string;
}

export interface LocalRuntimeStorageEventResult {
    name: string;
    kind: 'queue' | 'blob';
    inputQueue?: string;
    outputQueue?: string;
    sourceContainer?: string;
    destinationContainer?: string;
    blobName?: string;
    stimulus: unknown;
    expectedMessageIncludes?: unknown;
    observedMessage?: unknown;
    observedContent?: string;
    sourceDeleted?: boolean;
    pollAttempts?: number;
    success: boolean;
    durationMs: number;
    error?: string;
}

export interface SandboxLocalRuntimeValidationResult {
    outcome: 'passed' | 'failed';
    failureCode?:
        | 'acceptanceSpecMissing'
        | 'acceptanceTargetMissing'
        | 'debugTaskGraphInvalid'
        | 'localRuntimeUnsupported'
        | 'localSandboxCreateFailed'
        | 'localSandboxSetupFailed'
        | 'localToolchainUnavailable'
        | 'localTaskFailed'
        | 'localProbeFailed'
        | 'localBrowserFailed'
        | 'localPersistenceFailed'
        | 'localStorageEventFailed'
        | 'localDebuggerUnavailable'
        | 'localSandboxCleanupFailed';
    error?: string;
    commands: LocalRuntimeCommandResult[];
    probes: LocalRuntimeProbeResult[];
    browserChecks?: LocalRuntimeBrowserResult[];
    persistenceChecks?: LocalRuntimePersistenceResult[];
    workerEvents?: LocalRuntimeStorageEventResult[];
}

interface LaunchedProcess {
    pid: number;
    label: string;
    target: LocalAcceptanceProbe['target'];
    task: VsCodeTask;
    serviceRoot: string;
    restartable: boolean;
}

export function isLocalRuntimeInfrastructureFailureCode(code: string | undefined): boolean {
    return [
        'localSandboxCreateFailed',
        'localSandboxSetupFailed',
        'localToolchainUnavailable',
        'localSandboxCleanupFailed',
    ].includes(code ?? '');
}

export class SandboxLocalRuntimeValidator {
    public constructor(
        private readonly repoRoot: string,
        private readonly aca: AcaCommandRunner = new DefaultAcaCommandRunner(),
    ) {
    }

    public async validate(
        workspace: string,
        scenario: CorEvaluationScenario,
        planContent: string,
    ): Promise<SandboxLocalRuntimeValidationResult> {
        const contract = scenario.acceptance?.local;
        if (!contract?.probes.length) {
            return {
                outcome: 'failed',
                failureCode: 'acceptanceSpecMissing',
                error: `Scenario "${scenario.id}" has no evaluator-owned local acceptance probes.`,
                commands: [],
                probes: [],
                browserChecks: [],
                persistenceChecks: [],
                workerEvents: [],
            };
        }

        const configurations = parsePlannedConfigurations(planContent);
        const groups = groupProbesByConfiguration(contract.probes, configurations);
        if ('error' in groups) {
            return {
                outcome: 'failed',
                failureCode: 'acceptanceTargetMissing',
                error: groups.error,
                commands: [],
                probes: [],
                browserChecks: [],
                persistenceChecks: [],
                workerEvents: [],
            };
        }
        const archivePath = path.join(os.tmpdir(), `cor-local-${randomUUID()}.tar.gz`);
        const commands: LocalRuntimeCommandResult[] = [];
        const probes: LocalRuntimeProbeResult[] = [];
        const browserChecks: LocalRuntimeBrowserResult[] = [];
        const persistenceChecks: LocalRuntimePersistenceResult[] = [];
        const workerEvents: LocalRuntimeStorageEventResult[] = [];
        try {
            await createWorkspaceArchive(workspace, archivePath);
            if (contract.compound) {
                const result = await this.validateCompoundConfigurations(
                    workspace,
                    archivePath,
                    [...groups.values()],
                    contract.startupTimeoutSeconds ?? 90,
                    commands,
                    probes,
                    browserChecks,
                    persistenceChecks,
                    workerEvents,
                    contract.storageEvents ?? [],
                );
                return result ?? { outcome: 'passed', commands, probes, browserChecks, persistenceChecks, workerEvents };
            }
            for (const group of groups.values()) {
                const result = await this.validateConfiguration(
                    workspace,
                    archivePath,
                    group.configuration,
                    group.probes,
                    contract.startupTimeoutSeconds ?? 90,
                    commands,
                    probes,
                    browserChecks,
                    persistenceChecks,
                    workerEvents,
                    group.probes.some(probe => probe.target === 'worker') ? (contract.storageEvents ?? []) : [],
                );
                if (result) {
                    return result;
                }
            }
            return { outcome: 'passed', commands, probes, browserChecks, persistenceChecks, workerEvents };
        } finally {
            await fs.rm(archivePath, { force: true });
        }
    }

    private async validateCompoundConfigurations(
                    workspace: string,
                    archivePath: string,
                    groups: ProbeConfigurationGroup[],
                    startupTimeoutSeconds: number,
                    commands: LocalRuntimeCommandResult[],
                    probes: LocalRuntimeProbeResult[],
                    browserChecks: LocalRuntimeBrowserResult[],
                    persistenceChecks: LocalRuntimePersistenceResult[],
                    workerEvents: LocalRuntimeStorageEventResult[],
                    storageEvents: StorageEventContract[],
                ): Promise<SandboxLocalRuntimeValidationResult | undefined> {
                    const ecosystems = new Set(groups.map(group => runtimeToEcosystem(group.configuration.runtime)));
                    if (ecosystems.has(undefined) || ecosystems.size !== 1) {
                        return failure(
                            'localRuntimeUnsupported',
                            'Compound local acceptance currently requires every service to use one supported runtime ecosystem.',
                            commands,
                            probes,
                        );
                    }
                    const ecosystem = [...ecosystems][0] as ValidationEcosystem;
                    const debugArtifacts = await readDebugArtifacts(workspace);
                    if ('error' in debugArtifacts) {
                        return failure('debugTaskGraphInvalid', debugArtifacts.error, commands, probes);
                    }
                    const prepared: Array<{
                        group: ProbeConfigurationGroup;
                        launch: LaunchConfiguration;
                        tasks: VsCodeTask[];
                        processLogName: string;
                    }> = [];
                    for (const group of groups) {
                        const launch = debugArtifacts.launchConfigurations.find(value => value.name === group.configuration.name);
                        if (!launch) {
                            return failure('debugTaskGraphInvalid', `Launch configuration "${group.configuration.name}" does not exist.`, commands, probes);
                        }
                        const taskChain = typeof launch.preLaunchTask === 'string'
                            ? resolveTaskChain(launch.preLaunchTask, debugArtifacts.tasks)
                            : { tasks: [] };
                        if ('error' in taskChain) {
                            return failure('debugTaskGraphInvalid', taskChain.error, commands, probes);
                        }
                        prepared.push({
                            group,
                            launch,
                            tasks: taskChain.tasks,
                            processLogName: typeof launch.preLaunchTask === 'string'
                                ? launch.preLaunchTask
                                : String(launch.name),
                        });
                    }

                    const created = await this.createSandbox(ecosystem);
                    if ('error' in created) {
                        return failure('localSandboxCreateFailed', created.error, commands, probes);
                    }
                    const sandboxId = created.sandboxId;
                    const launchedProcesses: LaunchedProcess[] = [];
                    let validationFailure: SandboxLocalRuntimeValidationResult | undefined;
                    let cleanupError: string | undefined;
                    try {
                        validationFailure = await this.setupWorkspace(sandboxId, archivePath, ecosystem, commands);
                        if (!validationFailure && prepared.some(item => item.tasks.some(task => task.type === 'func'))) {
                            validationFailure = await this.ensureFunctionsCoreTools(sandboxId, ecosystem, commands);
                        }
                        const startedTasks = new Set<string>();
                        for (const item of prepared) {
                            if (validationFailure) {
                                break;
                            }
                            for (const task of item.tasks) {
                                const label = typeof task.label === 'string' ? task.label : 'unnamed task';
                                if (startedTasks.has(label)) {
                                    continue;
                                }
                                startedTasks.add(label);
                                const taskResult = await this.runTask(
                                    sandboxId,
                                    task,
                                    item.group.configuration.serviceRoot,
                                    launchedProcesses,
                                    {
                                        target: item.group.probes[0].target,
                                        restartable: label === item.launch.preLaunchTask
                                            && ['backend', 'frontend'].includes(item.group.probes[0].target),
                                    },
                                );
                                commands.push(taskResult);
                                if (!taskResult.success) {
                                    validationFailure = failure('localTaskFailed', `Debug task "${label}" failed.`, commands, probes);
                                    break;
                                }
                            }
                            if (validationFailure) {
                                break;
                            }
                            const launchTask = resolveLaunchTask(item.launch, item.group.configuration.serviceRoot);
                            if (launchTask && 'error' in launchTask) {
                                validationFailure = failure('localRuntimeUnsupported', launchTask.error, commands, probes);
                            } else if (launchTask) {
                                const launchResult = await this.runTask(
                                    sandboxId,
                                    launchTask,
                                    item.group.configuration.serviceRoot,
                                    launchedProcesses,
                                    {
                                        target: item.group.probes[0].target,
                                        restartable: ['backend', 'frontend'].includes(item.group.probes[0].target),
                                    },
                                );
                                commands.push(launchResult);
                                item.processLogName = String(launchTask.label);
                                if (!launchResult.success) {
                                    validationFailure = failure('localTaskFailed', `Debug launch configuration "${item.group.configuration.name}" failed.`, commands, probes);
                                }
                            }
                        }
                        for (const item of prepared) {
                            if (validationFailure) {
                                break;
                            }
                            for (const probe of item.group.probes) {
                                const probeResult = await this.runProbe(
                                    sandboxId,
                                    probe,
                                    startupTimeoutSeconds,
                                    String(item.launch.preLaunchTask),
                                );
                                probes.push(probeResult.probe);
                                commands.push(probeResult.command);
                                if (!probeResult.probe.success) {
                                    commands.push(await this.readProcessLogs(sandboxId, item.processLogName));
                                    validationFailure = failure(
                                        'localProbeFailed',
                                        `Local acceptance probe "${probe.name}" failed. ${probeResult.probe.error ?? ''}`.trim(),
                                        commands,
                                        probes,
                                    );
                                    break;
                                }
                                if (probe.browser) {
                                    const browserResult = await this.runBrowserProbe(sandboxId, probe);
                                    browserChecks.push(browserResult.browser);
                                    commands.push(browserResult.command);
                                    if (!browserResult.browser.success) {
                                        validationFailure = failure(
                                            'localBrowserFailed',
                                            `Browser acceptance probe "${probe.name}" failed. ${browserResult.browser.error ?? ''}`.trim(),
                                            commands,
                                            probes,
                                            browserChecks,
                                        );
                                        break;
                                    }
                                }
                            }
                        }
                        for (const storageEvent of storageEvents) {
                            if (validationFailure) {
                                break;
                            }
                            const eventResult = await this.runStorageEvent(sandboxId, storageEvent);
                            commands.push(eventResult.command);
                            workerEvents.push(eventResult.event);
                            if (!eventResult.event.success) {
                                validationFailure = failure(
                                    'localStorageEventFailed',
                                    `Storage event "${storageEvent.name}" failed. ${eventResult.event.error ?? ''}`.trim(),
                                    commands,
                                    probes,
                                    browserChecks,
                                    persistenceChecks,
                                    workerEvents,
                                );
                            }
                        }
                        for (const item of prepared) {
                            if (validationFailure) {
                                break;
                            }
                            for (const probe of item.group.probes.filter(value => value.browser?.persistence)) {
                                const persistenceResult = await this.runPersistenceCheck(
                                    sandboxId,
                                    probe,
                                    groups.flatMap(group => group.probes),
                                    launchedProcesses,
                                    startupTimeoutSeconds,
                                    commands,
                                    [...browserChecks].reverse().find(check => check.name === probe.name),
                                );
                                persistenceChecks.push(persistenceResult);
                                if (!persistenceResult.success) {
                                    validationFailure = failure(
                                        'localPersistenceFailed',
                                        `Persistence acceptance "${probe.name}" failed. ${persistenceResult.error ?? ''}`.trim(),
                                        commands,
                                        probes,
                                        browserChecks,
                                        persistenceChecks,
                                        workerEvents,
                                    );
                                    break;
                                }
                            }
                        }
                        for (const item of prepared) {
                            if (validationFailure) {
                                break;
                            }
                            const debuggerCheck = resolveDebuggerPrerequisite(item.launch);
                            if ('error' in debuggerCheck) {
                                validationFailure = failure(
                                    'debugTaskGraphInvalid',
                                    debuggerCheck.error,
                                    commands,
                                    probes,
                                    browserChecks,
                                    persistenceChecks,
                                    workerEvents,
                                );
                            } else if (debuggerCheck.command) {
                                const debuggerResult = await this.runCommand(
                                    sandboxId,
                                    'debugger',
                                    debuggerCheck.name,
                                    debuggerCheck.command,
                                    '/workspace',
                                    30 * 1000,
                                );
                                commands.push(debuggerResult);
                                if (!debuggerResult.success) {
                                    validationFailure = failure(
                                        'localDebuggerUnavailable',
                                        debuggerCheck.errorMessage,
                                        commands,
                                        probes,
                                        browserChecks,
                                        persistenceChecks,
                                        workerEvents,
                                    );
                                }
                            }
                        }
                    } finally {
                        try {
                            await this.aca.run(['sandbox', 'delete', '--id', sandboxId, '--yes'], 5 * 60 * 1000);
                        } catch (error) {
                            cleanupError = getErrorMessage(error);
                        }
                    }
                    if (cleanupError) {
                        return failure(
                            'localSandboxCleanupFailed',
                            cleanupError,
                            commands,
                            probes,
                            browserChecks,
                            persistenceChecks,
                            workerEvents,
                        );
                    }
                    return validationFailure;
    }

    private async validateConfiguration(
        workspace: string,
        archivePath: string,
        configuration: PlannedDebugConfiguration,
        acceptanceProbes: LocalAcceptanceProbe[],
        startupTimeoutSeconds: number,
        commands: LocalRuntimeCommandResult[],
        probes: LocalRuntimeProbeResult[],
        browserChecks: LocalRuntimeBrowserResult[],
        persistenceChecks: LocalRuntimePersistenceResult[],
        workerEvents: LocalRuntimeStorageEventResult[],
        storageEvents: StorageEventContract[],
    ): Promise<SandboxLocalRuntimeValidationResult | undefined> {
        const ecosystem = runtimeToEcosystem(configuration.runtime);
        if (!ecosystem) {
            return failure(
                'localRuntimeUnsupported',
                `Runtime "${configuration.runtime}" is not supported by the isolated local-runtime validator.`,
                commands,
                probes,
            );
        }
        const debugArtifacts = await readDebugArtifacts(workspace);
        if ('error' in debugArtifacts) {
            return failure('debugTaskGraphInvalid', debugArtifacts.error, commands, probes);
        }
        const launchConfiguration = debugArtifacts.launchConfigurations
            .find(value => value.name === configuration.name);
        if (!launchConfiguration) {
            return failure(
                'debugTaskGraphInvalid',
                `Launch configuration "${configuration.name}" does not exist.`,
                commands,
                probes,
            );
        }
        const taskChain = typeof launchConfiguration.preLaunchTask === 'string'
            ? resolveTaskChain(launchConfiguration.preLaunchTask, debugArtifacts.tasks)
            : { tasks: [] };
        if ('error' in taskChain) {
            return failure('debugTaskGraphInvalid', taskChain.error, commands, probes);
        }

        const created = await this.createSandbox(ecosystem);
        if ('error' in created) {
            return failure('localSandboxCreateFailed', created.error, commands, probes);
        }
        const sandboxId = created.sandboxId;
        const launchedProcesses: LaunchedProcess[] = [];
        let validationFailure: SandboxLocalRuntimeValidationResult | undefined;
        let cleanupError: string | undefined;
        let processLogName = typeof launchConfiguration.preLaunchTask === 'string'
            ? launchConfiguration.preLaunchTask
            : String(launchConfiguration.name);
        try {
            validationFailure = await this.setupWorkspace(sandboxId, archivePath, ecosystem, commands);
            if (!validationFailure && taskChain.tasks.some(task => task.type === 'func')) {
                validationFailure = await this.ensureFunctionsCoreTools(sandboxId, ecosystem, commands);
            }
            if (!validationFailure) {
                for (const task of taskChain.tasks) {
                    const target = acceptanceProbes[0].target;
                    const taskResult = await this.runTask(
                        sandboxId,
                        task,
                        configuration.serviceRoot,
                        launchedProcesses,
                        {
                            target,
                            restartable: task.label === launchConfiguration.preLaunchTask
                                && ['backend', 'frontend'].includes(target),
                        },
                    );
                    commands.push(taskResult);
                    if (!taskResult.success) {
                        const unavailable = /(?:command not found|not recognized|no such file or directory)/i.test(
                            `${taskResult.stdout}\n${taskResult.stderr}`,
                        );
                        validationFailure = failure(
                            unavailable ? 'localToolchainUnavailable' : 'localTaskFailed',
                            `Debug task "${String(task.label)}" failed.`,
                            commands,
                            probes,
                        );
                        break;
                    }
                }
            }
            if (!validationFailure) {
                const launchTask = resolveLaunchTask(launchConfiguration, configuration.serviceRoot);
                if (launchTask && 'error' in launchTask) {
                    validationFailure = failure('localRuntimeUnsupported', launchTask.error, commands, probes);
                } else if (launchTask) {
                    const target = acceptanceProbes[0].target;
                    const launchResult = await this.runTask(
                        sandboxId,
                        launchTask,
                        configuration.serviceRoot,
                        launchedProcesses,
                        { target, restartable: ['backend', 'frontend'].includes(target) },
                    );
                    commands.push(launchResult);
                    processLogName = String(launchTask.label);
                    if (!launchResult.success) {
                        validationFailure = failure(
                            'localTaskFailed',
                            `Debug launch configuration "${configuration.name}" failed.`,
                            commands,
                            probes,
                        );
                    }
                }
            }
            if (!validationFailure) {
                for (const probe of acceptanceProbes) {
                    const probeResult = await this.runProbe(
                        sandboxId,
                        probe,
                        startupTimeoutSeconds,
                        processLogName,
                    );
                    probes.push(probeResult.probe);
                    commands.push(probeResult.command);
                    if (!probeResult.probe.success) {
                        const logs = await this.readProcessLogs(sandboxId, processLogName);
                        commands.push(logs);
                        validationFailure = failure(
                            'localProbeFailed',
                            `Local acceptance probe "${probe.name}" failed. ${probeResult.probe.error ?? ''}`.trim(),
                            commands,
                            probes,
                        );
                        break;
                    }
                    if (probe.browser) {
                        const browserResult = await this.runBrowserProbe(sandboxId, probe);
                        browserChecks.push(browserResult.browser);
                        commands.push(browserResult.command);
                        if (!browserResult.browser.success) {
                            validationFailure = failure(
                                'localBrowserFailed',
                                `Browser acceptance probe "${probe.name}" failed. ${browserResult.browser.error ?? ''}`.trim(),
                                commands,
                                probes,
                                browserChecks,
                            );
                            break;
                        }
                    }
                }
            }
            if (!validationFailure) {
                for (const storageEvent of storageEvents) {
                    const eventResult = await this.runStorageEvent(sandboxId, storageEvent);
                    commands.push(eventResult.command);
                    workerEvents.push(eventResult.event);
                    if (!eventResult.event.success) {
                        validationFailure = failure(
                            'localStorageEventFailed',
                            `Storage event "${storageEvent.name}" failed. ${eventResult.event.error ?? ''}`.trim(),
                            commands,
                            probes,
                            browserChecks,
                            persistenceChecks,
                            workerEvents,
                        );
                        break;
                    }
                }
            }
            if (!validationFailure) {
                for (const probe of acceptanceProbes.filter(value => value.browser?.persistence)) {
                    const persistenceResult = await this.runPersistenceCheck(
                        sandboxId,
                        probe,
                        acceptanceProbes,
                        launchedProcesses,
                        startupTimeoutSeconds,
                        commands,
                        [...browserChecks].reverse().find(check => check.name === probe.name),
                    );
                    persistenceChecks.push(persistenceResult);
                    if (!persistenceResult.success) {
                        validationFailure = failure(
                            'localPersistenceFailed',
                            `Persistence acceptance "${probe.name}" failed. ${persistenceResult.error ?? ''}`.trim(),
                            commands,
                            probes,
                            browserChecks,
                            persistenceChecks,
                            workerEvents,
                        );
                        break;
                    }
                }
            }
            if (!validationFailure) {
                const debuggerCheck = resolveDebuggerPrerequisite(launchConfiguration);
                if ('error' in debuggerCheck) {
                    validationFailure = failure(
                        'debugTaskGraphInvalid',
                        debuggerCheck.error,
                        commands,
                        probes,
                        browserChecks,
                        persistenceChecks,
                        workerEvents,
                    );
                } else if (debuggerCheck.command) {
                    const debuggerResult = await this.runCommand(
                        sandboxId,
                        'debugger',
                        debuggerCheck.name,
                        debuggerCheck.command,
                        '/workspace',
                        30 * 1000,
                    );
                    commands.push(debuggerResult);
                    if (!debuggerResult.success) {
                        validationFailure = failure(
                            'localDebuggerUnavailable',
                            debuggerCheck.errorMessage,
                            commands,
                            probes,
                            browserChecks,
                            persistenceChecks,
                            workerEvents,
                        );
                    }
                }
            }
        } finally {
            try {
                await this.aca.run(['sandbox', 'delete', '--id', sandboxId, '--yes'], 5 * 60 * 1000);
            } catch (error) {
                cleanupError = getErrorMessage(error);
            }
        }
        if (cleanupError) {
            return failure(
                'localSandboxCleanupFailed',
                cleanupError,
                commands,
                probes,
                browserChecks,
                persistenceChecks,
                workerEvents,
            );
        }
        return validationFailure;
    }

    private async createSandbox(
        ecosystem: ValidationEcosystem,
    ): Promise<{ sandboxId: string } | { error: string }> {
        const runLabel = randomUUID();
        const manifestPath = path.join(os.tmpdir(), `cor-local-${runLabel}-${ecosystem}.yaml`);
        try {
            await createSandboxManifest(this.getManifestPath(ecosystem), manifestPath, runLabel);
            await this.aca.run(['sandbox', 'validate', '--file', manifestPath], 60 * 1000);
            const created = await this.aca.run([
                'sandbox', 'apply',
                '--file', manifestPath,
                '--wait-timeout', '300',
                '-o', 'json',
            ], 6 * 60 * 1000);
            return { sandboxId: readSandboxId(created.stdout) };
        } catch (error) {
            const cleanupError = await this.cleanupAfterCreateFailure(error, runLabel);
            return { error: [getErrorMessage(error), cleanupError].filter(Boolean).join(' ') };
        } finally {
            await fs.rm(manifestPath, { force: true });
        }
    }

    private async setupWorkspace(
        sandboxId: string,
        archivePath: string,
        ecosystem: ValidationEcosystem,
        commands: LocalRuntimeCommandResult[],
    ): Promise<SandboxLocalRuntimeValidationResult | undefined> {
        const toolchain = `${getToolchainCheckCommand(ecosystem)} && command -v curl && command -v setsid`;
        const toolchainResult = await this.runCommand(
            sandboxId,
            'setup',
            `${ecosystem} toolchain`,
            toolchain,
            '/tmp',
            60 * 1000,
        );
        commands.push(toolchainResult);
        if (!toolchainResult.success) {
            return failure('localToolchainUnavailable', `${ecosystem} local-runtime toolchain is unavailable.`, commands, []);
        }
        try {
            await this.aca.run([
                'sandbox', 'fs', 'write',
                '--id', sandboxId,
                '--path', '/tmp/workspace.tar.gz',
                '--file', archivePath,
            ], 5 * 60 * 1000);
            const extractResult = await this.runCommand(
                sandboxId,
                'setup',
                'extract workspace',
                'mkdir -p /workspace && tar -xzf /tmp/workspace.tar.gz -C /workspace',
                '/tmp',
                5 * 60 * 1000,
            );
            commands.push(extractResult);
            if (!extractResult.success) {
                return failure('localSandboxSetupFailed', 'Could not extract the generated workspace.', commands, []);
            }
        } catch (error) {
            return failure('localSandboxSetupFailed', getErrorMessage(error), commands, []);
        }
        return undefined;
    }

    private async ensureFunctionsCoreTools(
        sandboxId: string,
        ecosystem: ValidationEcosystem,
        commands: LocalRuntimeCommandResult[],
    ): Promise<SandboxLocalRuntimeValidationResult | undefined> {
        const check = await this.runCommand(
            sandboxId,
            'setup',
            'Azure Functions Core Tools',
            'func --version',
            '/workspace',
            30 * 1000,
        );
        commands.push(check);
        if (check.success) {
            return undefined;
        }
        if (ecosystem !== 'node') {
            return failure(
                'localToolchainUnavailable',
                `Azure Functions Core Tools are not available in the ${ecosystem} validation disk.`,
                commands,
                [],
            );
        }
        const install = await this.runCommand(
            sandboxId,
            'setup',
            'install Azure Functions Core Tools',
            'npm install --global azure-functions-core-tools@4 --unsafe-perm true',
            '/workspace',
            5 * 60 * 1000,
        );
        commands.push(install);
        if (!install.success) {
            return failure('localToolchainUnavailable', 'Could not install Azure Functions Core Tools.', commands, []);
        }
        return undefined;
    }

    private async runTask(
        sandboxId: string,
        task: VsCodeTask,
        serviceRoot: string,
        launchedProcesses?: LaunchedProcess[],
        process?: { target: LocalAcceptanceProbe['target']; restartable: boolean },
    ): Promise<LocalRuntimeCommandResult> {
        const label = typeof task.label === 'string' ? task.label : 'unnamed task';
        const resolved = resolveTaskCommand(task, serviceRoot);
        if (!resolved.command) {
            return {
                kind: 'task',
                name: label,
                command: '',
                success: true,
                durationMs: 0,
                stdout: 'Dependency-only task.',
                stderr: '',
            };
        }
        if (task.isBackground === true) {
            const logPath = processLogPath(label);
            const backgroundCommand = `mkdir -p /workspace/.cor-eval || exit 1; nohup setsid sh -lc ${shellQuote(resolved.command)} >${shellQuote(logPath)} 2>&1 & pid=$!; printf '%s\\n' "$pid"`;
            const result = await this.runCommand(
                sandboxId,
                'task',
                label,
                backgroundCommand,
                resolved.cwd,
                60 * 1000,
            );
            if (result.success && launchedProcesses && process) {
                try {
                    launchedProcesses.push({
                        pid: parseLaunchedProcessId(result.stdout),
                        label,
                        target: process.target,
                        task,
                        serviceRoot,
                        restartable: process.restartable,
                    });
                } catch (error) {
                    result.success = false;
                    result.stderr = getErrorMessage(error);
                }
            }
            return result;
        }
        return await this.runCommand(
            sandboxId,
            'task',
            label,
            resolved.command,
            resolved.cwd,
            10 * 60 * 1000,
        );
    }

    private async runProbe(
        sandboxId: string,
        probe: LocalAcceptanceProbe,
        startupTimeoutSeconds: number,
        launchTask: string,
    ): Promise<{ probe: LocalRuntimeProbeResult; command: LocalRuntimeCommandResult }> {
        const started = Date.now();
        if (probe.processPattern && !probe.url) {
            const attempts = Math.max(1, startupTimeoutSeconds);
            const command = [
                `for i in $(seq 1 ${attempts}); do`,
                `if pgrep -f -- ${shellQuote(probe.processPattern)} >/dev/null; then exit 0; fi;`,
                'sleep 1;',
                'done;',
                `printf '%s\\n' ${shellQuote(`Timed out waiting for process pattern ${probe.processPattern}; launch task: ${launchTask}`)} >&2;`,
                'exit 1',
            ].join(' ');
            const commandResult = await this.runCommand(
                sandboxId,
                'probe',
                probe.name,
                command,
                '/workspace',
                (startupTimeoutSeconds + 15) * 1000,
            );
            return {
                command: commandResult,
                probe: {
                    name: probe.name,
                    target: probe.target,
                    processPattern: probe.processPattern,
                    success: commandResult.success,
                    durationMs: Date.now() - started,
                    error: commandResult.success ? undefined : commandResult.stderr,
                },
            };
        }
        if (!probe.url || !probe.method || probe.expectedStatus === undefined) {
            throw new Error(`Probe "${probe.name}" has no complete HTTP or process acceptance contract.`);
        }
        const command = createHttpProbeCommand(probe, startupTimeoutSeconds, launchTask);
        const commandResult = await this.runCommand(
            sandboxId,
            'probe',
            probe.name,
            command,
            '/workspace',
            (startupTimeoutSeconds + 15) * 1000,
        );
        const response = parseHttpProbeEvidence(commandResult.stdout);
        return {
            command: commandResult,
            probe: {
                name: probe.name,
                target: probe.target,
                method: probe.method,
                url: probe.url,
                expectedStatus: probe.expectedStatus,
                success: commandResult.success,
                durationMs: Date.now() - started,
                response: commandResult.stdout || undefined,
                responseStatus: response.status,
                responseHeaders: response.headers,
                responseBody: response.body,
                error: commandResult.success ? undefined : commandResult.stderr,
            },
        };
    }

    private async runBrowserProbe(
        sandboxId: string,
        probe: LocalAcceptanceProbe,
        browserOverride?: NonNullable<LocalAcceptanceProbe['browser']>,
        urlOverride?: string,
        nameOverride?: string,
    ): Promise<{ browser: LocalRuntimeBrowserResult; command: LocalRuntimeCommandResult }> {
        const started = Date.now();
        const browser = browserOverride ?? probe.browser;
        if (!browser) {
            throw new Error('Browser acceptance configuration is required.');
        }
        const url = urlOverride ?? probe.url;
        if (!url) {
            throw new Error('Browser acceptance requires a probe URL.');
        }
        const script = createBrowserProbeScript(url, browser);
        const name = nameOverride ?? probe.name;
        const commandResult = await this.runCommand(
            sandboxId,
            'probe',
            `${name} browser`,
            `node -e ${shellQuote(script)}`,
            '/workspace',
            2 * 60 * 1000,
        );
        let evidence: Partial<LocalRuntimeBrowserResult> = {};
        if (commandResult.stdout.trim()) {
            try {
                evidence = JSON.parse(commandResult.stdout.trim()) as Partial<LocalRuntimeBrowserResult>;
            } catch (error) {
                if (commandResult.success) {
                    commandResult.success = false;
                    commandResult.stderr = `Browser evidence was not valid JSON: ${getErrorMessage(error)}`;
                }
            }
        }
        return {
            command: commandResult,
            browser: {
                name,
                url,
                success: commandResult.success,
                durationMs: Date.now() - started,
                ...evidence,
                error: commandResult.success ? undefined : commandResult.stderr,
            },
        };
    }

    private async runPersistenceCheck(
        sandboxId: string,
        probe: LocalAcceptanceProbe,
        acceptanceProbes: LocalAcceptanceProbe[],
        launchedProcesses: LaunchedProcess[],
        startupTimeoutSeconds: number,
        commands: LocalRuntimeCommandResult[],
        initialBrowser: LocalRuntimeBrowserResult | undefined,
    ): Promise<LocalRuntimePersistenceResult> {
        const started = Date.now();
        const contract = probe.browser?.persistence;
        if (!contract) {
            throw new Error('Persistence acceptance configuration is required.');
        }
        const selected = launchedProcesses.filter(process =>
            process.restartable && contract.restartTargets.includes(process.target as 'backend' | 'frontend'));
        const preserved = launchedProcesses.filter(process => !selected.includes(process));
        const missingTarget = contract.restartTargets.find(target =>
            !selected.some(process => process.target === target));
        const emptyBrowser: LocalRuntimeBrowserResult = {
            name: `${probe.name} after restart`,
            url: probe.url ?? '',
            success: false,
            durationMs: 0,
            error: missingTarget ? `No evaluator-launched process was recorded for ${missingTarget}.` : undefined,
        };
        if (missingTarget) {
            return {
                name: probe.name,
                restartTargets: contract.restartTargets,
                processIdsBefore: selected.map(process => process.pid),
                processIdsAfter: [],
                preservedProcessIds: preserved.map(process => process.pid),
                readinessProbes: [],
                postRestartBrowser: emptyBrowser,
                success: false,
                durationMs: Date.now() - started,
                error: emptyBrowser.error,
            };
        }

        const processIdsBefore = selected.map(process => process.pid);
        for (const process of selected) {
            const termination = await this.runCommand(
                sandboxId,
                'restart',
                `stop ${process.label}`,
                createProcessGroupTerminationCommand(process.pid),
                '/workspace',
                30 * 1000,
            );
            commands.push(termination);
            if (!termination.success) {
                return {
                    name: probe.name,
                    restartTargets: contract.restartTargets,
                    processIdsBefore,
                    processIdsAfter: [],
                    readinessProbes: [],
                    postRestartBrowser: emptyBrowser,
                    success: false,
                    durationMs: Date.now() - started,
                    error: `Could not stop evaluator-launched process group ${process.pid}: ${termination.stderr}`,
                };
            }
        }
        for (const process of preserved) {
            const liveness = await this.runCommand(
                sandboxId,
                'restart',
                `verify preserved ${process.label}`,
                `/bin/kill -0 -- -${process.pid}`,
                '/workspace',
                10 * 1000,
            );
            commands.push(liveness);
            if (!liveness.success) {
                return {
                    name: probe.name,
                    restartTargets: contract.restartTargets,
                    processIdsBefore,
                    processIdsAfter: [],
                    preservedProcessIds: preserved.map(value => value.pid),
                    readinessProbes: [],
                    postRestartBrowser: emptyBrowser,
                    success: false,
                    durationMs: Date.now() - started,
                    error: `Evaluator-launched dependency process group ${process.pid} did not survive the application restart.`,
                };
            }
        }
        for (const process of selected) {
            const index = launchedProcesses.indexOf(process);
            if (index >= 0) {
                launchedProcesses.splice(index, 1);
            }
        }

        const restarted: LaunchedProcess[] = [];
        for (const process of selected) {
            const restart = await this.runTask(
                sandboxId,
                process.task,
                process.serviceRoot,
                restarted,
                { target: process.target, restartable: true },
            );
            restart.kind = 'restart';
            restart.name = `restart ${process.label}`;
            commands.push(restart);
            if (!restart.success) {
                return {
                    name: probe.name,
                    restartTargets: contract.restartTargets,
                    processIdsBefore,
                    processIdsAfter: restarted.map(value => value.pid),
                    preservedProcessIds: preserved.map(value => value.pid),
                    readinessProbes: [],
                    postRestartBrowser: emptyBrowser,
                    success: false,
                    durationMs: Date.now() - started,
                    error: `Could not restart "${process.label}": ${restart.stderr}`,
                };
            }
        }
        launchedProcesses.push(...restarted);

        const readinessProbes: LocalRuntimeProbeResult[] = [];
        for (const readinessProbe of acceptanceProbes.filter(value =>
            contract.restartTargets.includes(value.target as 'backend' | 'frontend'))) {
            const result = await this.runProbe(
                sandboxId,
                readinessProbe,
                startupTimeoutSeconds,
                'post-restart readiness',
            );
            result.command.kind = 'restart';
            commands.push(result.command);
            readinessProbes.push(result.probe);
            if (!result.probe.success) {
                return {
                    name: probe.name,
                    restartTargets: contract.restartTargets,
                    processIdsBefore,
                    processIdsAfter: restarted.map(value => value.pid),
                    preservedProcessIds: preserved.map(value => value.pid),
                    readinessProbes,
                    postRestartBrowser: emptyBrowser,
                    success: false,
                    durationMs: Date.now() - started,
                    error: `Post-restart readiness probe "${readinessProbe.name}" failed.`,
                };
            }
        }

        const reloadUrl = contract.reload === 'current-url' ? initialBrowser?.currentUrl : contract.reload;
        if (!reloadUrl) {
            return {
                name: probe.name,
                restartTargets: contract.restartTargets,
                processIdsBefore,
                processIdsAfter: restarted.map(value => value.pid),
                preservedProcessIds: preserved.map(value => value.pid),
                readinessProbes,
                postRestartBrowser: emptyBrowser,
                success: false,
                durationMs: Date.now() - started,
                error: 'The initial browser journey did not record a current URL for persistence reload.',
            };
        }
        const postRestart = await this.runBrowserProbe(
            sandboxId,
            probe,
            {
                ...probe.browser,
                actions: [],
                assertions: contract.assertions,
                persistence: undefined,
            },
            reloadUrl,
            `${probe.name} after restart`,
        );
        postRestart.command.kind = 'restart';
        commands.push(postRestart.command);
        return {
            name: probe.name,
            restartTargets: contract.restartTargets,
            processIdsBefore,
            processIdsAfter: restarted.map(value => value.pid),
            preservedProcessIds: preserved.map(value => value.pid),
            readinessProbes,
            postRestartBrowser: postRestart.browser,
            success: postRestart.browser.success,
            durationMs: Date.now() - started,
            error: postRestart.browser.error,
        };
    }

    private async runStorageEvent(
        sandboxId: string,
        contract: StorageEventContract,
    ): Promise<{ event: LocalRuntimeStorageEventResult; command: LocalRuntimeCommandResult }> {
        const started = Date.now();
        const script = contract.kind === 'queue'
            ? createQueueStorageEventScript(contract)
            : createBlobStorageEventScript(contract);
        const commandResult = await this.runCommand(
            sandboxId,
            'storage-event',
            contract.name,
            `node -e ${shellQuote(script)}`,
            '/workspace',
            ((contract.timeoutSeconds ?? 90) + 15) * 1000,
        );
        let evidence: {
            observedMessage?: unknown;
            observedContent?: string;
            sourceDeleted?: boolean;
            pollAttempts?: number;
            error?: string;
        } = {};
        if (commandResult.stdout.trim()) {
            try {
                evidence = JSON.parse(commandResult.stdout.trim()) as typeof evidence;
            } catch (error) {
                commandResult.success = false;
                commandResult.stderr = `Storage event evidence was not valid JSON: ${getErrorMessage(error)}`;
            }
        }
        return {
            command: commandResult,
            event: {
                name: contract.name,
                kind: contract.kind,
                inputQueue: contract.kind === 'queue' ? contract.inputQueue : undefined,
                outputQueue: contract.kind === 'queue' ? contract.outputQueue : undefined,
                sourceContainer: contract.kind === 'blob' ? contract.sourceContainer : undefined,
                destinationContainer: contract.kind === 'blob' ? contract.destinationContainer : undefined,
                blobName: contract.kind === 'blob' ? contract.blobName : undefined,
                stimulus: contract.kind === 'queue'
                    ? contract.message
                    : { content: contract.content, metadata: contract.metadata },
                expectedMessageIncludes: contract.kind === 'queue' ? contract.expectedMessageIncludes : undefined,
                observedMessage: evidence.observedMessage,
                observedContent: evidence.observedContent,
                sourceDeleted: evidence.sourceDeleted,
                pollAttempts: evidence.pollAttempts,
                success: commandResult.success,
                durationMs: Date.now() - started,
                error: commandResult.success ? undefined : evidence.error ?? commandResult.stderr,
            },
        };
    }

    private async readProcessLogs(sandboxId: string, launchTask: string): Promise<LocalRuntimeCommandResult> {
        return await this.runCommand(
            sandboxId,
            'diagnostic',
            `${launchTask} logs`,
            `cat ${shellQuote(processLogPath(launchTask))} 2>/dev/null || true`,
            '/workspace',
            30 * 1000,
        );
    }

    private async runCommand(
        sandboxId: string,
        kind: LocalRuntimeCommandResult['kind'],
        name: string,
        command: string,
        workingDirectory: string,
        timeoutMs: number,
    ): Promise<LocalRuntimeCommandResult> {
        const started = Date.now();
        try {
            const value = await this.aca.run([
                'sandbox', 'exec',
                '--id', sandboxId,
                '--working-directory', workingDirectory,
                '-c', command,
            ], timeoutMs);
            return {
                kind,
                name,
                command,
                success: true,
                durationMs: Date.now() - started,
                stdout: truncate(value.stdout),
                stderr: truncate(value.stderr),
            };
        } catch (error) {
            const commandError = error as Error & { stdout?: string; stderr?: string };
            return {
                kind,
                name,
                command,
                success: false,
                durationMs: Date.now() - started,
                stdout: truncate(commandError.stdout ?? ''),
                stderr: truncate(commandError.stderr ?? getErrorMessage(error)),
            };
        }
    }

    private async cleanupAfterCreateFailure(error: unknown, runLabel: string): Promise<string | undefined> {
        const commandError = error as Error & { stdout?: string; stderr?: string };
        const sandboxIds = new Set<string>();
        const output = [commandError.stdout, commandError.stderr].filter(Boolean).join('\n');
        try {
            sandboxIds.add(readSandboxId(output));
        } catch {
            // The apply command may fail before returning an id.
        }
        try {
            const listed = await this.aca.run([
                'sandbox', 'list',
                '-l', `run-id=${runLabel}`,
                '-o', 'json',
            ], 60 * 1000);
            for (const id of readSandboxIds(listed.stdout)) {
                sandboxIds.add(id);
            }
        } catch (listError) {
            if (!sandboxIds.size) {
                return `Could not recover a created sandbox by label: ${getErrorMessage(listError)}`;
            }
        }
        const errors: string[] = [];
        for (const id of sandboxIds) {
            try {
                await this.aca.run(['sandbox', 'delete', '--id', id, '--yes'], 5 * 60 * 1000);
            } catch (deleteError) {
                errors.push(`${id}: ${getErrorMessage(deleteError)}`);
            }
        }
        return errors.length ? `Sandbox cleanup failed: ${errors.join('; ')}` : undefined;
    }

    private getManifestPath(ecosystem: ValidationEcosystem): string {
        switch (ecosystem) {
            case 'node':
                return path.join(this.repoRoot, 'evals', 'sandbox.yaml');
            case 'python':
                return path.join(this.repoRoot, 'evals', 'sandbox-python.yaml');
            case 'dotnet':
                return path.join(this.repoRoot, 'evals', 'sandbox-dotnet.yaml');
        }
    }
}

export function parsePlannedConfigurations(content: string): PlannedDebugConfiguration[] {
    const plan = parseLocalDebugPlanMarkdown(content);
    const section = findSection(plan, 'Debug Configurations');
    const table = section && findTable(section, [
        'Generate',
        'Debug Config Name',
        'Service Root',
        'Project Type',
        'Runtime',
    ]);
    if (!table) {
        return [];
    }
    const generateIndex = findColumnIndex(table.headers, 'Generate');
    const nameIndex = findColumnIndex(table.headers, 'Debug Config Name');
    const serviceRootIndex = findColumnIndex(table.headers, 'Service Root');
    const projectTypeIndex = findColumnIndex(table.headers, 'Project Type');
    const runtimeIndex = findColumnIndex(table.headers, 'Runtime');
    return table.rows
        .filter(row => isChecked(row[generateIndex] ?? '') && !row.some(cell => /compound\s+config/i.test(cell)))
        .flatMap(row => {
            const name = row[nameIndex]?.trim();
            const projectType = row[projectTypeIndex]?.trim();
            const runtime = row[runtimeIndex]?.trim();
            if (!name || !projectType || !runtime) {
                return [];
            }
            return [{
                name,
                serviceRoot: normalizeServiceRoot(row[serviceRootIndex] ?? '.'),
                projectType,
                runtime,
            }];
        });
}

function groupProbesByConfiguration(
    probes: LocalAcceptanceProbe[],
    configurations: PlannedDebugConfiguration[],
): Map<string, ProbeConfigurationGroup> | { error: string } {
    const groups = new Map<string, ProbeConfigurationGroup>();
    for (const probe of probes) {
        const matches = configurations.filter(configuration => targetMatches(probe.target, configuration));
        if (matches.length !== 1) {
            return {
                error: `Probe "${probe.name}" target "${probe.target}" matched ${matches.length} debug configurations; exactly one is required.`,
            };
        }
        const configuration = matches[0];
        const group = groups.get(configuration.name) ?? { configuration, probes: [] };
        group.probes.push(probe);
        groups.set(configuration.name, group);
    }
    return groups;
}

export function targetMatches(target: LocalAcceptanceProbe['target'], configuration: PlannedDebugConfiguration): boolean {
    const normalized = `${configuration.name} ${configuration.projectType}`.toLowerCase();
    switch (target) {
        case 'frontend':
            return normalized.includes('frontend');
        case 'worker':
            return normalized.includes('worker') || normalized.includes('background');
        case 'backend':
            return !normalized.includes('frontend') && !normalized.includes('worker') && !normalized.includes('background');
    }
}

async function readDebugArtifacts(
    workspace: string,
): Promise<{ launchConfigurations: LaunchConfiguration[]; tasks: VsCodeTask[] } | { error: string }> {
    try {
        const [launchContent, tasksContent] = await Promise.all([
            fs.readFile(path.join(workspace, '.vscode', 'launch.json'), 'utf8'),
            fs.readFile(path.join(workspace, '.vscode', 'tasks.json'), 'utf8'),
        ]);
        const launch = parse(launchContent) as { configurations?: unknown };
        const tasks = parse(tasksContent) as { tasks?: unknown };
        if (!Array.isArray(launch?.configurations) || !Array.isArray(tasks?.tasks)) {
            return { error: 'launch.json and tasks.json must contain configuration and task arrays.' };
        }
        return {
            launchConfigurations: launch.configurations as LaunchConfiguration[],
            tasks: tasks.tasks as VsCodeTask[],
        };
    } catch (error) {
        return { error: `Could not read generated debug artifacts: ${getErrorMessage(error)}` };
    }
}

function getDebugCheck(probe: LocalAcceptanceProbe): string {
    if (!probe.debugPort) {
        return '';
    }
    if (probe.debugProtocol === 'cdp') {
        return ` && curl --silent --show-error --fail http://127.0.0.1:${probe.debugPort}/json/list >/dev/null`;
    }
    return ` && bash -c 'exec 3<>/dev/tcp/127.0.0.1/${probe.debugPort}'`;
}

export function createHttpProbeCommand(
        probe: LocalAcceptanceProbe,
        startupTimeoutSeconds: number,
        launchTask: string,
    ): string {
        if (!probe.url || !probe.method || probe.expectedStatus === undefined) {
            throw new Error(`Probe "${probe.name}" has no complete HTTP acceptance contract.`);
        }
        const id = randomUUID();
        const directory = '/workspace/.cor-eval';
        const responseBodyPath = `${directory}/http-${id}.body`;
        const responseHeadersPath = `${directory}/http-${id}.headers`;
        const requestBodyPath = `${directory}/http-${id}.request`;
        const serializedBody = probe.body === undefined
            ? undefined
            : typeof probe.body === 'string' ? probe.body : JSON.stringify(probe.body);
        const bodySetup = serializedBody === undefined
            ? ''
            : `printf %s ${shellQuote(Buffer.from(serializedBody, 'utf8').toString('base64'))} | base64 --decode > ${shellQuote(requestBodyPath)};`;
        const headerArguments = Object.entries(probe.headers ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, value]) => `--header ${shellQuote(`${name}: ${value}`)}`)
            .join(' ');
        const requestBodyArgument = serializedBody === undefined ? '' : `--data-binary @${shellQuote(requestBodyPath)}`;
        const bodyCheck = probe.bodyIncludes
            ? `grep -F -- ${shellQuote(probe.bodyIncludes)} ${shellQuote(responseBodyPath)} >/dev/null || exit 1;`
            : '';
        const debugCheck = getDebugCheck(probe).replace(/^ && /, '');
        const evidence = [
            `printf 'COR_STATUS:%s\\nCOR_HEADERS_BEGIN\\n' "$code";`,
            `cat ${shellQuote(responseHeadersPath)} 2>/dev/null || true;`,
            `printf '\\nCOR_BODY_BEGIN\\n';`,
            `cat ${shellQuote(responseBodyPath)} 2>/dev/null || true;`,
        ].join(' ');
        const attempts = Math.max(1, startupTimeoutSeconds);
        return [
            `mkdir -p ${shellQuote(directory)};`,
            bodySetup,
            `for i in $(seq 1 ${attempts}); do`,
            `code=$(curl --silent --show-error --output ${shellQuote(responseBodyPath)} --dump-header ${shellQuote(responseHeadersPath)} --write-out '%{http_code}' --request ${probe.method} ${headerArguments} ${requestBodyArgument} ${shellQuote(probe.url)} || true);`,
            `if [ "$code" = "${probe.expectedStatus}" ]; then ${evidence} ${bodyCheck} ${debugCheck ? `${debugCheck} || exit 1;` : ''} exit 0; fi;`,
            'sleep 1;',
            'done;',
            evidence,
            `printf '%s\\n' ${shellQuote(`Timed out waiting for ${probe.url}; launch task: ${launchTask}`)} >&2;`,
            'exit 1',
        ].filter(Boolean).join(' ');
    }

    function parseHttpProbeEvidence(output: string): { status?: number; headers?: string; body?: string } {
        const match = /^COR_STATUS:(\d+)\nCOR_HEADERS_BEGIN\n([\s\S]*?)\nCOR_BODY_BEGIN\n([\s\S]*)$/.exec(output);
        if (!match) {
            return {};
        }
        return {
            status: Number(match[1]),
            headers: match[2],
            body: match[3],
        };
    }

    export function parseLaunchedProcessId(output: string): number {
        const trimmed = output.trim();
        if (!/^[1-9]\d*$/.test(trimmed)) {
            throw new Error(`Background launch did not return one process id: ${trimmed || '<empty>'}`);
        }
        const pid = Number(trimmed);
        if (!Number.isSafeInteger(pid) || pid <= 1) {
            throw new Error(`Background launch returned an invalid process id: ${trimmed}`);
        }
        return pid;
    }

    export function createProcessGroupTerminationCommand(pid: number): string {
        if (!Number.isSafeInteger(pid) || pid <= 1) {
            throw new Error(`Refusing to terminate invalid process group id: ${pid}`);
        }
        return [
            `/bin/kill -TERM -- -${pid} || exit 1`,
            `for i in $(seq 1 20); do if ! /bin/kill -0 -- -${pid} 2>/dev/null; then exit 0; fi; sleep 0.25; done`,
            `/bin/kill -KILL -- -${pid}`,
        ].join('; ');
    }

    const azuriteDevelopmentAccount = 'devstoreaccount1';
    const azuriteDevelopmentKey = 'Eby8vdM02xNOcqFeqCnf2Jw==';
    const storageApiVersion = '2023-11-03';

    export function createAzureStorageSharedKeyAuthorization(
        method: string,
        pathname: string,
        query: Record<string, string>,
        headers: Record<string, string>,
    ): string {
        const normalizedHeaders = Object.fromEntries(
            Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim()]),
        );
        const canonicalHeaders = Object.entries(normalizedHeaders)
            .filter(([name]) => name.startsWith('x-ms-'))
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, value]) => `${name}:${value}\n`)
            .join('');
        const canonicalQuery = Object.entries(query)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, value]) => `\n${name.toLowerCase()}:${value}`)
            .join('');
        const contentLength = normalizedHeaders['content-length'];
        const stringToSign = [
            method,
            normalizedHeaders['content-encoding'] ?? '',
            normalizedHeaders['content-language'] ?? '',
            contentLength === '0' ? '' : contentLength ?? '',
            normalizedHeaders['content-md5'] ?? '',
            normalizedHeaders['content-type'] ?? '',
            '',
            normalizedHeaders['if-modified-since'] ?? '',
            normalizedHeaders['if-match'] ?? '',
            normalizedHeaders['if-none-match'] ?? '',
            normalizedHeaders['if-unmodified-since'] ?? '',
            normalizedHeaders.range ?? '',
            `${canonicalHeaders}/${azuriteDevelopmentAccount}${pathname}${canonicalQuery}`,
        ].join('\n');
        const signature = createHmac('sha256', Buffer.from(azuriteDevelopmentKey, 'base64'))
            .update(stringToSign, 'utf8')
            .digest('base64');
        return `SharedKey ${azuriteDevelopmentAccount}:${signature}`;
    }

    /* eslint-disable no-template-curly-in-string -- Generated JavaScript contains its own template literals. */
    export function createQueueStorageEventScript(contract: StorageQueueEventContract): string {
        const timeoutMs = (contract.timeoutSeconds ?? 90) * 1000;
        return [
            "const http = require('http');",
            "const crypto = require('crypto');",
            `const account = ${JSON.stringify(azuriteDevelopmentAccount)};`,
            `const accountKey = ${JSON.stringify(azuriteDevelopmentKey)};`,
            `const version = ${JSON.stringify(storageApiVersion)};`,
            `const inputQueue = ${JSON.stringify(contract.inputQueue)};`,
            `const outputQueue = ${JSON.stringify(contract.outputQueue)};`,
            `const stimulus = ${JSON.stringify(contract.message)};`,
            `const expected = ${JSON.stringify(contract.expectedMessageIncludes)};`,
            `const deadline = Date.now() + ${timeoutMs};`,
            'let pollAttempts = 0;',
            'const subset = (actual, wanted) => wanted !== null && typeof wanted === "object" && !Array.isArray(wanted)',
            '  ? actual !== null && typeof actual === "object" && !Array.isArray(actual) && Object.entries(wanted).every(([key, value]) => subset(actual[key], value))',
            '  : Array.isArray(wanted) ? Array.isArray(actual) && wanted.length === actual.length && wanted.every((value, index) => subset(actual[index], value)) : Object.is(actual, wanted);',
            'const decodeXml = value => value.replace(/&quot;/g, \'"\').replace(/&apos;/g, "\'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");',
            'const parseMessage = value => {',
            '  const decoded = decodeXml(value);',
            '  const candidates = [decoded];',
            '  try { candidates.push(Buffer.from(decoded, "base64").toString("utf8")); } catch {}',
            '  for (const candidate of candidates) { try { return JSON.parse(candidate); } catch {} }',
            '  return decoded;',
            '};',
            'const request = (method, queue, query = {}, body = "") => new Promise((resolve, reject) => {',
            '  const search = new URLSearchParams(query).toString();',
            '  const pathname = `/${account}/${queue}${method === "GET" && query.messageid ? `/messages/${query.messageid}` : ""}`;',
            '  const date = new Date().toUTCString();',
            '  const headers = { "x-ms-date": date, "x-ms-version": version, "content-length": String(Buffer.byteLength(body)) };',
            '  if (body) headers["content-type"] = "application/xml";',
            '  const canonicalHeaders = Object.entries(headers).filter(([name]) => name.startsWith("x-ms-")).sort().map(([name, value]) => `${name}:${value}\\n`).join("");',
            '  const canonicalQuery = Object.entries(query).filter(([name]) => name !== "messageid").sort().map(([name, value]) => `\\n${name.toLowerCase()}:${value}`).join("");',
            '  const stringToSign = [method, "", "", body.length ? headers["content-length"] : "", "", headers["content-type"] || "", "", "", "", "", "", "", `${canonicalHeaders}/${account}${pathname}${canonicalQuery}`].join("\\n");',
            '  headers.Authorization = `SharedKey ${account}:` + crypto.createHmac("sha256", Buffer.from(accountKey, "base64")).update(stringToSign).digest("base64");',
            '  const req = http.request({ hostname: "127.0.0.1", port: 10001, method, path: pathname + (search ? `?${search}` : ""), headers }, response => {',
            '    const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));',
            '  });',
            '  req.on("error", reject); if (body) req.write(body); req.end();',
            '});',
            '(async () => {',
            '  for (const queue of [inputQueue, outputQueue]) {',
            '    const created = await request("PUT", queue, { restype: "queue" });',
            '    if (![201, 204, 409].includes(created.status)) throw new Error(`Could not create queue ${queue}: ${created.status} ${created.body}`);',
            '  }',
            '  const encoded = Buffer.from(JSON.stringify(stimulus)).toString("base64");',
            '  const sent = await request("POST", `${inputQueue}/messages`, {}, `<QueueMessage><MessageText>${encoded}</MessageText></QueueMessage>`);',
            '  if (sent.status !== 201) throw new Error(`Could not enqueue stimulus: ${sent.status} ${sent.body}`);',
            '  while (Date.now() < deadline) {',
            '    pollAttempts++;',
            '    const result = await request("GET", `${outputQueue}/messages`, { numofmessages: "1", visibilitytimeout: "1" });',
            '    if (result.status !== 200) throw new Error(`Could not poll output queue: ${result.status} ${result.body}`);',
            '    const match = /<MessageText>([\\s\\S]*?)<\\/MessageText>/.exec(result.body);',
            '    if (match) { const observedMessage = parseMessage(match[1]); if (subset(observedMessage, expected)) { process.stdout.write(JSON.stringify({ observedMessage, pollAttempts })); return; } }',
            '    await new Promise(resolve => setTimeout(resolve, 1000));',
            '  }',
            '  throw new Error(`Timed out waiting for matching output after ${pollAttempts} polls.`);',
            '})().catch(error => { const message = error instanceof Error ? error.message : String(error); process.stdout.write(JSON.stringify({ pollAttempts, error: message })); console.error(message); process.exit(1); });',
        ].join('\n');
    }

    export function createBlobStorageEventScript(contract: StorageBlobEventContract): string {
        const timeoutMs = (contract.timeoutSeconds ?? 120) * 1000;
        return [
            "const http = require('http');",
            "const crypto = require('crypto');",
            `const account = ${JSON.stringify(azuriteDevelopmentAccount)};`,
            `const accountKey = ${JSON.stringify(azuriteDevelopmentKey)};`,
            `const version = ${JSON.stringify(storageApiVersion)};`,
            `const sourceContainer = ${JSON.stringify(contract.sourceContainer)};`,
            `const destinationContainer = ${JSON.stringify(contract.destinationContainer)};`,
            `const blobName = ${JSON.stringify(contract.blobName)};`,
            `const content = ${JSON.stringify(contract.content)};`,
            `const metadata = ${JSON.stringify(contract.metadata)};`,
            `const sourceMustBeDeleted = ${JSON.stringify(contract.sourceMustBeDeleted ?? true)};`,
            `const deadline = Date.now() + ${timeoutMs};`,
            'let pollAttempts = 0;',
            'const request = (method, pathname, query = {}, body = "", extraHeaders = {}) => new Promise((resolve, reject) => {',
            '  const search = new URLSearchParams(query).toString();',
            '  const date = new Date().toUTCString();',
            '  const headers = { "x-ms-date": date, "x-ms-version": version, ...extraHeaders };',
            '  if (body) headers["content-length"] = String(Buffer.byteLength(body));',
            '  const normalized = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim()]));',
            '  const canonicalHeaders = Object.entries(normalized).filter(([name]) => name.startsWith("x-ms-")).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => `${name}:${value}\\n`).join("");',
            '  const canonicalQuery = Object.entries(query).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => `\\n${name.toLowerCase()}:${value}`).join("");',
            '  const contentLength = normalized["content-length"];',
            '  const stringToSign = [method, "", "", contentLength === "0" ? "" : contentLength || "", "", normalized["content-type"] || "", "", "", "", "", "", normalized.range || "", `${canonicalHeaders}/${account}${pathname}${canonicalQuery}`].join("\\n");',
            '  headers.Authorization = `SharedKey ${account}:` + crypto.createHmac("sha256", Buffer.from(accountKey, "base64")).update(stringToSign).digest("base64");',
            '  const req = http.request({ hostname: "127.0.0.1", port: 10000, method, path: pathname + (search ? `?${search}` : ""), headers }, response => {',
            '    const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));',
            '  });',
            '  req.on("error", reject); if (body) req.write(body); req.end();',
            '});',
            '(async () => {',
            '  for (const container of [sourceContainer, destinationContainer]) {',
            '    const created = await request("PUT", `/${account}/${container}`, { restype: "container" });',
            '    if (![201, 409].includes(created.status)) throw new Error(`Could not create container ${container}: ${created.status} ${created.body}`);',
            '  }',
            '  const metadataHeaders = Object.fromEntries(Object.entries(metadata).map(([name, value]) => [`x-ms-meta-${name}`, value]));',
            '  const sourcePath = `/${account}/${sourceContainer}/${blobName.split("/").map(encodeURIComponent).join("/")}`;',
            '  const destinationPath = `/${account}/${destinationContainer}/${blobName.split("/").map(encodeURIComponent).join("/")}`;',
            '  const uploaded = await request("PUT", sourcePath, {}, content, { "content-type": "application/octet-stream", "x-ms-blob-type": "BlockBlob", ...metadataHeaders });',
            '  if (uploaded.status !== 201) throw new Error(`Could not upload stimulus blob: ${uploaded.status} ${uploaded.body}`);',
            '  while (Date.now() < deadline) {',
            '    pollAttempts++;',
            '    const destination = await request("GET", destinationPath);',
            '    const source = await request("HEAD", sourcePath);',
            '    const sourceDeleted = source.status === 404;',
            '    if (destination.status === 200 && destination.body === content && (!sourceMustBeDeleted || sourceDeleted)) {',
            '      process.stdout.write(JSON.stringify({ observedContent: destination.body, sourceDeleted, pollAttempts }));',
            '      return;',
            '    }',
            '    if (![200, 404].includes(destination.status)) throw new Error(`Could not poll destination blob: ${destination.status} ${destination.body}`);',
            '    if (![200, 404].includes(source.status)) throw new Error(`Could not inspect source blob: ${source.status} ${source.body}`);',
            '    await new Promise(resolve => setTimeout(resolve, 1000));',
            '  }',
            '  throw new Error(`Timed out waiting for archived blob after ${pollAttempts} polls.`);',
            '})().catch(error => { const message = error instanceof Error ? error.message : String(error); process.stdout.write(JSON.stringify({ pollAttempts, error: message })); console.error(message); process.exit(1); });',
        ].join('\n');
    }
    /* eslint-enable no-template-curly-in-string */

    function createBrowserProbeScript(
    url: string,
    contract: NonNullable<LocalAcceptanceProbe['browser']>,
): string {
    const expectedText = contract.expectedText?.toLowerCase();
    const requireInteractive = contract.requireInteractiveElements ?? true;
    const maxViolations = contract.maxSeriousAccessibilityViolations ?? 0;
    const viewport = contract.viewport ?? { width: 1440, height: 900 };
    const actions = contract.actions ?? [];
    const assertions = contract.assertions ?? [];
    return [
        "const { chromium } = require('/home/vscode/.cor-browser/node_modules/playwright');",
        "const axe = require('/home/vscode/.cor-browser/node_modules/axe-core');",
        '(async () => {',
        'const consoleErrors = [];',
        'let actionsCompleted = 0;',
        'let assertionsCompleted = 0;',
        'let page;',
        'let accessibilityScanned = false;',
        'let accessibilityScanError;',
        'const scanAccessibility = async () => {',
        'if (!page) return [];',
        'try {',
        'await page.addScriptTag({ content: axe.source });',
        "const accessibility = await page.evaluate(async () => await globalThis.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }));",
        'accessibilityScanned = true;',
        "return accessibility.violations.filter(value => value.impact === 'serious' || value.impact === 'critical').map(value => value.id + ':' + value.impact + ' [' + value.nodes.slice(0, 3).flatMap(node => node.target).join(', ') + ']');",
        '} catch (error) { accessibilityScanError = error instanceof Error ? error.message : String(error); return []; }',
        '};',
        'const browser = await chromium.launch({ headless: true });',
        'try {',
        `page = await browser.newPage({ viewport: ${JSON.stringify(viewport)} });`,
        "page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });",
        "page.on('pageerror', error => consoleErrors.push(error.message));",
        `const response = await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 60000 });`,
        "if (!response || !response.ok()) throw new Error('Browser navigation failed with status ' + (response?.status() ?? 'none') + '.');",
        "await page.locator('body').waitFor({ state: 'visible', timeout: 15000 });",
        ...actions.map(action => {
            const locator = browserLocatorExpression(action);
            switch (action.kind) {
                case 'click':
                    return `await ${locator}.click(); actionsCompleted++;`;
                case 'fill':
                    return `await ${locator}.fill(${JSON.stringify(action.value ?? '')}); actionsCompleted++;`;
                case 'select':
                    return `await ${locator}.selectOption(${JSON.stringify(action.value ?? '')}); actionsCompleted++;`;
            }
        }),
        ...assertions.map(assertion => {
            const locator = browserLocatorExpression(assertion);
            switch (assertion.kind) {
                case 'visible':
                    return `if (!await ${locator}.isVisible()) throw new Error(${JSON.stringify(`Expected ${assertion.selector} to be visible.`)}); assertionsCompleted++;`;
                case 'hidden':
                    return `if (await ${locator}.isVisible()) throw new Error(${JSON.stringify(`Expected ${assertion.selector} to be hidden.`)}); assertionsCompleted++;`;
                case 'text':
                    return `await ${locator}.filter({ hasText: ${JSON.stringify(assertion.value ?? '')} }).waitFor({ state: 'visible', timeout: 15000 }); assertionsCompleted++;`;
                case 'value':
                    return `if ((await ${locator}.inputValue()) !== ${JSON.stringify(assertion.value ?? '')}) throw new Error(${JSON.stringify(`Expected ${assertion.selector} value to equal "${assertion.value ?? ''}".`)}); assertionsCompleted++;`;
            }
        }),
        "const title = await page.title();",
        "const bodyText = (await page.locator('body').innerText()).trim();",
        "if (!bodyText) throw new Error('Rendered page body is empty.');",
        expectedText
            ? `if (!bodyText.toLowerCase().includes(${JSON.stringify(expectedText)})) throw new Error(${JSON.stringify(`Rendered page does not include expected text "${contract.expectedText}".`)});`
            : '',
        "const interactiveElements = await page.locator('a[href], button, input, select, textarea').count();",
        requireInteractive
            ? "if (interactiveElements === 0) throw new Error('Rendered page has no interactive elements.');"
            : '',
        'const seriousAccessibilityViolations = await scanAccessibility();',
        `process.stdout.write(JSON.stringify({ title, currentUrl: page.url(), bodyTextLength: bodyText.length, bodyTextExcerpt: bodyText.slice(0, 2000), interactiveElements, seriousAccessibilityViolations, accessibilityScanned, accessibilityScanError, consoleErrors: consoleErrors.slice(0, 20), actionsCompleted, actionsExpected: ${actions.length}, assertionsCompleted, assertionsExpected: ${assertions.length}, viewport: ${JSON.stringify(viewport)} }));`,
        `if (seriousAccessibilityViolations.length > ${maxViolations}) { console.error('Accessibility violations exceeded ${maxViolations}: ' + seriousAccessibilityViolations.join(', ')); process.exitCode = 1; }`,
        '} catch (error) {',
        "const bodyText = page ? await page.locator('body').innerText().catch(() => '') : '';",
        "const title = page ? await page.title().catch(() => '') : '';",
        'const seriousAccessibilityViolations = await scanAccessibility();',
        `process.stdout.write(JSON.stringify({ title, currentUrl: page?.url(), bodyTextLength: bodyText.length, bodyTextExcerpt: bodyText.slice(0, 2000), seriousAccessibilityViolations, accessibilityScanned, accessibilityScanError, consoleErrors: consoleErrors.slice(0, 20), actionsCompleted, actionsExpected: ${actions.length}, assertionsCompleted, assertionsExpected: ${assertions.length}, viewport: ${JSON.stringify(viewport)} }));`,
        "console.error(error instanceof Error ? error.stack : String(error));",
        'process.exitCode = 1;',
        '} finally { await browser.close(); }',
        "})().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });",
    ].filter(Boolean).join('\n');
}

function browserLocatorExpression(
    step: { selector: string; selectorType?: 'css' | 'label' | 'role'; role?: string },
): string {
    if (step.selectorType === 'label') {
        return `page.getByLabel(${JSON.stringify(step.selector)})`;
    }
    if (step.selectorType === 'role') {
        return `page.getByRole(${JSON.stringify(step.role)}, { name: ${JSON.stringify(step.selector)}, exact: true })`;
    }
    return `page.locator(${JSON.stringify(step.selector)})`;
}

export function resolveLaunchTask(
    configuration: LaunchConfiguration,
    serviceRoot: string,
): VsCodeTask | { error: string } | undefined {
    if (configuration.request !== 'launch') {
        return undefined;
    }
    if (['pwa-chrome', 'chrome', 'msedge'].includes(String(configuration.type))) {
        return undefined;
    }
    const args = Array.isArray(configuration.args)
        ? configuration.args.filter((value): value is string => typeof value === 'string')
        : [];
    let command: string;
    if (configuration.type === 'debugpy') {
        const interpreter = typeof configuration.python === 'string' ? configuration.python : 'python';
        if (typeof configuration.module === 'string') {
            command = `${shellQuote(interpreter)} -m debugpy --listen 127.0.0.1:${debugpyEvaluationPort} -m ${shellQuote(configuration.module)}`;
        } else if (typeof configuration.program === 'string') {
            command = `${shellQuote(interpreter)} -m debugpy --listen 127.0.0.1:${debugpyEvaluationPort} ${shellQuote(configuration.program)}`;
        } else {
            return { error: 'A debugpy launch configuration requires a module or program.' };
        }
    } else if (['node', 'pwa-node'].includes(String(configuration.type))) {
        const executable = typeof configuration.runtimeExecutable === 'string'
            ? configuration.runtimeExecutable
            : 'node';
        const runtimeArgs = Array.isArray(configuration.runtimeArgs)
            ? configuration.runtimeArgs.filter((value): value is string => typeof value === 'string')
            : [];
        if (executable === 'node' && typeof configuration.program !== 'string') {
            return { error: 'A Node.js launch configuration requires a program or runtimeExecutable.' };
        }
        command = [
            executable,
            ...runtimeArgs,
            ...(typeof configuration.program === 'string' ? [configuration.program] : []),
        ].map(shellQuote).join(' ');
    } else if (configuration.type === 'coreclr') {
        if (typeof configuration.program !== 'string') {
            return { error: 'A CoreCLR launch configuration requires a program.' };
        }
        const executable = typeof configuration.runtimeExecutable === 'string'
            ? configuration.runtimeExecutable
            : 'dotnet';
        command = [executable, configuration.program].map(shellQuote).join(' ');
    } else {
        return { error: `Launch debugger type "${String(configuration.type)}" is not supported by isolated validation.` };
    }
    if (args.length) {
        command += ` ${args.map(shellQuote).join(' ')}`;
    }
    const workspaceFolder = '$' + '{workspaceFolder}';
    return {
        type: 'shell',
        label: `launch: ${String(configuration.name)}`,
        command,
        isBackground: true,
        options: {
            cwd: typeof configuration.cwd === 'string'
                ? configuration.cwd
                : serviceRoot === '.'
                    ? workspaceFolder
                    : `${workspaceFolder}/${serviceRoot}`,
            env: configuration.env,
        },
    };
}

export function resolveDebuggerPrerequisite(
    configuration: LaunchConfiguration,
): { command?: string; name: string; errorMessage: string } | { error: string } {
    if (configuration.type !== 'coreclr' || configuration.request !== 'attach') {
        return {
            name: 'debugger prerequisite',
            errorMessage: 'Debugger prerequisite validation failed.',
        };
    }
    if (typeof configuration.processName !== 'string' || !configuration.processName.trim()) {
        return { error: 'A CoreCLR attach configuration requires a literal processName.' };
    }
    const processName = configuration.processName.replace(/\.exe$/i, '');
    const processPattern = `(^|[/ ])${escapeExtendedRegex(processName)}(\\.dll)?( |$)`;
    return {
        command: `pgrep -f -- ${shellQuote(processPattern)} >/dev/null`,
        name: `CoreCLR process ${processName}`,
        errorMessage: `CoreCLR attach target process "${processName}" is not running.`,
    };
}

function escapeExtendedRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveTaskChain(
    rootLabel: string,
    tasks: VsCodeTask[],
): { tasks: VsCodeTask[] } | { error: string } {
    const byLabel = new Map<string, VsCodeTask>();
    for (const task of tasks) {
        if (typeof task.label === 'string') {
            byLabel.set(task.label, task);
        }
    }
    const ordered: VsCodeTask[] = [];
    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (label: string): string | undefined => {
        if (active.has(label)) {
            return `Task dependency cycle includes "${label}".`;
        }
        if (visited.has(label)) {
            return undefined;
        }
        const task = byLabel.get(label);
        if (!task) {
            return `Task "${label}" does not exist.`;
        }
        active.add(label);
        for (const dependency of normalizeStringList(task.dependsOn)) {
            const error = visit(dependency);
            if (error) {
                return error;
            }
        }
        active.delete(label);
        visited.add(label);
        ordered.push(task);
        return undefined;
    };
    const error = visit(rootLabel);
    return error ? { error } : { tasks: ordered };
}

function resolveTaskCommand(
    task: VsCodeTask,
    _serviceRoot: string,
): { command?: string; cwd: string } {
    const taskType = typeof task.type === 'string' ? task.type : 'shell';
    const rawCommand = typeof task.command === 'string' ? task.command : undefined;
    let command: string | undefined;
    if (taskType === 'npm') {
        const script = typeof task.script === 'string' ? task.script : rawCommand;
        command = script ? `npm run ${shellQuote(script)}` : undefined;
    } else if (taskType === 'func') {
        command = rawCommand ? `func ${rawCommand}` : undefined;
    } else {
        command = rawCommand;
    }
    const args = Array.isArray(task.args)
        ? task.args.filter((value): value is string => typeof value === 'string')
        : [];
    if (command && args.length) {
        command += ` ${args.map(shellQuote).join(' ')}`;
    }
    const env = task.options?.env && typeof task.options.env === 'object' && !Array.isArray(task.options.env)
        ? Object.entries(task.options.env as Record<string, unknown>)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        : [];
    if (command && env.length) {
        command = `env ${env.map(([key, value]) => `${key}=${shellQuote(value)}`).join(' ')} ${command}`;
    }
    const cwd = typeof task.options?.cwd === 'string'
        ? replaceWorkspaceFolder(task.options.cwd)
        : '/workspace';
    return {
        command: command && replaceWorkspaceFolder(command),
        cwd,
    };
}

function runtimeToEcosystem(runtime: string): ValidationEcosystem | undefined {
    const normalized = runtime.toLowerCase();
    if (normalized.includes('node')) {
        return 'node';
    }
    if (normalized.includes('python')) {
        return 'python';
    }
    if (normalized.includes('dotnet') || normalized.includes('.net')) {
        return 'dotnet';
    }
    return undefined;
}

function normalizeServiceRoot(value: string): string {
    const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
    return normalized || '.';
}

function replaceWorkspaceFolder(value: string): string {
    return value.replaceAll('$' + '{workspaceFolder}', '/workspace');
}

function normalizeStringList(value: unknown): string[] {
    if (typeof value === 'string') {
        return [value];
    }
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function getToolchainCheckCommand(ecosystem: ValidationEcosystem): string {
    switch (ecosystem) {
        case 'node':
            return 'node --version && npm --version';
        case 'python':
            return 'python --version && python -m pip --version';
        case 'dotnet':
            return 'dotnet --info && test -n "$(dotnet --list-sdks)"';
    }
}

function processLogPath(label: string): string {
    return `/workspace/.cor-eval/cor-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.log`;
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

function failure(
    failureCode: NonNullable<SandboxLocalRuntimeValidationResult['failureCode']>,
    error: string,
    commands: LocalRuntimeCommandResult[],
    probes: LocalRuntimeProbeResult[],
    browserChecks?: LocalRuntimeBrowserResult[],
    persistenceChecks?: LocalRuntimePersistenceResult[],
    workerEvents?: LocalRuntimeStorageEventResult[],
): SandboxLocalRuntimeValidationResult {
    return {
        outcome: 'failed',
        failureCode,
        error,
        commands,
        probes,
        browserChecks,
        persistenceChecks,
        workerEvents,
    };
}

function truncate(value: string): string {
    return value.length <= maxLogLength ? value : `${value.slice(0, maxLogLength)}\n[truncated]`;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

class DefaultAcaCommandRunner implements AcaCommandRunner {
    public async run(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
        return await execFileAsync('aca', args, {
            timeout: timeoutMs,
            maxBuffer: 20 * 1024 * 1024,
            encoding: 'utf8',
        });
    }
}

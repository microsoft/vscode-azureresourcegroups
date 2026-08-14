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
    SecurityContract,
    StorageBlobEventContract,
    StorageEventContract,
    StorageQueueEventContract,
} from './scenario';
import {
    SecurityCheckPlan,
    isSecurityPlanConclusive,
    planSecurityChecks,
} from './securityChecks';

const execFileAsync = promisify(execFile);
const maxLogLength = 20_000;
export const debugpyEvaluationPort = 5678;
const debuggerPrerequisiteAttempts = 30;
const debuggerPrerequisiteTimeoutMs = 75 * 1000;

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
    port?: unknown;
    attachSimplePort?: unknown;
    url?: unknown;
    webRoot?: unknown;
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
    kind: 'setup' | 'task' | 'probe' | 'debugger' | 'diagnostic' | 'restart' | 'storage-event' | 'security';
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
    /**
     * Actions that observably changed the page. An action can complete without doing anything —
     * clicking a mis-resolved target, or filling a form that exposed no fields — so this is the
     * count the journey score is built from.
     */
    actionsEffective?: number;
    actionLedger?: Array<{ action: string; effective: boolean; reason?: string }>;
    assertionsCompleted?: number;
    assertionsExpected?: number;
    /** The app served the page, rendered content and exposed interactive elements. */
    loadPassed?: boolean;
    journeyStatus?: 'passed' | 'failed' | 'not-attempted';
    journeySeverity?: 'required' | 'advisory';
    journeyError?: string;
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
    /**
     * Persistence re-asserts the record the journey created, so it has nothing to verify when the
     * journey never completed. Skipping is reported distinctly from failing: treating an
     * unattempted check as a failure would relocate the journey's false negative one gate
     * downstream instead of removing it.
     */
    skipped?: boolean;
    skipReason?: string;
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

export interface LocalRuntimeSecurityResult {
    name: string;
    url: string;
    /**
     * `public` proves the server is alive and enforcing selectively. Without it a crashed or
     * blanket-deny app would satisfy every negative check and pass the gate for the wrong reason.
     */
    kind: 'unauthenticated' | 'malformed-token' | 'public';
    expectedStatuses: number[];
    responseStatus?: number;
    /**
     * Retained only for failures, where the body is the evidence that protected data leaked.
     */
    responseExcerpt?: string;
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
        | 'localContainerRegistryUnavailable'
        | 'localTaskFailed'
        | 'localProbeFailed'
        | 'localBrowserFailed'
        | 'localPersistenceFailed'
        | 'localStorageEventFailed'
        | 'localSecurityFailed'
        | 'localDebuggerUnavailable'
        | 'localSandboxCleanupFailed';
    error?: string;
    commands: LocalRuntimeCommandResult[];
    probes: LocalRuntimeProbeResult[];
    browserChecks?: LocalRuntimeBrowserResult[];
    persistenceChecks?: LocalRuntimePersistenceResult[];
    workerEvents?: LocalRuntimeStorageEventResult[];
    securityChecks?: LocalRuntimeSecurityResult[];
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
        'localContainerRegistryUnavailable',
        'localSandboxCleanupFailed',
    ].includes(code ?? '');
}

/**
 * A registry that refuses or rate-limits an image pull says nothing about the generated project.
 * Counting it as a product failure understates the real success rate.
 */
export function isContainerRegistryFailure(output: string | undefined): boolean {
    if (!output) {
        return false;
    }
    return /error pulling image configuration|denied: requested access to the resource is denied/u.test(output)
        || /toomanyrequests|rate limit|pull rate limit/iu.test(output)
        || /failed to (?:resolve|pull) (?:reference|image)/u.test(output)
        || /(?:dial tcp|TLS handshake|i\/o) timeout.*registry|registry.*(?:dial tcp|TLS handshake|i\/o) timeout/u.test(output);
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
        const securityChecks: LocalRuntimeSecurityResult[] = [];
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
                    contract.security,
                    securityChecks,
                );
                if (result) {
                    return result;
                }
            }
            return { outcome: 'passed', commands, probes, browserChecks, persistenceChecks, workerEvents, securityChecks };
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
                                    const registryFailure = isContainerRegistryFailure(
                                        `${taskResult.stderr ?? ''}\n${taskResult.stdout ?? ''}`);
                                    validationFailure = failure(
                                        registryFailure ? 'localContainerRegistryUnavailable' : 'localTaskFailed',
                                        registryFailure
                                            ? `Debug task "${label}" could not pull its container images.`
                                            : `Debug task "${label}" failed.`,
                                        commands,
                                        probes);
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
                                if (!persistenceResult.success && !persistenceResult.skipped) {
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
                            validationFailure = await this.runDebuggerPrerequisites(
                                sandboxId,
                                item.launch,
                                commands,
                                probes,
                                browserChecks,
                                persistenceChecks,
                                workerEvents,
                            );
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
        securityContract: SecurityContract | undefined,
        securityChecks: LocalRuntimeSecurityResult[],
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
                        const output = `${taskResult.stdout}\n${taskResult.stderr}`;
                        const unavailable = /(?:command not found|not recognized|no such file or directory)/i.test(output);
                        // The compound path already distinguished these; without the same check here a
                        // blocked image pull is charged to the generated project.
                        const registryFailure = isContainerRegistryFailure(output);
                        validationFailure = failure(
                            registryFailure
                                ? 'localContainerRegistryUnavailable'
                                : unavailable ? 'localToolchainUnavailable' : 'localTaskFailed',
                            registryFailure
                                ? `Debug task "${String(task.label)}" could not pull its container images.`
                                : `Debug task "${String(task.label)}" failed.`,
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
                        const registryFailure = isContainerRegistryFailure(
                            `${launchResult.stderr ?? ''}\n${launchResult.stdout ?? ''}`);
                        validationFailure = failure(
                            registryFailure ? 'localContainerRegistryUnavailable' : 'localTaskFailed',
                            registryFailure
                                ? `Debug launch configuration "${configuration.name}" could not pull its container images.`
                                : `Debug launch configuration "${configuration.name}" failed.`,
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
                validationFailure = await this.runSecurityChecks(
                    sandboxId,
                    securityContract,
                    acceptanceProbes,
                    commands,
                    probes,
                    browserChecks,
                    persistenceChecks,
                    workerEvents,
                    securityChecks,
                );
            }
            if (!validationFailure) {
                validationFailure = await this.runDebuggerPrerequisites(
                    sandboxId,
                    launchConfiguration,
                    commands,
                    probes,
                    browserChecks,
                    persistenceChecks,
                    workerEvents,
                );
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

    /**
     * Both the compound and single-configuration paths need identical debugger evidence, and the
     * gate reads only commands recorded with kind 'debugger'. Sharing one implementation keeps a
     * configuration shape from being verified on one path and silently skipped on the other.
     */
    private async runDebuggerPrerequisites(
        sandboxId: string,
        launch: LaunchConfiguration,
        commands: LocalRuntimeCommandResult[],
        probes: LocalRuntimeProbeResult[],
        browserChecks: LocalRuntimeBrowserResult[],
        persistenceChecks: LocalRuntimePersistenceResult[],
        workerEvents: LocalRuntimeStorageEventResult[],
    ): Promise<SandboxLocalRuntimeValidationResult | undefined> {
        const resolved = resolveDebuggerPrerequisite(launch);
        if ('error' in resolved) {
            return failure(
                'debugTaskGraphInvalid',
                resolved.error,
                commands,
                probes,
                browserChecks,
                persistenceChecks,
                workerEvents,
            );
        }
        for (const check of resolved.checks) {
            const result = await this.runCommand(
                sandboxId,
                'debugger',
                check.name,
                check.command,
                '/workspace',
                debuggerPrerequisiteTimeoutMs,
            );
            commands.push(result);
            if (!result.success) {
                return failure(
                    'localDebuggerUnavailable',
                    check.errorMessage,
                    commands,
                    probes,
                    browserChecks,
                    persistenceChecks,
                    workerEvents,
                );
            }
        }
        return undefined;
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
        if (initialBrowser?.journeyStatus === 'failed' || initialBrowser?.journeyStatus === 'not-attempted') {
            const reason = `The browser journey did not complete (${initialBrowser.journeyError ?? initialBrowser.journeyStatus}), `
                + 'so there is no created record whose survival a restart could verify.';
            return {
                name: probe.name,
                restartTargets: contract.restartTargets,
                processIdsBefore: [],
                processIdsAfter: [],
                readinessProbes: [],
                postRestartBrowser: {
                    name: `${probe.name} after restart`,
                    url: probe.url ?? '',
                    success: false,
                    durationMs: 0,
                },
                success: false,
                skipped: true,
                skipReason: reason,
                durationMs: Date.now() - started,
                error: reason,
            };
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

    /**
     * The gate is a hard release blocker, so a contract that cannot produce conclusive evidence
     * fails rather than passing on a technicality.
     */
    private async runSecurityChecks(
        sandboxId: string,
        securityContract: SecurityContract | undefined,
        acceptanceProbes: LocalAcceptanceProbe[],
        commands: LocalRuntimeCommandResult[],
        probes: LocalRuntimeProbeResult[],
        browserChecks: LocalRuntimeBrowserResult[],
        persistenceChecks: LocalRuntimePersistenceResult[],
        workerEvents: LocalRuntimeStorageEventResult[],
        securityChecks: LocalRuntimeSecurityResult[],
    ): Promise<SandboxLocalRuntimeValidationResult | undefined> {
        if (!securityContract) {
            return undefined;
        }
        const plan = planSecurityChecks(securityContract, acceptanceProbes);
        const fail = (error: string): SandboxLocalRuntimeValidationResult => failure(
            'localSecurityFailed',
            error,
            commands,
            probes,
            browserChecks,
            persistenceChecks,
            workerEvents,
            securityChecks,
        );
        if (!isSecurityPlanConclusive(plan)) {
            return fail(
                'The security contract produced no conclusive checks: it needs at least one public '
                + 'path and one protected path.',
            );
        }
        for (const check of plan) {
            const { result, command } = await this.runSecurityCheck(sandboxId, check);
            commands.push(command);
            securityChecks.push(result);
            if (!result.success) {
                return fail(`Security check "${check.name}" failed. ${result.error ?? ''}`.trim());
            }
        }
        return undefined;
    }

    /**
     * Runs one negative-authorization request. The app is already known to be up by this point,
     * so a single attempt is enough and a non-answer is itself a failure.
     */
    private async runSecurityCheck(
        sandboxId: string,
        check: SecurityCheckPlan,
    ): Promise<{ result: LocalRuntimeSecurityResult; command: LocalRuntimeCommandResult }> {
        const started = Date.now();
        const bodyPath = '/tmp/cor-security-body';
        const headerArguments = Object.entries(check.headers ?? {})
            .map(([name, value]) => `--header ${shellQuote(`${name}: ${value}`)}`)
            .join(' ');
        const script = [
            `code=$(curl --silent --show-error --output ${shellQuote(bodyPath)}`,
            `--write-out '%{http_code}' --max-time 20 ${headerArguments} ${shellQuote(check.url)} || true);`,
            `printf 'COR_STATUS:%s\\nCOR_HEADERS_BEGIN\\n\\nCOR_BODY_BEGIN\\n' "$code";`,
            `cat ${shellQuote(bodyPath)} 2>/dev/null || true`,
        ].join(' ');
        const commandResult = await this.runCommand(
            sandboxId,
            'security',
            check.name,
            script,
            '/workspace',
            45000,
        );
        const evidence = parseHttpProbeEvidence(commandResult.stdout);
        const success = evidence.status !== undefined
            && check.expectedStatuses.includes(evidence.status);
        // A refusal body is uninteresting; a leak is the whole finding, so only failures keep it.
        const responseExcerpt = success ? undefined : evidence.body?.slice(0, 500);
        return {
            command: { ...commandResult, success },
            result: {
                name: check.name,
                url: check.url,
                kind: check.kind,
                expectedStatuses: check.expectedStatuses,
                responseStatus: evidence.status,
                responseExcerpt,
                success,
                durationMs: Date.now() - started,
                error: success
                    ? undefined
                    : evidence.status === undefined
                        ? `No HTTP response from ${check.url}.`
                        : `Expected ${check.expectedStatuses.join(' or ')} but got ${evidence.status}.`,
            },
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

    export function createBrowserProbeScript(
    url: string,
    contract: NonNullable<LocalAcceptanceProbe['browser']>,
): string {
    const expectedText = contract.expectedText?.toLowerCase();
    const requireInteractive = contract.requireInteractiveElements ?? true;
    const maxViolations = contract.maxSeriousAccessibilityViolations === null
        ? null
        : contract.maxSeriousAccessibilityViolations ?? 0;
    const viewport = contract.viewport ?? { width: 1440, height: 900 };
    const journeySeverity = contract.journeySeverity ?? 'required';
    const actions = contract.actions ?? [];
    const assertions = contract.assertions ?? [];
    return [
        "const { chromium } = require('/home/vscode/.cor-browser/node_modules/playwright');",
        "const axe = require('/home/vscode/.cor-browser/node_modules/axe-core');",
        '(async () => {',
        'const consoleErrors = [];',
        'let actionsCompleted = 0;',
        'let actionsEffective = 0;',
        'const actionLedger = [];',
        'let assertionsCompleted = 0;',
        'const actionsSkipped = [];',
        'const adaptedTargets = [];',
        'const ambiguousTargets = [];',
        // A role+name matching several elements is a legitimate UI (a header CTA and a form submit
        // button can share a label). Playwright strict mode rejects it, which failed real, working
        // apps. Disambiguate to the first visible+enabled match and record it as evidence; the
        // assertions that follow stay strict, so this cannot mask a broken flow.
        // A generated app is free to label an empty-state CTA differently from the populated-state
        // one ("Create first ticket" vs "Create ticket"), and the evaluator always boots against an
        // empty database because seed data is forbidden. Demanding the populated-state label makes
        // every CRUD app fail a working create flow, so an absent target falls back to the
        // intent-equivalent control instead of waiting out the click timeout.
        `const findIntentEquivalent = async (role, name) => {
            const stop = new Set(['a', 'an', 'the', 'new', 'first', 'my', 'this', 'to', 'add']);
            const words = String(name || '').toLowerCase().split(/[^a-z0-9]+/)
                .filter(word => word && !stop.has(word));
            if (!words.length) { return null; }
            // The prompt never says whether a create affordance is a button or a link, and a router
            // link renders as an anchor. Searching only the requested role made a working app fail
            // at the first action, so the search widens across the activatable roles. The requested
            // role is tried first, so an exact match always wins over a widened one.
            const requested = role || 'button';
            const roles = [requested, ...['button', 'link', 'menuitem', 'tab'].filter(value => value !== requested)];
            let best = null;
            let bestScore = 0;
            let bestName = '';
            let bestRole = requested;
            for (const candidateRole of roles) {
                const candidates = page.getByRole(candidateRole);
                const count = await candidates.count().catch(() => 0);
                for (let index = 0; index < count; index++) {
                    const candidate = candidates.nth(index);
                    const usable = await candidate.isVisible().catch(() => false)
                        && await candidate.isEnabled().catch(() => false);
                    if (!usable) { continue; }
                    const text = ((await candidate.textContent().catch(() => '')) || '').toLowerCase();
                    const matched = words.filter(word => text.includes(word)).length;
                    // Require every meaningful word so "Create ticket" never resolves to "Delete ticket".
                    if (matched !== words.length) { continue; }
                    // Prefer the tightest label, so "Create ticket" beats "Create ticket from template".
                    const score = 1000 - text.trim().length;
                    if (score > bestScore) { bestScore = score; best = candidate; bestName = text.trim(); bestRole = candidateRole; }
                }
                // A widened role is a fallback, not a preference: stop as soon as one role matched.
                if (best) { break; }
            }
            if (best) { adaptedTargets.push({ requested: name, requestedRole: requested, resolved: bestName, resolvedRole: bestRole }); }
            return best;
        };`,
        // Once a form has been filled, a "click create/submit" action means submit *that* form. The
        // app is free to label its submit differently from the CTA that opened it ("Create support
        // ticket" vs "Create ticket"), so an exact match on a nav control elsewhere on the page is
        // not the intended target.
        `const preferFilledFormSubmit = async (locator) => {
            if (formFieldsFilled.length === 0) { return null; }
            const inForm = await locator.first().evaluate(el => Boolean(el.closest('form'))).catch(() => false);
            if (inForm) { return null; }
            const submit = page.locator('form button[type="submit"], form input[type="submit"]');
            const count = await submit.count().catch(() => 0);
            for (let index = 0; index < count; index++) {
                const candidate = submit.nth(index);
                const usable = await candidate.isVisible().catch(() => false)
                    && await candidate.isEnabled().catch(() => false);
                if (!usable) { continue; }
                const text = ((await candidate.textContent().catch(() => '')) || '').trim();
                adaptedTargets.push({ requested: 'submit of filled form', resolved: text });
                return candidate;
            }
            return null;
        };`,
        `const resolveClickTarget = async (locator, label, role, name) => {
            const count = await locator.count().catch(() => 1);
            if (count === 1) {
                const preferred = await preferFilledFormSubmit(locator);
                if (preferred) { return preferred; }
            }
            if (count === 0) {
                const adapted = await findIntentEquivalent(role, name);
                if (adapted) { return adapted; }
                return locator;
            }
            if (count <= 1) { return locator; }
            ambiguousTargets.push({ target: label, matches: count });
            let best = null;
            let bestScore = -1;
            for (let index = 0; index < count; index++) {
                const candidate = locator.nth(index);
                const usable = await candidate.isVisible().catch(() => false)
                    && await candidate.isEnabled().catch(() => false);
                if (!usable) { continue; }
                // Once a form has been filled, the intended target is that form's own submit
                // control, not a same-labelled CTA elsewhere on the page (a header "Create ticket"
                // button next to the form's "Create ticket" submit is a legitimate design).
                const inForm = await candidate.evaluate(el => Boolean(el.closest('form'))).catch(() => false);
                const isSubmit = await candidate.evaluate(
                    el => el.getAttribute('type') === 'submit').catch(() => false);
                const score = (formFieldsFilled > 0 && inForm ? 4 : 0) + (isSubmit ? 2 : 0) + 1;
                if (score > bestScore) { bestScore = score; best = candidate; }
            }
            return best ?? locator.first();
        };`,
        'const formFieldsFilled = [];',
        'const formFieldsUnsatisfiable = [];',
        'let invalidFields = [];',
        // Discover the form at runtime instead of hard-coding a field list. A generated app is free
        // to invent required fields the prompt never specified, and that must not read as a defect.
        'const discoverFields = async (scope) => await page.evaluate((scopeSelector) => {',
        'const root = scopeSelector ? document.querySelector(scopeSelector) : document;',
        'if (!root) return [];',
        "const controls = Array.from(root.querySelectorAll('input, textarea, select'));",
        'const labelFor = (el) => {',
        "let text = el.getAttribute('aria-label') || '';",
        "if (!text && el.getAttribute('aria-labelledby')) { const owner = document.getElementById(el.getAttribute('aria-labelledby')); if (owner) text = owner.textContent || ''; }",
        "if (!text && el.id) { const tag = document.querySelector('label[for=\"' + CSS.escape(el.id) + '\"]'); if (tag) text = tag.textContent || ''; }",
        "if (!text) { const wrapper = el.closest('label'); if (wrapper) text = wrapper.textContent || ''; }",
        // Fluent UI and similar wrappers render the label as a sibling rather than a `for` target.
        "if (!text) { const field = el.closest('.fui-Field, [class*=\"Field\"]'); if (field) { const tag = field.querySelector('label'); if (tag) text = tag.textContent || ''; } }",
        "if (!text) text = el.getAttribute('placeholder') || el.name || '';",
        "return text.replace(/\\s+/g, ' ').trim();",
        '};',
        'return controls.map((el, index) => {',
        "el.setAttribute('data-cor-probe-field', String(index));",
        'const style = globalThis.getComputedStyle(el);',
        'return {',
        'key: index,',
        'label: labelFor(el),',
        'tag: el.tagName.toLowerCase(),',
        "type: (el.getAttribute('type') || '').toLowerCase(),",
        'required: el.required || el.getAttribute(\'aria-required\') === \'true\',',
        'disabled: el.disabled,',
        'readOnly: Boolean(el.readOnly),',
        "hidden: style.display === 'none' || style.visibility === 'hidden' || el.type === 'hidden',",
        "hasValue: Boolean(el.value),",
        "pattern: el.getAttribute('pattern') || '',",
        "placeholder: el.getAttribute('placeholder') || '',",
        "options: el.tagName.toLowerCase() === 'select' ? Array.from(el.options).map(option => option.value).filter(Boolean) : [],",
        '};',
        '});',
        '}, scope ?? null);',
        // Synthesize a value the control will actually accept, so discovery does not stall on
        // formats the scenario never mentioned.
        'const synthesizeValue = (field) => {',
        'if (field.options.length) return field.options[0];',
        'const hint = (field.label + \' \' + field.placeholder).toLowerCase();',
        "if (field.type === 'email' || /e-?mail/.test(hint)) return 'evaluation.user@example.com';",
        "if (field.type === 'number' || field.type === 'range') return '1';",
        "if (field.type === 'tel' || /phone/.test(hint)) return '5555550123';",
        "if (field.type === 'url' || /url|website/.test(hint)) return 'https://example.com';",
        "if (field.type === 'date') return '2026-01-15';",
        "if (field.type === 'datetime-local') return '2026-01-15T09:00';",
        "if (field.type === 'time') return '09:00';",
        "if (field.type === 'password') return 'Evaluation!1';",
        // A raw identifier cannot be invented so that it matches a real row; record it and try
        // anyway, so the report names the reason instead of timing out on an assertion.
        "if (/uuid|guid/.test(hint)) return '00000000-0000-4000-8000-000000000000';",
        "return 'Evaluation ' + (field.label || 'value');",
        '};',
        // A generated field may constrain its format. Try to satisfy it before reporting, so only a
        // genuinely uncompletable control is recorded against the project.
        'const applyPattern = (field, value) => {',
        'if (!field.pattern) return value;',
        "let expression; try { expression = new RegExp('^(?:' + field.pattern + ')$'); } catch { return value; }",
        'if (expression.test(value)) return value;',
        "for (const candidate of ['00000000-0000-4000-8000-000000000000', '12345', '1', '2026-01-15', 'evaluation.user@example.com', 'Evaluation']) { if (expression.test(candidate)) return candidate; }",
        "for (let length = 1; length <= 16; length++) { const digits = '1'.repeat(length); if (expression.test(digits)) return digits; }",
        "formFieldsUnsatisfiable.push(field.label + ' (no value satisfies pattern ' + field.pattern + ')');",
        'return value;',
        '};',
        'const fillDiscoveredForm = async (values, scope) => {',
        // A click that changes route renders the form asynchronously. Discovering once, immediately,
        // finds nothing, fills nothing, and still reports the action as completed - which is how a
        // working create flow gets scored as a product failure. Wait for the form to actually exist.
        "const fillable = (field) => !field.disabled && !field.hidden",
        "    && !['checkbox', 'radio', 'file', 'submit', 'button', 'image', 'reset'].includes(field.type);",
        'let fields = [];',
        'const formDeadline = Date.now() + 15000;',
        'while (Date.now() < formDeadline) {',
        'fields = await discoverFields(scope);',
        'if (fields.some(fillable)) break;',
        'await page.waitForTimeout(250);',
        '}',
        "if (!fields.some(fillable)) { formFieldsUnsatisfiable.push('(no fillable form field appeared within 15s"
        + " of the form action)'); }",
        'for (const field of fields) {',
        'if (field.disabled || field.hidden) continue;',
        "if (['checkbox', 'radio', 'file', 'submit', 'button', 'image', 'reset'].includes(field.type)) continue;",
        'const match = Object.keys(values).find(key => field.label.toLowerCase().includes(key.toLowerCase()));',
        // Fill what the scenario asked for, plus whatever else the app decided to require.
        'if (match === undefined && !field.required) continue;',
        'if (field.readOnly) { if (!field.hasValue) formFieldsUnsatisfiable.push(field.label + \' (read-only)\'); continue; }',
        'const value = applyPattern(field, match === undefined ? synthesizeValue(field) : values[match]);',
        "if (/uuid|guid/.test((field.label + ' ' + field.placeholder).toLowerCase()) && match === undefined) formFieldsUnsatisfiable.push(field.label + ' (expects an opaque identifier with no picker)');",
        'const locator = page.locator(\'[data-cor-probe-field="\' + field.key + \'"]\');',
        'try {',
        "if (field.tag === 'select') await locator.selectOption(value, { timeout: 5000 });",
        'else await locator.fill(value, { timeout: 5000 });',
        "formFieldsFilled.push(field.label + '=' + value);",
        "} catch (error) { formFieldsUnsatisfiable.push(field.label + ' (' + (error instanceof Error ? error.message.split('\\n')[0] : String(error)) + ')'); }",
        '}',
        '};',
        // Naming the controls the browser itself rejected turns a generic assertion timeout into a
        // precise statement about which field blocked submission.
        'const collectInvalidFields = async () => await page.evaluate(() => Array.from(document.querySelectorAll(\':invalid\')).slice(0, 10).map(el => {',
        "const label = el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('placeholder') || el.tagName.toLowerCase();",
        "return label + (el.validationMessage ? ': ' + el.validationMessage : '');",
        '})).catch(() => []);',
        'let page;',
        // An action that leaves the URL and the rendered text untouched did not do what the
        // contract asked, even when Playwright reported no error. Clicking a mis-resolved target
        // is silent, so effect has to be observed rather than assumed.
        "const pageSignature = async () => { try { return page.url() + '|' + (await page.locator('body').innerText()).length; } catch { return 'unavailable'; } };",
        'const recordEffect = async (action, before) => {',
        'const after = await pageSignature();',
        "const effective = before === 'unavailable' || after !== before;",
        'if (effective) actionsEffective++;',
        "actionLedger.push(effective ? { action, effective: true } : { action, effective: false, reason: 'the page did not change' });",
        '};',
        'let accessibilityScanned = false;',
        'let accessibilityScanError;',
        'const scanAccessibility = async () => {',
        'if (!page) return [];',
        'try {',
        'await page.addScriptTag({ content: axe.source });',
                // Fluent UI's focus manager (tabster) injects `<i data-tabster-dummy aria-hidden tabindex>`
        // sentinels that axe reports as `aria-hidden-focus`. They are library internals the
        // generated app neither writes nor can remove, so scoring them would fail every Fluent UI
        // frontend for a defect it cannot fix. App-authored rules stay at zero tolerance.
        "const accessibility = await page.evaluate(async () => await globalThis.axe.run({ exclude: [['[data-tabster-dummy]']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }));",
        'accessibilityScanned = true;',
        "return accessibility.violations.filter(value => value.impact === 'serious' || value.impact === 'critical').map(value => value.id + ':' + value.impact + ' [' + value.nodes.slice(0, 3).flatMap(node => node.target).join(', ') + ']');",
        '} catch (error) { accessibilityScanError = error instanceof Error ? error.message : String(error); return []; }',
        '};',
        'const browser = await chromium.launch({ headless: true });',
        'let loadPassed = false;',
        "let journeyStatus = 'not-attempted';",
        'let journeyError;',
        'try {',
        `page = await browser.newPage({ viewport: ${JSON.stringify(viewport)} });`,
        "page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });",
        "page.on('pageerror', error => consoleErrors.push(error.message));",
        `const response = await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 60000 });`,
        "if (!response || !response.ok()) throw new Error('Browser navigation failed with status ' + (response?.status() ?? 'none') + '.');",
        "await page.locator('body').waitFor({ state: 'visible', timeout: 15000 });",
        // The load contract is evaluated before the journey drives the UI. These assertions are
        // entirely app-controlled, so a failure here is always a real defect; running them first
        // means a mis-resolved selector can never hide the fact that the app rendered correctly.
        "const landingTitle = await page.title();",
        "const landingBodyText = (await page.locator('body').innerText()).trim();",
        "if (!landingBodyText) throw new Error('Rendered page body is empty.');",
        expectedText
            ? `if (!landingBodyText.toLowerCase().includes(${JSON.stringify(expectedText)})) throw new Error(${JSON.stringify(`Rendered page does not include expected text "${contract.expectedText}".`)});`
            : '',
        "const interactiveElements = await page.locator('a[href], button, input, select, textarea').count();",
        requireInteractive
            ? "if (interactiveElements === 0) throw new Error('Rendered page has no interactive elements.');"
            : '',
        'loadPassed = true;',
        // Everything below drives a UI whose labels the prompt never specified. Failures are
        // recorded as journey evidence; whether they fail the probe is the contract's decision.
        'try {',
        ...actions.map(action => {
            const label = JSON.stringify(action.kind === 'fillForm'
                ? `fillForm ${Object.keys(action.values ?? {}).join(', ')}`
                : `${action.kind} ${action.selector ?? ''}`);
            if (action.kind === 'fillForm') {
                // A form fill that filled nothing is not a completed action. Counting it was how a
                // probe reported "3/3 actions completed" with an empty formFieldsFilled list, and
                // it pushed the real diagnosis downstream into an opaque assertion timeout.
                return `{ const before = formFieldsFilled.length; `
                    + `await fillDiscoveredForm(${JSON.stringify(action.values ?? {})}, `
                    + `${action.scope ? JSON.stringify(action.scope) : 'null'}); `
                    + `if (formFieldsFilled.length === before) { `
                    + `actionLedger.push({ action: ${label}, effective: false, reason: 'no form field was filled' }); `
                    + `throw new Error('Form fill completed without filling any field.'); } `
                    + `actionsCompleted++; actionsEffective++; actionLedger.push({ action: ${label}, effective: true }); }`;
            }
            const locator = browserLocatorExpression({ ...action, selector: action.selector ?? '' });
            let statement: string;
            switch (action.kind) {
                case 'click':
                    statement = `await (await resolveClickTarget(${locator}, ${label}, ${JSON.stringify(action.selectorType === 'role' ? (action.role ?? 'button') : '')}, ${JSON.stringify(action.selectorType === 'role' ? (action.selector ?? '') : '')})).click();`;
                    break;
                case 'fill':
                    statement = `await ${locator}.fill(${JSON.stringify(action.value ?? '')});`;
                    break;
                case 'select':
                    statement = `await ${locator}.selectOption(${JSON.stringify(action.value ?? '')});`;
                    break;
            }
            const tracked = `{ const before = await pageSignature(); ${statement} `
                + `actionsCompleted++; await recordEffect(${label}, before); }`;
            if (!action.optional) {
                return tracked;
            }
            // The prompt leaves this control's shape open, so absence or read-only state is a valid
            // design decision rather than a defect. Record the skip instead of failing the probe.
            const probe = action.kind === 'click' ? 'isEnabled' : 'isEditable';
            return `if (await ${locator}.${probe}({ timeout: 2000 }).catch(() => false)) { ${tracked} } `
                + `else { actionsSkipped.push(${label}); }`;
        }),
        actions.some(action => action.kind === 'fillForm')
            ? 'invalidFields = await collectInvalidFields();'
            : '',
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
        "journeyStatus = 'passed';",
        '} catch (error) {',
        "journeyStatus = 'failed';",
        "journeyError = error instanceof Error ? error.message.split('\\n')[0] : String(error);",
        journeySeverity === 'advisory'
            ? "console.error('Browser journey did not complete (advisory): ' + journeyError);"
            : 'throw error;',
        '}',
        // Re-read after the journey so the evidence reflects where the app ended up, while the
        // gating decision above stayed pinned to the landing page.
        'const title = await page.title().catch(() => landingTitle);',
        "const bodyText = await page.locator('body').innerText().then(value => value.trim()).catch(() => landingBodyText);",
        'const seriousAccessibilityViolations = await scanAccessibility();',
        `process.stdout.write(JSON.stringify({ title, currentUrl: page.url(), bodyTextLength: bodyText.length, bodyTextExcerpt: bodyText.slice(0, 2000), interactiveElements, seriousAccessibilityViolations, accessibilityScanned, accessibilityScanError, consoleErrors: consoleErrors.slice(0, 20), loadPassed, journeyStatus, journeyError, journeySeverity: ${JSON.stringify(journeySeverity)}, actionsCompleted, actionsEffective, actionLedger, actionsSkipped, formFieldsFilled, formFieldsUnsatisfiable, invalidFields, ambiguousTargets, adaptedTargets, actionsExpected: ${actions.length}, assertionsCompleted, assertionsExpected: ${assertions.length}, viewport: ${JSON.stringify(viewport)} }));`,
        maxViolations === null
            ? ''
            : `if (seriousAccessibilityViolations.length > ${maxViolations}) { console.error('Accessibility violations exceeded ${maxViolations}: ' + seriousAccessibilityViolations.join(', ')); process.exitCode = 1; }`,
        '} catch (error) {',
        "const bodyText = page ? await page.locator('body').innerText().catch(() => '') : '';",
        "const title = page ? await page.title().catch(() => '') : '';",
        'const seriousAccessibilityViolations = await scanAccessibility();',
        `process.stdout.write(JSON.stringify({ title, currentUrl: page?.url(), bodyTextLength: bodyText.length, bodyTextExcerpt: bodyText.slice(0, 2000), seriousAccessibilityViolations, accessibilityScanned, accessibilityScanError, consoleErrors: consoleErrors.slice(0, 20), loadPassed, journeyStatus, journeyError, journeySeverity: ${JSON.stringify(journeySeverity)}, actionsCompleted, actionsEffective, actionLedger, actionsSkipped, formFieldsFilled, formFieldsUnsatisfiable, invalidFields, ambiguousTargets, adaptedTargets, actionsExpected: ${actions.length}, assertionsCompleted, assertionsExpected: ${assertions.length}, viewport: ${JSON.stringify(viewport)} }));`,
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

export interface DebuggerPrerequisiteCheck {
    name: string;
    command: string;
    errorMessage: string;
}

const nodeDebuggerTypes = new Set(['node', 'pwa-node', 'node-terminal']);
const defaultNodeInspectorPort = 9229;
const browserDebuggerTypes = new Set(['chrome', 'pwa-chrome', 'msedge', 'pwa-msedge']);

/**
 * A debug configuration is only evidence that F5 works if the thing it attaches to is actually
 * attachable. Each supported configuration shape is reduced to shell checks that observe the
 * live debug surface, so the `debugger` gate measures the generated project rather than the
 * evaluator's assumptions about it. Shapes we cannot observe return no checks instead of a
 * synthetic pass, which keeps the gate honest by reporting missing evidence.
 */
export function resolveDebuggerPrerequisite(
    configuration: LaunchConfiguration,
): { checks: DebuggerPrerequisiteCheck[] } | { error: string } {
    const type = typeof configuration.type === 'string' ? configuration.type.toLowerCase() : '';
    if (configuration.request === 'attach' && type === 'coreclr') {
        return resolveCoreClrPrerequisite(configuration);
    }
    if (configuration.request === 'attach' && nodeDebuggerTypes.has(type)) {
        return resolveNodeAttachPrerequisite(configuration);
    }
    if (configuration.request === 'launch' && nodeDebuggerTypes.has(type)) {
        return resolveNodeLaunchPrerequisite(configuration);
    }
    if (configuration.request === 'launch' && browserDebuggerTypes.has(type)) {
        return resolveBrowserLaunchPrerequisite(configuration);
    }
    return { checks: [] };
}

function resolveCoreClrPrerequisite(
    configuration: LaunchConfiguration,
): { checks: DebuggerPrerequisiteCheck[] } | { error: string } {
    if (typeof configuration.processName !== 'string' || !configuration.processName.trim()) {
        return { error: 'A CoreCLR attach configuration requires a literal processName.' };
    }
    const processName = configuration.processName.replace(/\.exe$/i, '');
    const processPattern = `(^|[/ ])${escapeExtendedRegex(processName)}(\\.dll)?( |$)`;
    return {
        checks: [{
            command: `pgrep -f -- ${shellQuote(processPattern)} >/dev/null`,
            name: `CoreCLR process ${processName}`,
            errorMessage: `CoreCLR attach target process "${processName}" is not running.`,
        }],
    };
}

/**
 * VS Code attaches to a Node target by reading the inspector's own HTTP endpoint, so asking that
 * endpoint for an attachable target reproduces what F5 does. A listening socket is not enough:
 * the port can accept a connection before the inspector publishes a debug target.
 */
/**
 * Node `launch` configurations expose their debug surface through an `--inspect` runtime argument
 * rather than a `port` property. Without this the gate resolved zero checks for the most common
 * Node shape, which reported "no failure" and was indistinguishable from a verified debugger.
 */
function resolveNodeLaunchPrerequisite(
    configuration: LaunchConfiguration,
): { checks: DebuggerPrerequisiteCheck[] } | { error: string } {
    const port = readInspectPort(configuration);
    if (port === undefined) {
        return { checks: [] };
    }
    return {
        checks: [{
            command: createDebuggerRetryCommand(
                `curl --silent --show-error --fail --max-time 5 http://127.0.0.1:${port}/json/list`
                + ' 2>/dev/null | grep -q webSocketDebuggerUrl',
                `Node inspector on port ${port} never published an attachable debug target.`,
            ),
            name: `Node inspector port ${port}`,
            errorMessage: `Node launch target on port ${port} is not accepting a debugger.`,
        }],
    };
}

/**
 * Accepts `--inspect`, `--inspect-brk`, and `--inspect=[host:]port` forms. A bare flag uses Node's
 * default inspector port.
 */
function readInspectPort(configuration: LaunchConfiguration): number | undefined {
    const runtimeArgs = Array.isArray(configuration.runtimeArgs)
        ? configuration.runtimeArgs.filter((value): value is string => typeof value === 'string')
        : [];
    for (const argument of runtimeArgs) {
        const match = /^--inspect(?:-brk)?(?:=(?:(?:\[[^\]]+\]|[^:]+):)?(\d+))?$/u.exec(argument.trim());
        if (!match) {
            continue;
        }
        if (match[1] === undefined) {
            return defaultNodeInspectorPort;
        }
        const parsed = Number.parseInt(match[1], 10);
        if (parsed > 0 && parsed < 65536) {
            return parsed;
        }
    }
    return undefined;
}

function resolveNodeAttachPrerequisite(
    configuration: LaunchConfiguration,
): { checks: DebuggerPrerequisiteCheck[] } | { error: string } {
    const port = readDebugPort(configuration);
    if (port === undefined) {
        return {
            error: 'A Node attach configuration requires a literal port so the debug target can be verified.',
        };
    }
    return {
        checks: [{
            command: createDebuggerRetryCommand(
                `curl --silent --show-error --fail --max-time 5 http://127.0.0.1:${port}/json/list`
                + ' 2>/dev/null | grep -q webSocketDebuggerUrl',
                `Node inspector on port ${port} never published an attachable debug target.`,
            ),
            name: `Node inspector port ${port}`,
            errorMessage: `Node attach target on port ${port} is not accepting a debugger.`,
        }],
    };
}

/**
 * A browser launch configuration has no attach target to probe, but it still fails for users in
 * two deterministic ways: the URL does not serve, or webRoot points somewhere that does not
 * exist, in which case source maps never resolve and no breakpoint ever binds.
 */
function resolveBrowserLaunchPrerequisite(
    configuration: LaunchConfiguration,
): { checks: DebuggerPrerequisiteCheck[] } | { error: string } {
    const checks: DebuggerPrerequisiteCheck[] = [];
    const url = typeof configuration.url === 'string' ? configuration.url.trim() : '';
    if (!url) {
        return { error: 'A browser launch configuration requires a literal url.' };
    }
    checks.push({
        command: createDebuggerRetryCommand(
            `curl --silent --show-error --fail --max-time 5 --output /dev/null ${shellQuote(url)}`,
            `Browser debug target ${url} never served a response.`,
        ),
        name: `Browser debug target ${url}`,
        errorMessage: `Browser debug target "${url}" is not serving, so F5 would open a dead page.`,
    });
    const webRoot = typeof configuration.webRoot === 'string'
        ? replaceWorkspaceFolder(configuration.webRoot)
        : undefined;
    if (webRoot && !webRoot.includes('${')) {
        checks.push({
            command: `test -d ${shellQuote(webRoot)}`,
            name: `Browser webRoot ${webRoot}`,
            errorMessage: `Browser debug configuration webRoot "${webRoot}" does not exist, so breakpoints cannot bind.`,
        });
    }
    return { checks };
}

function readDebugPort(configuration: LaunchConfiguration): number | undefined {
    for (const candidate of [configuration.port, configuration.attachSimplePort]) {
        if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0 && candidate < 65536) {
            return candidate;
        }
        if (typeof candidate === 'string' && /^\d+$/u.test(candidate.trim())) {
            const parsed = Number.parseInt(candidate.trim(), 10);
            if (parsed > 0 && parsed < 65536) {
                return parsed;
            }
        }
    }
    return undefined;
}

/**
 * Language workers frequently start lazily, so the debug surface can appear seconds after the
 * probes that preceded this check. Retrying keeps a slow start from being reported as a project
 * that cannot be debugged at all.
 */
function createDebuggerRetryCommand(attempt: string, timeoutMessage: string): string {
    return [
        `for i in $(seq 1 ${debuggerPrerequisiteAttempts}); do`,
        `if ${attempt}; then exit 0; fi;`,
        'sleep 1;',
        'done;',
        `printf '%s\\n' ${shellQuote(timeoutMessage)} >&2;`,
        'exit 1',
    ].join(' ');
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
    securityChecks?: LocalRuntimeSecurityResult[],
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
        securityChecks,
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

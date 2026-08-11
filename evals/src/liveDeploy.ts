/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import {
    EvaluationDefinitionProvenance,
    isEvaluationDefinitionProvenance,
} from './evaluationDefinition';

const execFileAsync = promisify(execFile);

export interface DeploymentCommandEvidence {
    command: string;
    success: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
}

export interface LiveDeploymentResult {
    outcome: 'passed' | 'failed';
    runId: string;
    environmentName: string;
    resourceGroup?: string;
    inventory?: unknown[];
    commands: DeploymentCommandEvidence[];
    cleanupVerified: boolean;
    sourceProvenance?: DeploymentSourceProvenance;
    error?: string;
}

export interface DeploymentSourceProvenance {
    evaluationArm: 'rails';
    through: 'local';
    runId: string;
    scenarioId: string;
    attempt: number;
    candidateCommit: string;
    agentAssetsHash: string;
    evaluationDefinition?: EvaluationDefinitionProvenance;
    requestedModel: string;
    observedModels: string[];
}

export interface LiveDeploymentOptions {
    workspace: string;
    subscriptionId: string;
    location: string;
    enabled: boolean;
    maxDurationMinutes?: number;
    sourceProvenance?: DeploymentSourceProvenance;
}

export interface DeploymentCommandRunner {
    run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }>;
}

interface SubscriptionState {
    resourceIds: Set<string>;
    resourceGroups: Set<string>;
}

export async function runLiveDeployment(
    options: LiveDeploymentOptions,
    runner: DeploymentCommandRunner = new DefaultDeploymentCommandRunner(),
): Promise<LiveDeploymentResult> {
    if (!options.enabled || process.env.COR_EVAL_ALLOW_LIVE_DEPLOYMENT !== 'true') {
        throw new Error('Live deployment requires both enabled=true and COR_EVAL_ALLOW_LIVE_DEPLOYMENT=true.');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(options.subscriptionId)) {
        throw new Error('A dedicated Azure subscription ID is required for live deployment.');
    }
    const runId = randomUUID();
    const environmentName = `cor-eval-${runId.slice(0, 8)}`;
    const timeoutMs = (options.maxDurationMinutes ?? 45) * 60 * 1000;
    const commands: DeploymentCommandEvidence[] = [];
    const resourceGroup = environmentName;
    let inventory: unknown[] | undefined;
    let deploymentError: string | undefined;
    let cleanupVerified: boolean;
    let environmentCreated = false;
    let initialSubscriptionState: SubscriptionState | undefined;
    const azdConfigPath = path.join(options.workspace, '.azure', 'config.json');
    const previousAzdConfig = await readOptionalFile(azdConfigPath);

    try {
        const account = await execute(runner, commands, 'az', ['account', 'show', '--query', 'id', '-o', 'tsv'], options.workspace, 30_000);
        if (account.stdout.trim().toLowerCase() !== options.subscriptionId.toLowerCase()) {
            throw new Error('Active Azure subscription does not match the dedicated evaluation subscription.');
        }
        initialSubscriptionState = await readSubscriptionState(
            runner,
            commands,
            options.workspace,
            options.subscriptionId,
        );
        const existingGroup = await execute(
            runner,
            commands,
            'az',
            ['group', 'exists', '--name', resourceGroup],
            options.workspace,
            30_000,
        );
        if (existingGroup.stdout.trim() !== 'false') {
            throw new Error(`Run-owned deployment resource group "${resourceGroup}" already exists.`);
        }
        await execute(runner, commands, 'azd', ['package'], options.workspace, timeoutMs);
        await execute(runner, commands, 'azd', ['env', 'new', environmentName, '--no-prompt'], options.workspace, 60_000);
        environmentCreated = true;
        await execute(runner, commands, 'azd', ['env', 'set', 'AZURE_SUBSCRIPTION_ID', options.subscriptionId], options.workspace, 30_000);
        await execute(runner, commands, 'azd', ['env', 'set', 'AZURE_LOCATION', options.location], options.workspace, 30_000);
        await execute(runner, commands, 'azd', ['env', 'set', 'AZURE_RESOURCE_GROUP', resourceGroup], options.workspace, 30_000);
        await execute(runner, commands, 'azd', ['up', '--no-prompt'], options.workspace, timeoutMs);
        const group = await execute(runner, commands, 'azd', ['env', 'get-value', 'AZURE_RESOURCE_GROUP'], options.workspace, 30_000);
        if (group.stdout.trim() !== resourceGroup) {
            throw new Error(
                `Deployment used resource group "${group.stdout.trim()}" instead of run-owned group "${resourceGroup}".`,
            );
        }
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        await execute(runner, commands, 'az', [
            'group', 'update',
            '--name', resourceGroup,
            '--set', `tags.cor-eval-run=${runId}`, `tags.delete-after=${expiresAt}`,
            '-o', 'none',
        ], options.workspace, 60_000);
        const listed = await execute(runner, commands, 'az', [
            'resource', 'list',
            '--resource-group', resourceGroup,
            '--query', '[].{id:id,type:type,location:location}',
            '-o', 'json',
        ], options.workspace, 60_000);
        inventory = JSON.parse(listed.stdout) as unknown[];
    } catch (error) {
        deploymentError = getErrorMessage(error);
    } finally {
        let cloudCleanupVerified = false;
        let localCleanupVerified = false;
        try {
            if (!environmentCreated) {
                cloudCleanupVerified = true;
            } else {
                await execute(runner, commands, 'azd', ['down', '--force', '--purge', '--no-prompt'], options.workspace, timeoutMs);
                const exists = await execute(runner, commands, 'az', ['group', 'exists', '--name', resourceGroup], options.workspace, 30_000);
                if (exists.stdout.trim() !== 'false') {
                    await execute(
                        runner,
                        commands,
                        'az',
                        ['group', 'delete', '--name', resourceGroup, '--yes'],
                        options.workspace,
                        timeoutMs,
                    );
                }
                if (!initialSubscriptionState) {
                    deploymentError = [
                        deploymentError,
                        'Cleanup failed: initial subscription inventory is unavailable.',
                    ].filter(Boolean).join(' ');
                } else {
                    await removeSubscriptionAdditions(
                        runner,
                        commands,
                        options.workspace,
                        options.subscriptionId,
                        initialSubscriptionState,
                        timeoutMs,
                    );
                    const finalState = await readSubscriptionState(
                        runner,
                        commands,
                        options.workspace,
                        options.subscriptionId,
                    );
                    cloudCleanupVerified = sameSet(
                        finalState.resourceIds,
                        initialSubscriptionState.resourceIds,
                    ) && sameSet(finalState.resourceGroups, initialSubscriptionState.resourceGroups);
                }
            }
        } catch (error) {
            deploymentError = [deploymentError, `Cleanup failed: ${getErrorMessage(error)}`].filter(Boolean).join(' ');
        }
        try {
            if (environmentCreated) {
                await execute(
                    runner,
                    commands,
                    'azd',
                    ['env', 'remove', environmentName, '--force'],
                    options.workspace,
                    60_000,
                );
            }
            await fs.rm(path.join(options.workspace, '.azure', environmentName), { recursive: true, force: true });
            if (previousAzdConfig === undefined) {
                await fs.rm(azdConfigPath, { force: true });
                await removeEmptyDirectory(path.dirname(azdConfigPath));
            } else {
                await fs.mkdir(path.dirname(azdConfigPath), { recursive: true });
                await fs.writeFile(azdConfigPath, previousAzdConfig);
            }
            localCleanupVerified = true;
        } catch (error) {
            deploymentError = [
                deploymentError,
                `Local deployment state cleanup failed: ${getErrorMessage(error)}`,
            ].filter(Boolean).join(' ');
        }
        cleanupVerified = cloudCleanupVerified && localCleanupVerified;
    }

    async function removeSubscriptionAdditions(
        runner: DeploymentCommandRunner,
        evidence: DeploymentCommandEvidence[],
        workspace: string,
        subscriptionId: string,
        initial: SubscriptionState,
        timeoutMs: number,
    ): Promise<void> {
        let current = await readSubscriptionState(runner, evidence, workspace, subscriptionId);
        for (const group of difference(current.resourceGroups, initial.resourceGroups)) {
            await execute(
                runner,
                evidence,
                'az',
                ['group', 'delete', '--name', group, '--yes'],
                workspace,
                timeoutMs,
            );
        }
        current = await readSubscriptionState(runner, evidence, workspace, subscriptionId);
        for (const resourceId of difference(current.resourceIds, initial.resourceIds)) {
            await execute(
                runner,
                evidence,
                'az',
                ['resource', 'delete', '--ids', resourceId],
                workspace,
                timeoutMs,
            );
        }
    }

    async function readSubscriptionState(
        runner: DeploymentCommandRunner,
        evidence: DeploymentCommandEvidence[],
        workspace: string,
        subscriptionId: string,
    ): Promise<SubscriptionState> {
        const [resources, groups] = await Promise.all([
            execute(
                runner,
                evidence,
                'az',
                ['resource', 'list', '--subscription', subscriptionId, '--query', '[].id', '-o', 'json'],
                workspace,
                60_000,
            ),
            execute(
                runner,
                evidence,
                'az',
                ['group', 'list', '--subscription', subscriptionId, '--query', '[].name', '-o', 'json'],
                workspace,
                60_000,
            ),
        ]);
        return {
            resourceIds: new Set(parseStringArray(resources.stdout, 'subscription resource inventory')),
            resourceGroups: new Set(parseStringArray(groups.stdout, 'subscription resource-group inventory')),
        };
    }

    function parseStringArray(value: string, label: string): string[] {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
            throw new Error(`Invalid ${label}.`);
        }
        return parsed as string[];
    }

    function difference(current: Set<string>, initial: Set<string>): string[] {
        return [...current].filter(value => !initial.has(value));
    }

    function sameSet(left: Set<string>, right: Set<string>): boolean {
        return left.size === right.size && [...left].every(value => right.has(value));
    }

    async function removeEmptyDirectory(directory: string): Promise<void> {
        try {
            await fs.rmdir(directory);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
                throw error;
            }
        }
    }

    async function readOptionalFile(file: string): Promise<Buffer | undefined> {
        try {
            return await fs.readFile(file);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return undefined;
            }
            throw error;
        }
    }

    return {
        outcome: !deploymentError && cleanupVerified ? 'passed' : 'failed',
        runId,
        environmentName,
        resourceGroup,
        inventory,
        commands,
        cleanupVerified,
        sourceProvenance: options.sourceProvenance,
        error: deploymentError,
    };
}

async function execute(
    runner: DeploymentCommandRunner,
    evidence: DeploymentCommandEvidence[],
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
    const started = Date.now();
    try {
        const result = await runner.run(command, args, cwd, timeoutMs);
        evidence.push({
            command: formatCommand(command, args),
            success: true,
            durationMs: Date.now() - started,
            stdout: truncate(result.stdout),
            stderr: truncate(result.stderr),
        });
        return result;
    } catch (error) {
        const value = error as Error & { stdout?: string; stderr?: string };
        evidence.push({
            command: formatCommand(command, args),
            success: false,
            durationMs: Date.now() - started,
            stdout: truncate(value.stdout ?? ''),
            stderr: truncate(value.stderr ?? getErrorMessage(error)),
        });
        throw error;
    }
}

function formatCommand(command: string, args: string[]): string {
    const redacted = args.map((arg, index) => args[index - 1] === 'AZURE_SUBSCRIPTION_ID' ? '[redacted]' : arg);
    return [command, ...redacted].join(' ');
}

function truncate(value: string): string {
    return value.length <= 20_000 ? value : `${value.slice(0, 20_000)}\n[truncated]`;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

class DefaultDeploymentCommandRunner implements DeploymentCommandRunner {
    public async run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
        return await execFileAsync(command, args, {
            cwd,
            timeout: timeoutMs,
            maxBuffer: 20 * 1024 * 1024,
            encoding: 'utf8',
        });
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const value = (name: string): string | undefined => {
        const index = args.indexOf(name);
        return index >= 0 ? args[index + 1] : undefined;
    };
    const subscriptionId = value('--subscription') ?? process.env.COR_EVAL_AZURE_SUBSCRIPTION_ID;
    const location = value('--location') ?? process.env.COR_EVAL_AZURE_LOCATION;
    const sourceResultPath = value('--source-result');
    if (!subscriptionId || !location || !sourceResultPath || !args.includes('--live')) {
        throw new Error('--live, --source-result, subscription ID, and location are required.');
    }
    const expectedWorkspace = path.join(path.dirname(path.resolve(sourceResultPath)), 'workspace');
    const workspace = path.resolve(value('--workspace') ?? expectedWorkspace);
    if (workspace !== expectedWorkspace) {
        throw new Error('--workspace must be the archived workspace beside --source-result.');
    }
    const output = path.resolve(value('--output') ?? path.join(path.dirname(workspace), 'live-deployment.json'));
    const sourceProvenance = await readSourceProvenance(sourceResultPath);
    const result = await runLiveDeployment({
        workspace,
        subscriptionId,
        location,
        enabled: true,
        sourceProvenance,
    });
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
    if (result.outcome !== 'passed') {
        process.exitCode = 1;
    }

    async function readSourceProvenance(file: string): Promise<DeploymentSourceProvenance> {
        const parsed: unknown = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
        if (!parsed || typeof parsed !== 'object') {
            throw new Error(`Invalid deployment source result: ${file}`);
        }
        const source = parsed as Record<string, unknown>;
        const observedModels = source.observedModels;
        if (
            source.evaluationArm !== 'rails'
            || typeof source.runId !== 'string'
            || typeof source.scenarioId !== 'string'
            || typeof source.attempt !== 'number'
            || typeof source.candidateCommit !== 'string'
            || typeof source.agentAssetsHash !== 'string'
            || typeof source.requestedModel !== 'string'
            || !Array.isArray(observedModels)
            || observedModels.some(model => typeof model !== 'string')
            || (source.evaluationDefinition !== undefined
                && !isEvaluationDefinitionProvenance(source.evaluationDefinition))
        ) {
            throw new Error(`Invalid deployment source provenance: ${file}`);
        }
        return {
            evaluationArm: 'rails',
            through: 'local',
            runId: source.runId,
            scenarioId: source.scenarioId,
            attempt: source.attempt,
            candidateCommit: source.candidateCommit,
            agentAssetsHash: source.agentAssetsHash,
            evaluationDefinition: source.evaluationDefinition as EvaluationDefinitionProvenance | undefined,
            requestedModel: source.requestedModel,
            observedModels: observedModels as string[],
        };
    }
}

if (require.main === module) {
    void main().catch(error => {
        console.error(getErrorMessage(error));
        process.exitCode = 1;
    });
}

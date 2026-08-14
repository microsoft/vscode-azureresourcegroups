/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import { validateDeploymentArtifacts } from './artifacts/deployment';
import { ArtifactValidationIssue } from './artifacts/validationTypes';

/**
 * Tier 1 deployment evidence: does Copilot on Rails produce deployment artifacts that
 * `azd` itself accepts? This is the product's own responsibility boundary — the
 * azure-deploy agent declares `azd package` a mandatory step before reporting the
 * deployment ready — so it is graded without provisioning any Azure resources.
 */

export type DeploymentReadinessFailureCode =
    | 'deploymentPlanMissing'
    | 'deploymentArtifactsInvalid'
    | 'azdUnavailable'
    | 'containerRuntimeUnavailable'
    | 'deploymentNetworkBlocked'
    | 'azdPackageFailed'
    | 'deploymentRunnerError';

export interface DeploymentReadinessCommandResult {
    kind: 'deployment';
    name: string;
    command: string;
    success: boolean;
    failureKind?: 'commandExit' | 'runnerError';
    durationMs: number;
    stdout: string;
    stderr: string;
}

export interface DeploymentReadinessResult {
    outcome: 'passed' | 'failed';
    failureCode?: DeploymentReadinessFailureCode;
    error?: string;
    issues: ArtifactValidationIssue[];
    commands: DeploymentReadinessCommandResult[];
    infrastructure: 'bicep' | 'terraform' | 'missing';
    serviceNames: string[];
}

export interface DeploymentReadinessCommandRunner {
    run(name: string, command: string, timeoutMs: number): Promise<{
        success: boolean;
        failureKind?: 'commandExit' | 'runnerError';
        stdout: string;
        stderr: string;
    }>;
}

export interface DeploymentReadinessOptions {
    workspace: string;
    planPath?: string;
    azdPackageTimeoutMs?: number;
    azdVersionTimeoutMs?: number;
}

const defaultAzdPackageTimeoutMs = 10 * 60 * 1000;
const defaultAzdVersionTimeoutMs = 60 * 1000;

/**
 * `azd` is not part of any sandbox disk image, so a deployment run has to provision it
 * before the agent's own `azd package` step can succeed. Pinning to the documented
 * installer keeps this reproducible across disk images.
 */
export function createAzdInstallCommand(): string {
    return 'command -v azd >/dev/null 2>&1 || curl -fsSL https://aka.ms/install-azd.sh | bash';
}

export function createAzdVersionCommand(): string {
    return 'azd version';
}

/**
 * `azd package` refuses to run without a selected environment and cannot be answered
 * non-interactively. Setting `AZURE_ENV_NAME` makes azd create and select one on demand,
 * which needs neither an Azure login nor a subscription because packaging is local.
 */
export function createAzdPackageCommand(environmentName = 'coreval'): string {
    return `AZURE_ENV_NAME=${environmentName} azd package --no-prompt`;
}

export async function evaluateDeploymentReadiness(
    options: DeploymentReadinessOptions,
    runner: DeploymentReadinessCommandRunner,
): Promise<DeploymentReadinessResult> {
    const commands: DeploymentReadinessCommandResult[] = [];
    const planPath = options.planPath ?? path.join(options.workspace, '.azure', 'deployment-plan.md');
    const planContent = await readOptionalFile(planPath);
    if (planContent === undefined) {
        return {
            outcome: 'failed',
            failureCode: 'deploymentPlanMissing',
            error: `Deployment evidence requires ${path.relative(options.workspace, planPath)}.`,
            issues: [],
            commands,
            infrastructure: 'missing',
            serviceNames: [],
        };
    }

    const validation = await validateDeploymentArtifacts(options.workspace, planContent);
    if (!validation.valid) {
        return {
            outcome: 'failed',
            failureCode: 'deploymentArtifactsInvalid',
            error: validation.issues.map(issue => `${issue.code}: ${issue.message}`).join('; '),
            issues: validation.issues,
            commands,
            infrastructure: validation.infrastructure,
            serviceNames: validation.serviceNames,
        };
    }

    const base = {
        issues: validation.issues,
        commands,
        infrastructure: validation.infrastructure,
        serviceNames: validation.serviceNames,
    };

    const version = await runCommand(
        runner,
        commands,
        'azd toolchain',
        createAzdVersionCommand(),
        options.azdVersionTimeoutMs ?? defaultAzdVersionTimeoutMs,
    );
    if (!version.success) {
        return {
            ...base,
            outcome: 'failed',
            failureCode: 'azdUnavailable',
            error: describeFailure(version) || 'azd is not available.',
        };
    }

    const packaged = await runCommand(
        runner,
        commands,
        'azd package',
        createAzdPackageCommand(),
        options.azdPackageTimeoutMs ?? defaultAzdPackageTimeoutMs,
    );
    if (!packaged.success) {
        return {
            ...base,
            outcome: 'failed',
            failureCode: classifyPackageFailure(packaged),
            error: describeFailure(packaged) || 'azd package failed.',
        };
    }

    return { ...base, outcome: 'passed' };
}

/**
 * A stopped container runtime is a property of the host, not of the generated project, so
 * it must never be recorded as a Copilot on Rails defect.
 */
function classifyPackageFailure(result: DeploymentReadinessCommandResult): DeploymentReadinessFailureCode {
    if (result.failureKind === 'runnerError') {
        return 'deploymentRunnerError';
    }
    const output = `${result.stdout}\n${result.stderr}`;
    if (/container runtime \(Docker\/Podman\) is not running|cannot connect to the docker daemon|docker service is not running/i.test(output)) {
        return 'containerRuntimeUnavailable';
    }
    if (isNetworkBlocked(output)) {
        return 'deploymentNetworkBlocked';
    }
    return 'azdPackageFailed';
}

/**
 * Deny-default egress makes azd's own downloads fail in ways that look like build errors.
 * Attributing those to the generated project would blame Copilot for the sandbox policy.
 */
function isNetworkBlocked(output: string): boolean {
    return /downloading pack: http error \d{3}|http error 403|no such host|i\/o timeout|connection refused|TLS handshake timeout|proxyconnect|network is unreachable|could not resolve host/i.test(output);
}

/**
 * `azd` writes an upgrade notice to stderr on every invocation, so the first line is
 * routinely a version banner rather than the diagnosis.
 */
function describeFailure(result: DeploymentReadinessCommandResult): string {
    const lines = `${result.stderr}\n${result.stdout}`
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !/^(?:Update available|To update, run|WARNING: )/i.test(line));
    return lines.find(line => /^ERROR:/i.test(line)) ?? lines[0] ?? '';
}

/**
 * `azd` failures caused by the host rather than by generated artifacts must not count
 * against the product success rate, mirroring how local-runtime infrastructure codes are
 * excluded from the denominator.
 */
export function isDeploymentInfrastructureFailureCode(value: string | undefined): boolean {
    return value === 'azdUnavailable'
        || value === 'containerRuntimeUnavailable'
        || value === 'deploymentNetworkBlocked'
        || value === 'deploymentRunnerError'
        // The deploy agent's `azure-prepare` skill is an external dependency of the evaluation
        // host, not something the generated project controls.
        || value === 'deploymentSkillUnavailable';
}

async function runCommand(
    runner: DeploymentReadinessCommandRunner,
    commands: DeploymentReadinessCommandResult[],
    name: string,
    command: string,
    timeoutMs: number,
): Promise<DeploymentReadinessCommandResult> {
    const started = Date.now();
    try {
        const result = await runner.run(name, command, timeoutMs);
        const entry: DeploymentReadinessCommandResult = {
            kind: 'deployment',
            name,
            command,
            success: result.success,
            failureKind: result.success ? undefined : result.failureKind ?? 'commandExit',
            durationMs: Date.now() - started,
            stdout: result.stdout,
            stderr: result.stderr,
        };
        commands.push(entry);
        return entry;
    } catch (error) {
        const entry: DeploymentReadinessCommandResult = {
            kind: 'deployment',
            name,
            command,
            success: false,
            failureKind: 'runnerError',
            durationMs: Date.now() - started,
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
        };
        commands.push(entry);
        return entry;
    }
}

async function readOptionalFile(file: string): Promise<string | undefined> {
    try {
        return await fs.readFile(file, 'utf8');
    } catch {
        return undefined;
    }
}


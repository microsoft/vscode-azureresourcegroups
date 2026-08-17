/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    AcaCommandRunner,
    createSandboxManifest,
    createWorkspaceArchive,
    DefaultAcaCommandRunner,
    readSandboxId,
    readSandboxIds,
} from './SandboxProjectValidator';
import {
    parsePlannedConfigurations,
    targetMatches,
} from './SandboxLocalRuntimeValidator';
import { CorEvaluationScenario, DebugParityContract } from './scenario';
import { EvaluationDefinitionProvenance } from './evaluationDefinition';

const resultPrefix = 'COR_VSCODE_PARITY_RESULT=';

export interface VsCodeParityEvidence {
    outcome: 'passed';
    configurationName: string;
    source: string;
    line: number;
    column: number;
    sessions: { id: string; name: string; type: string }[];
    stoppedReason?: string;
    hitBreakpointIds: number[];
}

export interface SandboxVsCodeParityResult {
    outcome: 'passed' | 'failed' | 'skipped';
    failureCode?: 'paritySpecMissing' | 'parityTargetMissing' | 'paritySandboxCreateFailed' | 'paritySetupFailed' | 'parityExecutionFailed' | 'parityEvidenceInvalid' | 'parityCleanupFailed';
    error?: string;
    codeVersion?: string;
    evidence?: VsCodeParityEvidence;
    sourceProvenance?: {
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
        debugParity: DebugParityContract;
    };
}

export class SandboxVsCodeParityValidator {
    public constructor(
        private readonly repoRoot: string,
        private readonly aca: AcaCommandRunner = new DefaultAcaCommandRunner(),
    ) {
    }

    public async validate(
        workspace: string,
        scenario: CorEvaluationScenario,
        debugPlanContent: string,
    ): Promise<SandboxVsCodeParityResult> {
        const contract = scenario.acceptance?.local?.debugParity;
        if (!contract) {
            return { outcome: 'skipped', failureCode: 'paritySpecMissing', error: 'Scenario has no VS Code debug parity contract.' };
        }
        const matches = parsePlannedConfigurations(debugPlanContent)
            .filter(configuration => targetMatches(contract.target, configuration));
        if (matches.length !== 1) {
            return {
                outcome: 'failed',
                failureCode: 'parityTargetMissing',
                error: `Debug parity target "${contract.target}" matched ${matches.length} configurations; exactly one is required.`,
            };
        }

        const runLabel = randomUUID();
        const manifestPath = path.join(os.tmpdir(), `cor-vscode-parity-${runLabel}.yaml`);
        const workspaceArchive = path.join(os.tmpdir(), `cor-vscode-parity-workspace-${runLabel}.tar.gz`);
        const parityArchive = path.join(os.tmpdir(), `cor-vscode-parity-extension-${runLabel}.tar.gz`);
        let sandboxId: string | undefined;
        let result: SandboxVsCodeParityResult;
        try {
            await Promise.all([
                createWorkspaceArchive(workspace, workspaceArchive),
                createWorkspaceArchive(path.join(this.repoRoot, 'evals', 'vscode-parity'), parityArchive),
                createSandboxManifest(path.join(this.repoRoot, 'evals', 'sandbox.yaml'), manifestPath, runLabel),
            ]);
            try {
                await this.aca.run(['sandbox', 'validate', '--file', manifestPath], 60_000);
                const created = await this.aca.run([
                    'sandbox', 'apply',
                    '--file', manifestPath,
                    '--wait-timeout', '300',
                    '-o', 'json',
                ], 6 * 60_000);
                sandboxId = readSandboxId(created.stdout);
            } catch (error) {
                const cleanupError = await this.cleanupCreatedSandbox(error, runLabel);
                return failure(
                    'paritySandboxCreateFailed',
                    cleanupError
                        ? new Error(`${getErrorMessage(error)} Cleanup failed: ${cleanupError}`)
                        : error,
                );
            }

            try {
                await this.aca.run([
                    'sandbox', 'exec', '--id', sandboxId, '-c',
                    'if ! ldconfig -p | grep -q libgtk-3.so.0; then sudo sed -i "s|http://archive.ubuntu.com|https://archive.ubuntu.com|g; s|http://security.ubuntu.com|https://security.ubuntu.com|g" /etc/apt/sources.list.d/ubuntu.sources && sudo apt-get update -qq -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/ubuntu.sources -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0 && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/ubuntu.sources -o Dir::Etc::sourceparts=- libgtk-3-0 libnss3 libasound2t64 libxss1 libgbm1; fi',
                ], 5 * 60_000);
                await this.aca.run([
                    'sandbox', 'exec', '--id', sandboxId, '-c',
                    'if [ ! -x /home/vscode/.cor-vscode/VSCode-linux-x64/bin/code ]; then mkdir -p /home/vscode/.cor-vscode && curl -fsSL https://update.code.visualstudio.com/1.106.3/linux-x64/stable -o /tmp/cor-vscode.tar.gz && tar -xzf /tmp/cor-vscode.tar.gz -C /home/vscode/.cor-vscode; fi',
                ], 5 * 60_000);
                const codeVersion = (await this.aca.run([
                    'sandbox', 'exec', '--id', sandboxId, '-c',
                    'node -p "require(\'/home/vscode/.cor-vscode/VSCode-linux-x64/resources/app/package.json\').version"',
                ], 60_000)).stdout.trim();
                await this.aca.run([
                    'sandbox', 'exec', '--id', sandboxId, '-c',
                    'mkdir -p /tmp/cor-vscode-extensions /tmp/cor-vscode-vsix/resource-groups /tmp/cor-vscode-vsix/functions && curl -fsSL https://ms-azuretools.gallerycdn.vsassets.io/extensions/ms-azuretools/vscode-azureresourcegroups/0.12.7/1781209805226/Microsoft.VisualStudio.Services.VSIXPackage -o /tmp/vscode-azureresourcegroups.vsix && curl -fsSL https://ms-azuretools.gallerycdn.vsassets.io/extensions/ms-azuretools/vscode-azurefunctions/1.22.0/1780435477995/Microsoft.VisualStudio.Services.VSIXPackage -o /tmp/vscode-azurefunctions.vsix && unzip -q /tmp/vscode-azureresourcegroups.vsix "extension/*" -d /tmp/cor-vscode-vsix/resource-groups && unzip -q /tmp/vscode-azurefunctions.vsix "extension/*" -d /tmp/cor-vscode-vsix/functions && mv /tmp/cor-vscode-vsix/resource-groups/extension /tmp/cor-vscode-extensions/ms-azuretools.vscode-azureresourcegroups-0.12.7 && mv /tmp/cor-vscode-vsix/functions/extension /tmp/cor-vscode-extensions/ms-azuretools.vscode-azurefunctions-1.22.0',
                ], 5 * 60_000);
                await Promise.all([
                    this.aca.run([
                        'sandbox', 'fs', 'write', '--id', sandboxId,
                        '--path', '/tmp/workspace.tar.gz', '--file', workspaceArchive,
                    ], 5 * 60_000),
                    this.aca.run([
                        'sandbox', 'fs', 'write', '--id', sandboxId,
                        '--path', '/tmp/parity.tar.gz', '--file', parityArchive,
                    ], 5 * 60_000),
                ]);
                await this.aca.run([
                    'sandbox', 'exec', '--id', sandboxId, '-c',
                    'mkdir -p /workspace /home/vscode/cor-vscode-parity && tar -xzf /tmp/workspace.tar.gz -C /workspace && tar -xzf /tmp/parity.tar.gz -C /home/vscode/cor-vscode-parity && cd /workspace && npm install',
                ], 5 * 60_000);
                result = { outcome: 'passed', codeVersion };
            } catch (error) {
                result = failure('paritySetupFailed', error);
            }

            if (result.outcome === 'passed') {
                const command = createParityCommand({
                    configurationName: matches[0].name,
                    sourceGlob: contract.sourceGlob,
                    lineIncludes: contract.lineIncludes,
                    triggerUrl: contract.triggerUrl,
                    timeoutMs: (contract.timeoutSeconds ?? 120) * 1000,
                });
                try {
                    const executed = await this.executeParityCommand(
                        sandboxId,
                        command,
                        (contract.timeoutSeconds ?? 120) * 2000 + 60_000,
                    );
                    try {
                        const evidence = parseParityEvidence(executed.output);
                        result = { ...result, evidence };
                    } catch (error) {
                        result = {
                            outcome: 'failed',
                            failureCode: executed.exitCode === 0 ? 'parityEvidenceInvalid' : 'parityExecutionFailed',
                            error: `${getErrorMessage(error)}\n${executed.output}`.trim(),
                            codeVersion: result.codeVersion,
                        };
                    }
                } catch (error) {
                    const output = getCommandOutput(error);
                    try {
                        const evidence = parseParityEvidence(output);
                        result = evidence.outcome === 'passed'
                            ? { ...result, evidence }
                            : failure('parityExecutionFailed', error);
                    } catch {
                        result = failure('parityExecutionFailed', error);
                    }
                }
            }
        } finally {
            await Promise.all([
                fs.rm(manifestPath, { force: true }),
                fs.rm(workspaceArchive, { force: true }),
                fs.rm(parityArchive, { force: true }),
            ]);
        }

        if (sandboxId) {
            try {
                await this.aca.run(['sandbox', 'delete', '--id', sandboxId, '--yes'], 3 * 60_000);
            } catch (error) {
                return failure('parityCleanupFailed', error);
            }
        }
        return result;
    }

    private async executeParityCommand(
        sandboxId: string,
        command: string,
        timeoutMs: number,
    ): Promise<{ output: string; exitCode: number }> {
        const logPath = '/tmp/cor-vscode-parity.log';
        const exitPath = '/tmp/cor-vscode-parity.exit';
        const resultPath = '/tmp/cor-vscode-parity-result.json';
        const wrapped = `${command}; parity_status=$?; printf '%s\\n' "$parity_status" > ${exitPath}; exit "$parity_status"`;
        await this.aca.run([
            'sandbox', 'exec', '--id', sandboxId,
            '--working-directory', '/workspace',
            '-c', `rm -f ${logPath} ${exitPath} ${resultPath}; nohup sh -c ${shellQuote(wrapped)} > ${logPath} 2>&1 < /dev/null & echo $!`,
        ], 60_000);

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const status = await this.aca.run([
                'sandbox', 'exec', '--id', sandboxId, '-c',
                `cat ${exitPath} 2>/dev/null || true`,
            ], 60_000);
            const rawExitCode = status.stdout.trim();
            const exitCode = Number(rawExitCode);
            if (rawExitCode && Number.isInteger(exitCode)) {
                const output = await this.aca.run([
                    'sandbox', 'exec', '--id', sandboxId, '-c',
                    `cat ${logPath} 2>/dev/null || true; if test -f ${resultPath}; then printf '\\n${resultPrefix}'; cat ${resultPath}; fi`,
                ], 60_000);
                return { output: `${output.stdout}\n${output.stderr}`.trim(), exitCode };
            }
            await new Promise(resolve => setTimeout(resolve, 2_000));
        }

        const output = await this.aca.run([
            'sandbox', 'exec', '--id', sandboxId, '-c',
            `cat ${logPath} 2>/dev/null || true`,
        ], 60_000);
        const error = new Error(`VS Code parity timed out after ${timeoutMs}ms.`) as Error & { stdout: string };
        error.stdout = `${output.stdout}\n${output.stderr}`.trim();
        throw error;
    }

    private async cleanupCreatedSandbox(error: unknown, runLabel: string): Promise<string | undefined> {
        const ids = new Set<string>();
        try {
            ids.add(readSandboxId(getCommandOutput(error)));
        } catch {
            // Recover by the unique run label below.
        }
        let recoveryError: string | undefined;
        try {
            const listed = await this.aca.run([
                'sandbox', 'list', '-l', `run-id=${runLabel}`, '-o', 'json',
            ], 60_000);
            readSandboxIds(listed.stdout).forEach(id => ids.add(id));
        } catch (listError) {
            recoveryError = getErrorMessage(listError);
        }
        const deletionErrors = (await Promise.all([...ids].map(async id => {
            try {
                await this.aca.run(['sandbox', 'delete', '--id', id, '--yes'], 3 * 60_000);
                return undefined;
            } catch (deleteError) {
                return `${id}: ${getErrorMessage(deleteError)}`;
            }
        }))).filter((value): value is string => value !== undefined);
        return [recoveryError, ...deletionErrors].filter(Boolean).join('; ') || undefined;
    }
}

export function createParityCommand(input: {
    configurationName: string;
    sourceGlob: string;
    lineIncludes: string;
    triggerUrl: string;
    timeoutMs: number;
}): string {
    const environment: [string, string][] = [
        ['COR_PARITY_CONFIGURATION', input.configurationName],
        ['COR_PARITY_SOURCE_GLOB', input.sourceGlob],
        ['COR_PARITY_LINE_INCLUDES', input.lineIncludes],
        ['COR_PARITY_TRIGGER_URL', input.triggerUrl],
        ['COR_PARITY_TIMEOUT_MS', String(input.timeoutMs)],
        ['COR_PARITY_RESULT_PATH', '/tmp/cor-vscode-parity-result.json'],
    ];
    const variables = environment
        .map(([name, value]) => `${name}=${shellQuote(value)}`)
        .join(' ');
    return `${variables} xvfb-run -a /home/vscode/.cor-vscode/VSCode-linux-x64/code --no-sandbox --disable-gpu --disable-updates --disable-workspace-trust --skip-welcome --user-data-dir /tmp/cor-vscode-user --extensions-dir /tmp/cor-vscode-extensions --extensionDevelopmentPath=/home/vscode/cor-vscode-parity --extensionTestsPath=/home/vscode/cor-vscode-parity/test.js /workspace`;
}

export function parseParityEvidence(output: string): VsCodeParityEvidence {
    const line = output.split(/\r?\n/).find(value => value.includes(resultPrefix));
    if (!line) {
        throw new Error('VS Code parity output did not contain structured evidence.');
    }
    const parsed = JSON.parse(line.slice(line.indexOf(resultPrefix) + resultPrefix.length)) as VsCodeParityEvidence;
    if (
        parsed.outcome !== 'passed'
        || parsed.stoppedReason !== 'breakpoint'
        || !parsed.configurationName
        || !parsed.source
        || !Number.isInteger(parsed.line)
        || !Number.isInteger(parsed.column)
    ) {
        throw new Error('VS Code parity evidence did not prove a breakpoint stop.');
    }
    return parsed;
}

function failure(code: NonNullable<SandboxVsCodeParityResult['failureCode']>, error: unknown): SandboxVsCodeParityResult {
    return { outcome: 'failed', failureCode: code, error: getCommandOutput(error) };
}

function getCommandOutput(error: unknown): string {
    const value = error as { stdout?: string; stderr?: string };
    return [value.stdout, value.stderr, getErrorMessage(error)].filter(Boolean).join('\n');
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TelemetryProfiler } from '../debug/TelemetryProfiler';
import { ext } from '../extensionVariables';

/**
 * Target extension whose commands we want to benchmark.
 * We read its package.json `contributes.commands` at runtime.
 */
const targetExtensionId = 'ms-azuretools.vscode-azurefunctions';

/**
 * Commands that are destructive, require explicit tree node arguments,
 * or are otherwise unsafe to invoke in an automated benchmark.
 */
const commandDenyList: ReadonlySet<string> = new Set([
    // Destructive operations
    'azureFunctions.deleteFunctionApp',
    'azureFunctions.deleteFunction',
    'azureFunctions.deleteSlot',
    'azureFunctions.durableTaskScheduler.deleteScheduler',
    'azureFunctions.durableTaskScheduler.deleteTaskHub',
    'azureFunctions.uninstallFuncCoreTools',

    // Deployment / mutation (could modify live resources)
    'azureFunctions.deploy',
    'azureFunctions.deployProject',
    'azureFunctions.deploySlot',
    'azureFunctions.deployByFunctionAppId',
    'azureFunctions.redeploy',
    'azureFunctions.swapSlot',
    'azureFunctions.restartFunctionApp',
    'azureFunctions.startFunctionApp',
    'azureFunctions.stopFunctionApp',
    'azureFunctions.disableFunction',
    'azureFunctions.enableFunction',
    'azureFunctions.configureDeploymentSource',
    'azureFunctions.connectToGitHub',
    'azureFunctions.disconnectRepo',

    // App settings mutations
    'azureFunctions.appSettings.add',
    'azureFunctions.appSettings.delete',
    'azureFunctions.appSettings.edit',
    'azureFunctions.appSettings.rename',
    'azureFunctions.appSettings.upload',
    'azureFunctions.appSettings.toggleSlotSetting',

    // Remote debugging (connects to live resources)
    'azureFunctions.startRemoteDebug',
    'azureFunctions.startJavaRemoteDebug',

    // Streaming logs (long-running)
    'azureFunctions.startStreamingLogs',
    'azureFunctions.stopStreamingLogs',

    // Managed identity mutations
    'azureFunctions.assignManagedIdentity',
    'azureFunctions.unassignManagedIdentity',
    'azureFunctions.enableSystemIdentity',
    'azureFunctions.addLocalMIConnections',
    'azureFunctions.addRemoteMIConnections',

    // Requires specific tree node that cannot be auto-resolved
    'azureFunctions.toggleAppSettingVisibility',
    'azureFunctions.copyFunctionUrl',
    'azureFunctions.executeFunction',
    'azureFunctions.openFile',
    'azureFunctions.viewDeploymentLogs',
    'azureFunctions.viewCommitInGitHub',

    // Durable task scheduler mutations
    'azureFunctions.durableTaskScheduler.createScheduler',
    'azureFunctions.durableTaskScheduler.createTaskHub',
    'azureFunctions.durableTaskScheduler.stopEmulator',
    'azureFunctions.durableTaskScheduler.copyEmulatorConnectionString',
    'azureFunctions.durableTaskScheduler.copySchedulerConnectionString',
    'azureFunctions.durableTaskScheduler.copySchedulerEndpoint',

    // Agent internal commands (benchmarked separately if needed)
    'azureFunctions.agent.runWizardCommandWithoutExecution',
    'azureFunctions.agent.runWizardCommandWithInputs',
]);

/**
 * Per-command timeout in milliseconds.
 * Commands that show quick-picks will be cancelled after this duration.
 */
const perCommandTimeoutMs = 5_000;

interface BenchmarkResult {
    commandId: string;
    status: 'completed' | 'timeout' | 'error' | 'skipped';
    durationMs: number;
    error?: string;
}

interface BenchmarkReport {
    extensionId: string;
    timestamp: string;
    totalCommands: number;
    executed: number;
    skipped: number;
    timedOut: number;
    errored: number;
    succeeded: number;
    totalDurationMs: number;
    results: BenchmarkResult[];
    /** Telemetry profile session captured during the benchmark (if profiling was active) */
    telemetryProfilePath?: string;
}

/**
 * Runs all safe commands from the Azure Functions extension, captures timing
 * and telemetry, and writes a benchmark report to a temp JSON file.
 *
 * Automatically starts/stops the TelemetryProfiler so both the benchmark
 * summary and the granular telemetry trace are available.
 */
export async function runExtensionBenchmark(context: IActionContext): Promise<void> {
    const targetExtension = vscode.extensions.getExtension(targetExtensionId);
    if (!targetExtension) {
        void vscode.window.showErrorMessage(`Extension "${targetExtensionId}" is not installed.`);
        return;
    }

    // Ensure the target extension is activated first
    if (!targetExtension.isActive) {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Activating Azure Functions extension...' },
            () => targetExtension.activate(),
        );
    }

    // Discover all contributed commands
    const contributedCommands: string[] = getContributedCommands(targetExtension);
    if (contributedCommands.length === 0) {
        void vscode.window.showWarningMessage('No contributed commands found in the target extension.');
        return;
    }

    // Start telemetry profiling
    const profiler = TelemetryProfiler.getInstance();
    ext.context.subscriptions.push(profiler);
    const profilingWasActive = profiler.isActive;
    if (!profilingWasActive) {
        profiler.start();
    }

    const results: BenchmarkResult[] = [];
    const overallStart = Date.now();

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Running extension benchmark...',
            cancellable: true,
        },
        async (progress, token) => {
            const total = contributedCommands.length;
            for (let i = 0; i < total; i++) {
                if (token.isCancellationRequested) {
                    break;
                }

                const commandId = contributedCommands[i];
                progress.report({ message: `(${i + 1}/${total}) ${commandId}`, increment: (1 / total) * 100 });

                const result = await benchmarkSingleCommand(commandId);
                results.push(result);
            }
        },
    );

    const overallDuration = Date.now() - overallStart;

    // Stop telemetry profiling and get the file path
    let telemetryProfilePath: string | undefined;
    if (!profilingWasActive) {
        const profileUri = await profiler.stop();
        telemetryProfilePath = profileUri?.fsPath;
    }

    // Build and write the report
    const report = buildReport(targetExtensionId, results, overallDuration, telemetryProfilePath);
    const reportUri = await writeReport(report);

    ext.outputChannel.appendLog(`Benchmark report written to: ${reportUri.fsPath}`);
    if (telemetryProfilePath) {
        ext.outputChannel.appendLog(`Telemetry profile written to: ${telemetryProfilePath}`);
    }

    const doc = await vscode.workspace.openTextDocument(reportUri);
    await vscode.window.showTextDocument(doc);

    context.telemetry.properties.benchmarkTotalCommands = String(report.totalCommands);
    context.telemetry.properties.benchmarkExecuted = String(report.executed);
    context.telemetry.properties.benchmarkTimedOut = String(report.timedOut);
    context.telemetry.properties.benchmarkErrored = String(report.errored);
    context.telemetry.measurements.benchmarkTotalDurationMs = report.totalDurationMs;
}

// ── Helpers ────────────────────────────────────────────────────────

function getContributedCommands(extension: vscode.Extension<unknown>): string[] {
    const contributes = extension.packageJSON?.contributes;
    if (!contributes?.commands) {
        return [];
    }
    const commands: string[] = (contributes.commands as Array<{ command: string }>)
        .map((c) => c.command)
        .filter((id): id is string => typeof id === 'string');
    return commands;
}

async function benchmarkSingleCommand(commandId: string): Promise<BenchmarkResult> {
    if (commandDenyList.has(commandId)) {
        return { commandId, status: 'skipped', durationMs: 0 };
    }

    const start = Date.now();

    try {
        await Promise.race([
            vscode.commands.executeCommand(commandId),
            timeout(perCommandTimeoutMs),
        ]);

        return {
            commandId,
            status: 'completed',
            durationMs: Date.now() - start,
        };
    } catch (err) {
        const elapsed = Date.now() - start;

        if (err instanceof TimeoutError) {
            // Dismiss any quick-picks left open by sending an Escape
            await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
            return { commandId, status: 'timeout', durationMs: elapsed };
        }

        return {
            commandId,
            status: 'error',
            durationMs: elapsed,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

class TimeoutError extends Error {
    constructor() {
        super('Command timed out');
        this.name = 'TimeoutError';
    }
}

function timeout(ms: number): Promise<never> {
    return new Promise<never>((_, reject) => {
        setTimeout(() => reject(new TimeoutError()), ms);
    });
}

function buildReport(
    extensionId: string,
    results: BenchmarkResult[],
    totalDurationMs: number,
    telemetryProfilePath?: string,
): BenchmarkReport {
    const completed = results.filter((r) => r.status === 'completed');
    const timedOut = results.filter((r) => r.status === 'timeout');
    const errored = results.filter((r) => r.status === 'error');
    const skipped = results.filter((r) => r.status === 'skipped');

    return {
        extensionId,
        timestamp: new Date().toISOString(),
        totalCommands: results.length,
        executed: completed.length + timedOut.length + errored.length,
        skipped: skipped.length,
        timedOut: timedOut.length,
        errored: errored.length,
        succeeded: completed.length,
        totalDurationMs,
        results: results.sort((a, b) => b.durationMs - a.durationMs),
        telemetryProfilePath,
    };
}

async function writeReport(report: BenchmarkReport): Promise<vscode.Uri> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `benchmark-${timestamp}.json`;
    const filePath = path.join(os.tmpdir(), filename);
    const uri = vscode.Uri.file(filePath);

    const content = JSON.stringify(report, undefined, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));

    return uri;
}

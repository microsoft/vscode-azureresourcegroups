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
import { invalidateResourceListCache } from '../services/AzureResourcesService';
import { ResourceTreeDataProviderBase } from '../tree/ResourceTreeDataProviderBase';
import { settingUtils } from '../utils/settingUtils';

// ── Types ──────────────────────────────────────────────────────────

interface StepResult {
    /** Human-readable step name */
    name: string;
    /** Duration of the step in milliseconds */
    durationMs: number;
    /** Whether the step succeeded */
    status: 'completed' | 'error' | 'skipped';
    /** Error message if the step failed */
    error?: string;
}

interface TreeBenchmarkReport {
    timestamp: string;
    totalDurationMs: number;
    steps: StepResult[];
    /** Path to the telemetry profile captured during this benchmark */
    telemetryProfilePath?: string;
}

// ── Benchmark steps ────────────────────────────────────────────────

/**
 * Benchmark step definitions. Each step is an async function that performs
 * a single operation and is individually timed.
 */
interface BenchmarkStep {
    name: string;
    fn: () => Promise<void>;
}

/**
 * Waits for the tree data provider to complete its next root getChildren() call.
 * This is accomplished by listening for the onDidChangeTreeData event and then
 * waiting for the subsequent getChildren call via a one-shot monkey-patch.
 */
function waitForTreeLoad(timeoutMs: number = 30_000): Promise<void> {
    return new Promise<void>((resolve) => {
        // Wait for the next root-level getChildren call to complete.
        // The TelemetryProfiler already patches getChildren, so we use a
        // simple timer + polling approach based on when the tree's
        // onDidChangeTreeData fires and VS Code calls getChildren.
        //
        // Since we can't easily hook into the exact getChildren completion,
        // we use a pragmatic approach: wait for onDidChangeTreeData to fire
        // from the Azure tree, then add a brief settling delay to ensure
        // the tree has finished rendering.
        const timer = setTimeout(() => {
            disposable?.dispose();
            resolve(); // Don't reject — the tree may have already been loaded
        }, timeoutMs);

        // Listen for the Azure tree's onDidChangeTreeData
        const tdp = ext.v2.api.resources.azureResourceTreeDataProvider as unknown as ResourceTreeDataProviderBase;
        const disposable = tdp.onDidChangeTreeData?.(() => {
            // The tree data changed event fired — give VS Code time to call getChildren
            // and render the tree, then resolve.
            setTimeout(() => {
                clearTimeout(timer);
                disposable?.dispose();
                resolve();
            }, 2000);
        });

        if (!disposable) {
            // If we can't subscribe, just resolve after a small delay
            clearTimeout(timer);
            setTimeout(resolve, 3000);
        }
    });
}

/**
 * Builds the ordered list of benchmark steps:
 *
 * 1. Refresh Azure tree (cold — invalidates cache)
 * 2. Refresh Azure tree (warm — cache still valid)
 * 3. Group by Resource Type
 * 4. Refresh tree after groupBy change
 * 5. Group by Location
 * 6. Refresh tree after groupBy change
 * 7. Group by Resource Group (revert to default)
 * 8. Refresh tree after groupBy change
 * 9. Refresh Workspace tree
 * 10. Refresh Focus tree
 * 11. Refresh Tenant tree
 * 12. Select subscriptions (re-apply current selection — no-op but measures the machinery)
 */
function buildSteps(): BenchmarkStep[] {
    return [
        // ── 1. Cold refresh ──
        {
            name: '1. Refresh Azure tree (cold — cache invalidated)',
            fn: async () => {
                ext.setClearCacheOnNextLoad();
                invalidateResourceListCache();
                const loadPromise = waitForTreeLoad();
                ext.actions.refreshAzureTree();
                await loadPromise;
            },
        },

        // ── 2. Warm refresh ──
        {
            name: '2. Refresh Azure tree (warm — cached)',
            fn: async () => {
                const loadPromise = waitForTreeLoad();
                ext.actions.refreshAzureTree();
                await loadPromise;
            },
        },

        // ── 3-4. Group by Resource Type ──
        {
            name: '3. Change groupBy → resourceType',
            fn: async () => {
                await settingUtils.updateGlobalSetting('groupBy', 'resourceType');
            },
        },
        {
            name: '4. Refresh Azure tree (resourceType grouping)',
            fn: async () => {
                const loadPromise = waitForTreeLoad();
                ext.actions.refreshAzureTree();
                await loadPromise;
            },
        },

        // ── 5-6. Group by Location ──
        {
            name: '5. Change groupBy → location',
            fn: async () => {
                await settingUtils.updateGlobalSetting('groupBy', 'location');
            },
        },
        {
            name: '6. Refresh Azure tree (location grouping)',
            fn: async () => {
                const loadPromise = waitForTreeLoad();
                ext.actions.refreshAzureTree();
                await loadPromise;
            },
        },

        // ── 7-8. Revert to Resource Group ──
        {
            name: '7. Change groupBy → resourceGroup (revert to default)',
            fn: async () => {
                await settingUtils.updateGlobalSetting('groupBy', 'resourceGroup');
            },
        },
        {
            name: '8. Refresh Azure tree (resourceGroup grouping)',
            fn: async () => {
                const loadPromise = waitForTreeLoad();
                ext.actions.refreshAzureTree();
                await loadPromise;
            },
        },

        // ── 9. Workspace tree ──
        {
            name: '9. Refresh Workspace tree',
            fn: async () => {
                ext.actions.refreshWorkspaceTree();
                // Workspace tree is local-only; give a short settling time
                await delay(1000);
            },
        },

        // ── 10. Focus tree ──
        {
            name: '10. Refresh Focus tree',
            fn: async () => {
                ext.actions.refreshFocusTree();
                await delay(1000);
            },
        },

        // ── 11. Tenant tree ──
        {
            name: '11. Refresh Tenant tree',
            fn: async () => {
                ext.setClearCacheOnNextLoad();
                invalidateResourceListCache();
                ext.actions.refreshTenantTree();
                await delay(2000);
            },
        },

        // ── 12. Cold refresh (2nd pass — for consistency measurement) ──
        {
            name: '12. Refresh Azure tree (cold — 2nd pass)',
            fn: async () => {
                ext.setClearCacheOnNextLoad();
                invalidateResourceListCache();
                const loadPromise = waitForTreeLoad();
                ext.actions.refreshAzureTree();
                await loadPromise;
            },
        },
    ];
}

// ── Main command ───────────────────────────────────────────────────

/**
 * Runs a deterministic sequence of tree operations (refresh, groupBy cycling,
 * subscription toggling) with telemetry profiling to produce a consistent
 * benchmark report. Useful for measuring tree performance over time.
 *
 * Command: `azureResourceGroups.runTreeBenchmark`
 */
export async function runTreeBenchmark(context: IActionContext): Promise<void> {
    // Save the current groupBy setting so we can restore it afterward
    const originalGroupBy = settingUtils.getGlobalSetting<string>('groupBy') ?? 'resourceGroup';

    // Start telemetry profiling
    const profiler = TelemetryProfiler.getInstance();
    ext.context.subscriptions.push(profiler);
    const profilingWasAlreadyActive = profiler.isActive;
    if (!profilingWasAlreadyActive) {
        profiler.start();
    }

    const steps = buildSteps();
    const results: StepResult[] = [];
    const overallStart = Date.now();

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Running tree benchmark…',
            cancellable: true,
        },
        async (progress, token) => {
            const total = steps.length;
            for (let i = 0; i < total; i++) {
                if (token.isCancellationRequested) {
                    break;
                }

                const step = steps[i];
                progress.report({ message: `(${i + 1}/${total}) ${step.name}`, increment: (1 / total) * 100 });

                const stepStart = Date.now();
                try {
                    await step.fn();
                    results.push({
                        name: step.name,
                        durationMs: Date.now() - stepStart,
                        status: 'completed',
                    });
                } catch (err) {
                    results.push({
                        name: step.name,
                        durationMs: Date.now() - stepStart,
                        status: 'error',
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        },
    );

    const overallDuration = Date.now() - overallStart;

    // Restore original groupBy setting
    try {
        await settingUtils.updateGlobalSetting('groupBy', originalGroupBy);
    } catch {
        // Best-effort restore
    }

    // Stop telemetry profiling
    let telemetryProfilePath: string | undefined;
    if (!profilingWasAlreadyActive) {
        const profileUri = await profiler.stop();
        telemetryProfilePath = profileUri?.fsPath;
    }

    // Build and write the report
    const report: TreeBenchmarkReport = {
        timestamp: new Date().toISOString(),
        totalDurationMs: overallDuration,
        steps: results,
        telemetryProfilePath,
    };

    const reportUri = await writeReport(report);

    ext.outputChannel.appendLog(`Tree benchmark report written to: ${reportUri.fsPath}`);
    if (telemetryProfilePath) {
        ext.outputChannel.appendLog(`Telemetry profile written to: ${telemetryProfilePath}`);
    }

    const doc = await vscode.workspace.openTextDocument(reportUri);
    await vscode.window.showTextDocument(doc);

    // Record summary in telemetry
    context.telemetry.properties.treeBenchmarkStepCount = String(results.length);
    context.telemetry.properties.treeBenchmarkErrors = String(results.filter(r => r.status === 'error').length);
    context.telemetry.measurements.treeBenchmarkTotalDurationMs = overallDuration;

    for (const result of results) {
        // Create a measurement for each step so it appears in telemetry
        const key = `treeBenchmark_${result.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
        context.telemetry.measurements[key] = result.durationMs;
    }
}

// ── Helpers ────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function writeReport(report: TreeBenchmarkReport): Promise<vscode.Uri> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `tree-benchmark-${timestamp}.json`;
    const filePath = path.join(os.tmpdir(), filename);
    const uri = vscode.Uri.file(filePath);

    const content = JSON.stringify(report, undefined, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));

    return uri;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IHandlerContext, registerOnActionStartHandler, registerTelemetryHandler } from '@microsoft/vscode-azext-utils';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { extActions } from '../extensionVariables';
import { TreeDataItem } from '../tree/ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from '../tree/ResourceTreeDataProviderBase';

interface TelemetryEvent {
    eventName: string;
    startTime: string;
    duration: number;
    result: string | undefined;
    properties: Record<string, string | undefined>;
    measurements: Record<string, number | undefined>;
}

interface CommandGroup {
    commandId: string;
    startTime: string;
    endTime: string;
    /** Wall-clock duration from group start to root command completion (seconds). */
    wallClockDuration: number;
    /** Sum of individual event durations — may double-count nested events. For diagnostics only. */
    eventDurationSum: number;
    events: TelemetryEvent[];
}

/** Tracks a single call to ext.actions.refresh*() */
interface RefreshEvent {
    /** Which tree was refreshed (e.g. "AzureTree", "FocusTree") */
    treeName: string;
    /** When the refresh was triggered */
    triggerTime: string;
    /** Whether a specific node was passed (partial refresh) vs full tree refresh */
    isPartialRefresh: boolean;
    /** The command group that was active when the refresh was triggered, if any */
    triggeringCommandGroup: string | undefined;
    /** Captured stack trace showing what code path triggered the refresh */
    callerStack: string;
}

/**
 * Tracks a root-level getChildren(undefined) call on a tree data provider.
 * This is what VS Code calls after onDidChangeTreeData fires.
 */
interface TreeGetChildrenEvent {
    /** Which tree data provider (e.g. "AzureResourceTreeDataProvider") */
    treeName: string;
    /** When VS Code called getChildren */
    startTime: string;
    /** How long getChildren took (seconds) */
    duration: number;
    /** Whether getChildren was for the root (true) or a specific element */
    isRoot: boolean;
    /** Number of children returned */
    childCount: number | undefined;
    /** Error if getChildren threw */
    error: string | undefined;
}

interface ProfileSession {
    sessionStart: string;
    sessionEnd: string;
    totalEvents: number;
    totalCommandGroups: number;
    commandGroups: CommandGroup[];
    ungroupedEvents: TelemetryEvent[];
    /** All tree refresh triggers during the session */
    refreshEvents: RefreshEvent[];
    /** All tree root-level getChildren calls during the session */
    treeGetChildrenEvents: TreeGetChildrenEvent[];
    /** Summary: refresh counts and durations per tree */
    refreshSummary: Record<string, {
        refreshTriggerCount: number;
        rootGetChildrenCount: number;
        totalGetChildrenDuration: number;
        avgGetChildrenDuration: number;
        maxGetChildrenDuration: number;
        /** Which command groups triggered refreshes, with counts */
        triggeringSources: Record<string, number>;
    }>;
}

/**
 * Captures all telemetry events during a debug profiling session,
 * tracks durations, and groups sub-events under the root command that triggered them.
 *
 * Usage:
 *  1. Run "Azure: Start Telemetry Profiling"
 *  2. Perform actions in the extension
 *  3. Run "Azure: Stop Telemetry Profiling" — writes a JSON report to a temp file
 */
export class TelemetryProfiler implements vscode.Disposable {
    private static _instance: TelemetryProfiler | undefined;

    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _statusBarItem: vscode.StatusBarItem;

    private _isActive = false;
    private _sessionStart: Date | undefined;

    /** Stack depth of active `callWithTelemetryAndErrorHandling` calls */
    private _activeDepth = 0;

    /** Currently open command group (root command that triggered sub-events) */
    private _currentGroup: CommandGroup | undefined;

    /** Epoch ms when the current group started (for wall-clock measurement) */
    private _currentGroupStartMs = 0;

    /** Completed command groups */
    private _commandGroups: CommandGroup[] = [];

    /** Events that fired outside of any tracked root command */
    private _ungroupedEvents: TelemetryEvent[] = [];

    /**
     * Stack of start timestamps (pushed in onActionStart, popped in onTelemetry).
     * Since callWithTelemetryAndErrorHandling is async but events nest in call order,
     * a simple stack correctly pairs start/end for each action.
     */
    private _startTimeStack: number[] = [];

    // ── Refresh tracking ────────────────────────────────────────────

    /** All refresh trigger events recorded during the session */
    private _refreshEvents: RefreshEvent[] = [];

    /** All root-level getChildren calls recorded during the session */
    private _treeGetChildrenEvents: TreeGetChildrenEvent[] = [];

    /** Original (unwrapped) ext.actions.refresh* functions, for restoring on stop */
    private _originalRefreshFns: {
        refreshAzureTree?: typeof extActions.refreshAzureTree;
        refreshFocusTree?: typeof extActions.refreshFocusTree;
        refreshWorkspaceTree?: typeof extActions.refreshWorkspaceTree;
        refreshTenantTree?: typeof extActions.refreshTenantTree;
        refreshActivityLogTree?: typeof extActions.refreshActivityLogTree;
    } = {};

    /** Original getChildren methods on tree data providers, for restoring on stop */
    private _originalGetChildrenFns = new Map<string, ResourceTreeDataProviderBase['getChildren']>();

    private constructor() {
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
        this._statusBarItem.command = 'azureResourceGroups.stopTelemetryProfiling';
        this._statusBarItem.text = '$(record) Telemetry Profiling';
        this._statusBarItem.tooltip = 'Click to stop profiling and write results';
        this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    static getInstance(): TelemetryProfiler {
        if (!TelemetryProfiler._instance) {
            TelemetryProfiler._instance = new TelemetryProfiler();
        }
        return TelemetryProfiler._instance;
    }

    get isActive(): boolean {
        return this._isActive;
    }

    start(): void {
        if (this._isActive) {
            void vscode.window.showWarningMessage('Telemetry profiling is already active.');
            return;
        }

        this._reset();
        this._isActive = true;
        this._sessionStart = new Date();

        // Register handlers to intercept telemetry events
        const startHandler = registerOnActionStartHandler((context: IHandlerContext) => {
            if (!this._isActive) {
                return;
            }
            this._onActionStart(context);
        });

        const telemetryHandler = registerTelemetryHandler((context: IHandlerContext) => {
            if (!this._isActive) {
                return;
            }
            this._onTelemetry(context);
        });

        this._disposables.push(startHandler, telemetryHandler);

        // Install refresh tracking wrappers
        this._installRefreshTracking();

        this._statusBarItem.show();

        void vscode.window.showInformationMessage('Telemetry profiling started. Perform actions, then run "Azure: Stop Telemetry Profiling".');
    }

    async stop(): Promise<vscode.Uri | undefined> {
        if (!this._isActive) {
            void vscode.window.showWarningMessage('Telemetry profiling is not active.');
            return undefined;
        }

        this._isActive = false;
        this._statusBarItem.hide();

        // Restore original refresh functions before building session
        this._uninstallRefreshTracking();

        // If there's an open group that never completed, close it
        if (this._currentGroup) {
            this._finalizeGroup(this._currentGroup);
            this._commandGroups.push(this._currentGroup);
            this._currentGroup = undefined;
        }

        const session = this._buildSession();
        const uri = await this._writeSessionToFile(session);

        this._disposeHandlers();
        this._reset();

        return uri;
    }

    dispose(): void {
        this._isActive = false;
        this._uninstallRefreshTracking();
        this._statusBarItem.dispose();
        this._disposeHandlers();
    }

    // ── Refresh tracking helpers ────────────────────────────────────

    /**
     * Wraps all ext.actions.refresh* functions and tree data provider getChildren
     * methods to track refresh triggers and their resulting tree loads.
     */
    private _installRefreshTracking(): void {
        // 1. Wrap ext.actions.refresh* functions
        const treeNames: Array<{ key: keyof typeof extActions; name: string }> = [
            { key: 'refreshAzureTree', name: 'AzureTree' },
            { key: 'refreshFocusTree', name: 'FocusTree' },
            { key: 'refreshWorkspaceTree', name: 'WorkspaceTree' },
            { key: 'refreshTenantTree', name: 'TenantTree' },
            { key: 'refreshActivityLogTree', name: 'ActivityLogTree' },
        ];

        for (const { key, name } of treeNames) {
            const original = extActions[key];
            if (original) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this._originalRefreshFns as any)[key] = original;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (extActions as any)[key] = (data?: any) => {
                    if (this._isActive) {
                        this._recordRefreshTrigger(name, data);
                    }
                    original(data);
                };
            }
        }

        // 2. Wrap getChildren on tree data providers that extend ResourceTreeDataProviderBase.
        //    These are accessible via the VS Code tree views that the extension registers.
        //    We patch the prototype method so ALL instances are covered.
        const proto = ResourceTreeDataProviderBase.prototype;
        const originalGetChildren = proto.getChildren;
        this._originalGetChildrenFns.set('ResourceTreeDataProviderBase', originalGetChildren as never);

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const profilerInstance = this;
        proto.getChildren = async function (this: ResourceTreeDataProviderBase, element?: TreeDataItem | undefined): Promise<TreeDataItem[] | null | undefined> {
            if (!profilerInstance._isActive) {
                return originalGetChildren.call(this, element);
            }

            const isRoot = element === undefined;
            const treeName = this.constructor.name;
            const startMs = Date.now();
            let childCount: number | undefined;
            let error: string | undefined;

            try {
                const result = await originalGetChildren.call(this, element);
                childCount = result?.length;
                return result;
            } catch (e) {
                error = e instanceof Error ? e.message : String(e);
                throw e;
            } finally {
                const durationSec = (Date.now() - startMs) / 1000;
                profilerInstance._treeGetChildrenEvents.push({
                    treeName,
                    startTime: new Date(startMs).toISOString(),
                    duration: durationSec,
                    isRoot,
                    childCount,
                    error,
                });
            }
        };
    }

    /**
     * Restores original ext.actions.refresh* functions and getChildren methods.
     */
    private _uninstallRefreshTracking(): void {
        // Restore refresh functions
        for (const [key, original] of Object.entries(this._originalRefreshFns)) {
            if (original) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (extActions as any)[key] = original;
            }
        }
        this._originalRefreshFns = {};

        // Restore prototype getChildren
        const originalGetChildren = this._originalGetChildrenFns.get('ResourceTreeDataProviderBase');
        if (originalGetChildren) {
            ResourceTreeDataProviderBase.prototype.getChildren = originalGetChildren as never;
        }
        this._originalGetChildrenFns.clear();
    }

    /**
     * Records a refresh trigger event with caller stack trace.
     */
    private _recordRefreshTrigger(treeName: string, data?: unknown): void {
        // Capture a stack trace to identify what code triggered this refresh
        const stack = new Error().stack ?? '';
        // Clean up the stack: remove the first two lines (Error + _recordRefreshTrigger)
        const callerStack = stack.split('\n').slice(3).join('\n').trim();

        this._refreshEvents.push({
            treeName,
            triggerTime: new Date().toISOString(),
            isPartialRefresh: data !== undefined && data !== null,
            triggeringCommandGroup: this._currentGroup?.commandId,
            callerStack,
        });
    }

    // ── Telemetry event helpers ─────────────────────────────────────

    private _onActionStart(context: IHandlerContext): void {
        this._startTimeStack.push(Date.now());

        if (this._activeDepth === 0) {
            // This is a new root command — start a new group
            // First, save any open group
            if (this._currentGroup) {
                this._finalizeGroup(this._currentGroup);
                this._commandGroups.push(this._currentGroup);
            }
            const now = Date.now();
            this._currentGroupStartMs = now;
            this._currentGroup = {
                commandId: context.callbackId,
                startTime: new Date(now).toISOString(),
                endTime: '',
                wallClockDuration: 0,
                eventDurationSum: 0,
                events: [],
            };
        }

        this._activeDepth++;
    }

    private _onTelemetry(context: IHandlerContext): void {
        const event = this._buildEvent(context);

        if (this._currentGroup) {
            this._currentGroup.events.push(event);
        } else {
            this._ungroupedEvents.push(event);
        }

        this._activeDepth = Math.max(0, this._activeDepth - 1);

        if (this._activeDepth === 0 && this._currentGroup) {
            // Root command completed — finalize the group
            this._finalizeGroup(this._currentGroup);
            this._commandGroups.push(this._currentGroup);
            this._currentGroup = undefined;
        }
    }

    private _buildEvent(context: IHandlerContext): TelemetryEvent {
        // Pop the matching start time from our stack.
        // The telemetry handler fires in the `finally` block of callWithTelemetryAndErrorHandling,
        // which runs *before* the framework sets context.telemetry.measurements.duration,
        // so we must compute duration ourselves.
        const endTime = Date.now();
        const startTime = this._startTimeStack.pop() ?? endTime;
        const durationMs = endTime - startTime;
        const durationSec = durationMs / 1000;

        // Copy properties, converting TelemetryTrustedValue to strings
        const properties: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(context.telemetry.properties)) {
            if (value === undefined) {
                properties[key] = undefined;
            } else if (typeof value === 'string') {
                properties[key] = value;
            } else {
                // TelemetryTrustedValue — extract the inner value
                properties[key] = String(value.value ?? value);
            }
        }

        const measurements: Record<string, number | undefined> = { ...context.telemetry.measurements };
        measurements.duration = durationSec;

        return {
            eventName: context.callbackId,
            startTime: new Date(startTime).toISOString(),
            duration: durationSec,
            result: properties.result,
            properties,
            measurements,
        };
    }

    private _finalizeGroup(group: CommandGroup): void {
        const endMs = Date.now();
        group.endTime = new Date(endMs).toISOString();
        group.wallClockDuration = (endMs - this._currentGroupStartMs) / 1000;
        group.eventDurationSum = group.events.reduce((sum, e) => sum + e.duration, 0);
    }

    private _buildSession(): ProfileSession {
        const sessionEnd = new Date();
        const allEvents = this._commandGroups.flatMap(g => g.events).concat(this._ungroupedEvents);

        // Build refresh summary per tree
        const refreshSummary: ProfileSession['refreshSummary'] = {};
        for (const re of this._refreshEvents) {
            if (!refreshSummary[re.treeName]) {
                refreshSummary[re.treeName] = {
                    refreshTriggerCount: 0,
                    rootGetChildrenCount: 0,
                    totalGetChildrenDuration: 0,
                    avgGetChildrenDuration: 0,
                    maxGetChildrenDuration: 0,
                    triggeringSources: {},
                };
            }
            refreshSummary[re.treeName].refreshTriggerCount++;

            const source = re.triggeringCommandGroup ?? '(no active command)';
            refreshSummary[re.treeName].triggeringSources[source] =
                (refreshSummary[re.treeName].triggeringSources[source] ?? 0) + 1;
        }

        // Map tree data provider class names to tree names for correlation
        const classToTreeName: Record<string, string> = {
            'AzureResourceTreeDataProvider': 'AzureTree',
            'FocusViewTreeDataProvider': 'FocusTree',
            'WorkspaceResourceTreeDataProvider': 'WorkspaceTree',
            'TenantResourceTreeDataProvider': 'TenantTree',
            'ActivityLogTreeDataProvider': 'ActivityLogTree',
        };

        for (const gce of this._treeGetChildrenEvents) {
            if (!gce.isRoot) {
                continue;
            }

            const treeName = classToTreeName[gce.treeName] ?? gce.treeName;
            if (!refreshSummary[treeName]) {
                refreshSummary[treeName] = {
                    refreshTriggerCount: 0,
                    rootGetChildrenCount: 0,
                    totalGetChildrenDuration: 0,
                    avgGetChildrenDuration: 0,
                    maxGetChildrenDuration: 0,
                    triggeringSources: {},
                };
            }
            refreshSummary[treeName].rootGetChildrenCount++;
            refreshSummary[treeName].totalGetChildrenDuration += gce.duration;
            refreshSummary[treeName].maxGetChildrenDuration = Math.max(
                refreshSummary[treeName].maxGetChildrenDuration, gce.duration);
        }

        // Compute averages
        for (const summary of Object.values(refreshSummary)) {
            if (summary.rootGetChildrenCount > 0) {
                summary.avgGetChildrenDuration = summary.totalGetChildrenDuration / summary.rootGetChildrenCount;
            }
        }

        return {
            sessionStart: this._sessionStart?.toISOString() ?? sessionEnd.toISOString(),
            sessionEnd: sessionEnd.toISOString(),
            totalEvents: allEvents.length,
            totalCommandGroups: this._commandGroups.length,
            commandGroups: this._commandGroups,
            ungroupedEvents: this._ungroupedEvents,
            refreshEvents: this._refreshEvents,
            treeGetChildrenEvents: this._treeGetChildrenEvents,
            refreshSummary,
        };
    }

    private async _writeSessionToFile(session: ProfileSession): Promise<vscode.Uri> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `telemetry-profile-${timestamp}.json`;
        const filePath = path.join(os.tmpdir(), filename);
        const uri = vscode.Uri.file(filePath);

        const content = JSON.stringify(session, undefined, 2);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));

        return uri;
    }

    private _reset(): void {
        this._activeDepth = 0;
        this._currentGroup = undefined;
        this._currentGroupStartMs = 0;
        this._commandGroups = [];
        this._ungroupedEvents = [];
        this._startTimeStack = [];
        this._sessionStart = undefined;
        this._refreshEvents = [];
        this._treeGetChildrenEvents = [];
        this._originalRefreshFns = {};
        // Don't clear _originalGetChildrenFns here — they're cleaned up in _uninstallRefreshTracking
    }

    private _disposeHandlers(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables.length = 0;
    }
}

/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, dateTimeUtils, TreeElementBase, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { Activity, ActivityTreeItemOptions, OnErrorActivityData, OnProgressActivityData, OnStartActivityData, OnSuccessActivityData } from "@microsoft/vscode-azext-utils/hostapi";
import { Disposable, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";
import { TreeDataItem } from "../ResourceGroupsItem";

export enum ActivityStatus {
    Running = 'running',
    Done = 'done'
}

export class ActivityItem implements TreeElementBase, Disposable {
    public readonly id: string;
    private refreshTimer: NodeJS.Timeout | undefined;

    public get contextValue(): string {
        const contextValues = new Set(['azureActivity', ...(this.state.contextValuesToAdd ?? [])]);
        return Array.from(contextValues).sort().join(';');
    }

    public get label(): string {
        return this.state.label;
    }

    public get description(): string | undefined {
        if (this.status === ActivityStatus.Done) {
            let duration: string | undefined;
            if (this.activity.startTime && this.activity.endTime) {
                const startTimeMs: number = this.activity.startTime.getTime();
                const endTimeMs: number = this.activity.endTime.getTime();
                duration = dateTimeUtils.getFormattedDurationInMinutesAndSeconds(endTimeMs - startTimeMs);
            }

            if (this.error) {
                return duration ?
                    localize('failedWithDuration', 'Failed in {0}', duration) :
                    localize('failed', 'Failed');
            } else {
                return duration ?
                    localize('succeededWithDuration', 'Succeeded in {0}', duration) :
                    localize('succeeded', 'Succeeded');
            }
        } else {
            // Add live timer for running activities
            let message = this.latestProgress?.message;
            if (this.activity.startTime) {
                const startTimeMs: number = this.activity.startTime.getTime();
                const currentTimeMs: number = new Date().getTime();
                const duration = dateTimeUtils.getFormattedDurationInMinutesAndSeconds(currentTimeMs - startTimeMs);
                return message ? `${message} (${duration})` : `Running (${duration})`;
            }
            return message;
        }
    }

    public get iconPath(): TreeItemIconPath | undefined {
        if (this.status === ActivityStatus.Done) {
            if (this.error) {
                return new ThemeIcon('error', new ThemeColor('testing.iconFailed'));
            } else {
                return new ThemeIcon('pass', new ThemeColor('testing.iconPassed'));
            }
        }
        return new ThemeIcon('loading~spin');
    }

    private state: ActivityTreeItemOptions = {
        label: localize('loading', 'Loading...')
    }

    getTreeItem(): TreeItem | Thenable<TreeItem> {
        return {
            label: this.label,
            description: this.description,
            iconPath: this.iconPath,
            contextValue: this.contextValue,
            collapsibleState: this.initialCollapsibleState
        }
    }

    public initialCollapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.Expanded;

    public status?: ActivityStatus;
    public error?: unknown;
    private latestProgress?: { message?: string };

    public constructor(readonly activity: Activity) {
        this.id = activity.id;
        this.setupListeners(activity);
    }

    public dispose(): void {
        this.stopTimerRefresh();
        this.disposables.forEach(d => { d.dispose() });
    }

    private readonly disposables: Disposable[] = [];

    private startTimerRefresh(): void {
        if (!this.refreshTimer) {
            // Refresh every second to update the timer display
            this.refreshTimer = setInterval(() => {
                ext.actions.refreshActivityLogTree(this);
            }, 1000);
        }
    }

    private stopTimerRefresh(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }

    public async getChildren(): Promise<TreeDataItem[] | null | undefined> {
        if (this.state.getChildren) {
            return await this.state.getChildren(this);
        }
        return [];
    }

    private onProgress(data: OnProgressActivityData): void {
        void callWithTelemetryAndErrorHandling('activityOnProgress', async (context) => {
            context.telemetry.suppressIfSuccessful = true;
            this.latestProgress = data.message ? { message: data?.message } : this.latestProgress;
            this.state = data;
            ext.actions.refreshActivityLogTree(this);
        });
    }

    private onStart(data: OnStartActivityData): void {
        void callWithTelemetryAndErrorHandling('activityOnStart', async (_context) => {
            this.status = ActivityStatus.Running;
            this.state = data;
            this.startTimerRefresh(); // Start timer refresh for running activities
            ext.actions.refreshActivityLogTree(this);
        });
    }

    private onSuccess(data: OnSuccessActivityData): void {
        void callWithTelemetryAndErrorHandling('activityOnSuccess', async (_context) => {
            this.state = data;
            this.status = ActivityStatus.Done;
            this.stopTimerRefresh(); // Stop timer refresh when activity completes
            if (this.state.getChildren) {
                this.initialCollapsibleState = TreeItemCollapsibleState.Expanded;
            }
            ext.actions.refreshActivityLogTree(this);
        })
    }

    private onError(data: OnErrorActivityData): void {
        void callWithTelemetryAndErrorHandling('activityOnError', async (_context) => {
            this.state = data;
            this.status = ActivityStatus.Done;
            this.error = data.error;
            this.stopTimerRefresh(); // Stop timer refresh when activity errors
            this.initialCollapsibleState = TreeItemCollapsibleState.Expanded;
            ext.actions.refreshActivityLogTree(this);
        });
    }

    private setupListeners(activity: Activity): void {
        this.disposables.push(activity.onProgress(this.onProgress.bind(this)));
        this.disposables.push(activity.onStart(this.onStart.bind(this)));
        this.disposables.push(activity.onSuccess(this.onSuccess.bind(this)));
        this.disposables.push(activity.onError(this.onError.bind(this)));
    }
}

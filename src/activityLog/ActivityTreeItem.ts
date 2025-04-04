/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, callWithTelemetryAndErrorHandling, dateTimeUtils, IActionContext, nonNullProp, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { Activity, ActivityTreeItemOptions, OnErrorActivityData, OnProgressActivityData, OnStartActivityData, OnSuccessActivityData } from "@microsoft/vscode-azext-utils/hostapi";
import { Disposable, ThemeColor, ThemeIcon, TreeItemCollapsibleState } from "vscode";
import { localize } from "../utils/localize";

export enum ActivityStatus {
    Running = 'running',
    Done = 'done'
}

export class ActivityTreeItem extends AzExtParentTreeItem implements Disposable {

    public startedAtMs: number;

    public get contextValue(): string {
        const contextValues = new Set(['azureActivity', ...(this.state.contextValuesToAdd ?? [])]);
        return Array.from(contextValues).sort().join(';');
    }

    public get label(): string {
        return this.state.label;
    }

    public get description(): string | undefined {
        if (this.status === ActivityStatus.Done) {
            const start: Date = nonNullProp(this.activity, 'startTime');
            const end: Date = nonNullProp(this.activity, 'endTime');

            const durationMs: number = end.getTime() - start.getTime();
            if (this.error) {
                return localize('failed', `Failed (${dateTimeUtils.getFormattedDurationInMinutesAndSeconds(durationMs)})`);
            } else {
                return localize('succeeded', `Succeeded (${dateTimeUtils.getFormattedDurationInMinutesAndSeconds(durationMs)})`);
            }
        } else {
            return this.timer;
            // return this.latestProgress?.message ? `${this.latestProgress.message} (${this.timer})` : this.timer;
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

    public initialCollapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.Expanded;

    public status?: ActivityStatus;
    public error?: unknown;
    private latestProgress?: { message?: string };
    private timer: string = '';
    private timeout?: NodeJS.Timeout;

    public constructor(parent: AzExtParentTreeItem, private readonly activity: Activity) {
        super(parent);
        this.id = activity.id;
        this.setupListeners(activity);
        this.startedAtMs = activity.startTime?.getTime() || Date.now();
    }

    public dispose(): void {
        // Clear the timeout when disposing
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        this.disposables.forEach(d => { d.dispose() });
    }

    private readonly disposables: Disposable[] = [];

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        if (this.state.getChildren) {
            return await this.state.getChildren(this);
        }
        return [];
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    private onProgress(data: OnProgressActivityData): void {
        void callWithTelemetryAndErrorHandling('activityOnProgress', async (context) => {
            context.telemetry.suppressIfSuccessful = true;
            this.latestProgress = data.message ? { message: data?.message } : this.latestProgress;
            this.state = data;
            await this.refresh(context);
        });
    }

    private onStart(data: OnStartActivityData): void {
        void callWithTelemetryAndErrorHandling('activityOnStart', async (context) => {
            this.startedAtMs = Date.now();
            this.startTimer(context);
            this.status = ActivityStatus.Running;
            this.state = data;
            await this.refresh(context);
        });
    }

    private onSuccess(data: OnSuccessActivityData): void {
        void callWithTelemetryAndErrorHandling('activityOnSuccess', async (context) => {
            this.state = data;
            this.status = ActivityStatus.Done;
            if (this.state.getChildren) {
                this.initialCollapsibleState = TreeItemCollapsibleState.Expanded;
            }
            clearTimeout(this.timeout);
            await this.refresh(context);
        })
    }

    private onError(data: OnErrorActivityData): void {
        void callWithTelemetryAndErrorHandling('activityOnError', async (context) => {
            this.state = data;
            this.status = ActivityStatus.Done;
            this.error = data.error;
            this.initialCollapsibleState = TreeItemCollapsibleState.Expanded;
            clearTimeout(this.timeout);
            await this.refresh(context);
        });
    }

    private setupListeners(activity: Activity): void {
        this.disposables.push(activity.onProgress(this.onProgress.bind(this)));
        this.disposables.push(activity.onStart(this.onStart.bind(this)));
        this.disposables.push(activity.onSuccess(this.onSuccess.bind(this)));
        this.disposables.push(activity.onError(this.onError.bind(this)));
    }

    private startTimer(context: IActionContext) {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }

        this.timer = dateTimeUtils.getFormattedDurationInMinutesAndSeconds(Date.now() - this.startedAtMs);
        void this.refresh(context);

        // Set the timeout for the next second tick boundary
        const nextTickMs: number = 1000 - (Date.now() % 1000);
        this.timeout = setTimeout(() => this.startTimer(context), nextTickMs);

        // ext.outputChannel.appendLog(this.timer);
        // ext.outputChannel.appendLog(`nowMs: ${Date.now().toString()}`);
        // ext.outputChannel.appendLog(`Time diff: ${duration}`);
        // ext.outputChannel.appendLog(`Next tick: ${nextTickMs}`);
    }
}

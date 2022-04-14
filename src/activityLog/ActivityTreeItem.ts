/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { Activity, ActivityTreeItemOptions, AzExtParentTreeItem, AzExtTreeItem, callWithTelemetryAndErrorHandling, IActionContext, OnErrorActivityData, OnProgressActivityData, OnStartActivityData, OnSuccessActivityData, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { ThemeColor, ThemeIcon, TreeItemCollapsibleState } from "vscode";
import { localize } from "../utils/localize";

export enum ActivityStatus {
    Running = 'running',
    Done = 'done'
}

export class ActivityTreeItem extends AzExtParentTreeItem {

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
            if (this.error) {
                return localize('failed', 'Failed');
            } else {
                return localize('succeeded', 'Succeeded');
            }
        } else {
            return this.latestProgress?.message;
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

    public status?: ActivityStatus;
    public error?: unknown;
    private latestProgress?: { message?: string };

    public get collapsibleState(): TreeItemCollapsibleState {
        return this.state.collapsibleState ?? TreeItemCollapsibleState.None;
    }

    public set collapsibleState(_value: TreeItemCollapsibleState) {
        // no-op
    }

    public constructor(parent: AzExtParentTreeItem, activity: Activity) {
        super(parent);
        this.id = activity.id;
        this.setupListeners(activity);
        this.startedAtMs = Date.now();
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        if (this.state.getChildren) {
            return await this.state.getChildren(this);
        }
        return [];
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    private async onProgress(data: OnProgressActivityData): Promise<void> {
        await callWithTelemetryAndErrorHandling('activityOnProgress', async (context) => {
            context.telemetry.suppressIfSuccessful = true;
            this.latestProgress = data.message ? { message: data?.message } : this.latestProgress;
            this.state = data;
            await this.refresh(context);
        });
    }

    private async onStart(data: OnStartActivityData): Promise<void> {
        await callWithTelemetryAndErrorHandling('activityOnStart', async (context) => {
            this.startedAtMs = Date.now();
            this.status = ActivityStatus.Running;
            this.state = data;
            await this.refresh(context);
        });
    }

    private async onSuccess(data: OnSuccessActivityData): Promise<void> {
        await callWithTelemetryAndErrorHandling('activityOnSuccess', async (context) => {
            this.state = data;
            this.status = ActivityStatus.Done;
            await this.refresh(context);
        })
    }

    private async onError(data: OnErrorActivityData): Promise<void> {
        await callWithTelemetryAndErrorHandling('activityOnError', async (context) => {
            this.state = data;
            this.status = ActivityStatus.Done;
            this.error = data.error;
            await this.refresh(context);
        });
    }

    private setupListeners(activity: Activity): void {
        activity.onProgress(this.onProgress.bind(this));
        activity.onStart(this.onStart.bind(this));
        activity.onSuccess(this.onSuccess.bind(this));
        activity.onError(this.onError.bind(this));
    }
}

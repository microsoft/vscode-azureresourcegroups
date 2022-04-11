/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { Activity, ActivityTreeItemOptions, AzExtParentTreeItem, AzExtTreeItem, callWithTelemetryAndErrorHandling, IActionContext, OnErrorActivityData, OnProgressActivityData, OnStartActivityData, OnSuccessActivityData, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { ThemeColor, ThemeIcon, TreeItemCollapsibleState } from "vscode";
import { localize } from "../utils/localize";

export class ActivityTreeItem extends AzExtParentTreeItem {

    public startedAtMs: number;

    public get contextValue(): string {
        const postfix = this.state.contextValuePostfix ? `.${this.state.contextValuePostfix}` : '';
        return `azureOperation.${postfix}`;
    }

    public get label(): string {
        return this.state.label;
    }

    public get description(): string | undefined {

        if (this.latestProgress && this.latestProgress.message && !this.done) {
            return this.latestProgress.message;
        }

        return this.stateValue({
            running: this.latestProgress?.message,
            succeeded: localize('succeeded', 'Succeeded'),
            failed: localize('failed', 'Failed'),
        });
    }

    public get iconPath(): TreeItemIconPath | undefined {
        return this.stateValue({
            running: new ThemeIcon('loading~spin'),
            succeeded: new ThemeIcon('pass', new ThemeColor('testing.iconPassed')),
            failed: new ThemeIcon('error', new ThemeColor('testing.iconFailed')),
        });
    }

    private state: ActivityTreeItemOptions = {
        label: localize('loading', 'Loading...')
    }

    private done: boolean = false;
    public error: unknown;
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
        if (this.state.children) {
            const children = this.state.children(this);
            return children;
        }
        return [];
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    private async onProgress(data: OnProgressActivityData): Promise<void> {
        await callWithTelemetryAndErrorHandling('activityOnProgress', async (context) => {
            this.latestProgress = data.message ? { message: data?.message } : this.latestProgress;
            this.state = data;
            await this.refresh(context);
        });
    }

    private async onStart(data: OnStartActivityData): Promise<void> {
        await callWithTelemetryAndErrorHandling('activityOnStart', async (context) => {
            this.state = data;
            await this.refresh(context);
        });
    }

    private async onSuccess(data: OnSuccessActivityData): Promise<void> {
        await callWithTelemetryAndErrorHandling('activityOnSuccess', async (context) => {
            this.state = data;
            this.done = true;
            await this.refresh(context);
        })
    }

    private async onError(data: OnErrorActivityData): Promise<void> {
        await callWithTelemetryAndErrorHandling('activityOnError', async (context) => {
            this.state = data;
            this.done = true;
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

    private stateValue<T>(values: { running: T, succeeded: T, failed: T }): T {
        if (this.done) {
            return this.error ? values.failed : values.succeeded;
        }
        return values.running;
    }
}

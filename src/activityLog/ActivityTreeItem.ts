/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { ActivityStatus, AzExtParentTreeItem, AzExtTreeItem, callWithTelemetryAndErrorHandling, IActionContext, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { Activity, OnErrorActivityData, OnProgressActivityData } from "@microsoft/vscode-azext-utils/hostapi";
import { Disposable, ThemeColor, ThemeIcon, TreeItemCollapsibleState } from "vscode";
import { localize } from "../utils/localize";

export class ActivityTreeItem extends AzExtParentTreeItem implements Disposable {

    public startedAtMs: number;

    public get contextValue(): string {
        const contextValues = new Set(['azureActivity', ...(this.activity.options.contextValuesToAdd ?? [])]);
        return Array.from(contextValues).sort().join(';');
    }

    public get label(): string {
        return this.activity.options.label ?? localize('loading', 'Loading...');
    }

    public get description(): string | undefined {
        switch (this.status) {
            case ActivityStatus.Failed:
                return localize('failed', 'Failed');
            case ActivityStatus.Succeeded:
                return localize('succeeded', 'Succeeded');
            default:
                return this.latestProgress?.message;
        }
    }

    public get iconPath(): TreeItemIconPath | undefined {
        switch (this.status) {
            case ActivityStatus.Failed:
                return new ThemeIcon('error', new ThemeColor('testing.iconFailed'));
            case ActivityStatus.Succeeded:
                return new ThemeIcon('pass', new ThemeColor('testing.iconPassed'));
            default:
                return new ThemeIcon('loading~spin');
        }
    }
    public status?: ActivityStatus;
    public error?: unknown;
    private latestProgress?: { message?: string };
    public initialCollapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None;

    public constructor(parent: AzExtParentTreeItem, public readonly activity: Activity) {
        super(parent);
        this.id = activity.id;
        this.setupListeners(activity);
        this.startedAtMs = Date.now();
    }

    public dispose(): void {
        this.disposables.forEach(d => { d.dispose() });
    }

    private readonly disposables: Disposable[] = [];

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        if (this.activity.options.getChildren) {
            return await this.activity.options.getChildren(this);
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
            await this.refresh(context);
        });
    }

    private onStart(): void {
        void callWithTelemetryAndErrorHandling('activityOnStart', async (context) => {
            this.startedAtMs = Date.now();
            this.status = ActivityStatus.Running;
            await this.refresh(context);
        });
    }

    private onSuccess(): void {
        void callWithTelemetryAndErrorHandling('activityOnSuccess', async (context) => {
            this.status = ActivityStatus.Succeeded;
            if (this.activity.options.getChildren) {
                this.initialCollapsibleState = TreeItemCollapsibleState.Expanded;
            }
            await this.refresh(context);
        })
    }

    private onError(data: OnErrorActivityData): void {
        void callWithTelemetryAndErrorHandling('activityOnError', async (context) => {
            this.status = ActivityStatus.Failed;
            this.error = data.error;
            this.initialCollapsibleState = TreeItemCollapsibleState.Expanded;
            await this.refresh(context);
        });
    }

    private setupListeners(activity: Activity): void {
        this.disposables.push(activity.onProgress(this.onProgress.bind(this)));
        this.disposables.push(activity.onStart(this.onStart.bind(this)));
        this.disposables.push(activity.onSuccess(this.onSuccess.bind(this)));
        this.disposables.push(activity.onError(this.onError.bind(this)));
    }
}

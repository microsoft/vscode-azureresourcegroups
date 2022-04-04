/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, callWithTelemetryAndErrorHandling, GenericTreeItem, IActionContext, IParsedError, parseError, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import { ThemeColor, ThemeIcon } from 'vscode';
import { AppResource } from '../api';
import { getIconPath } from '../utils/azureUtils';
import { ActivityLogsTreeItem, Operation } from './ActivityLogsTreeItem';

export class OperationTreeItem extends AzExtParentTreeItem {


    public contextValue: string = 'azureOperation';

    public data: Operation;

    public done: boolean;

    public result?: AppResource;


    public error?: IParsedError;

    public get label(): string {
        return this.data.label;
    }

    public readonly timestamp: number;

    public get description(): string | undefined {
        if (this.done) {
            return this.error ? 'Failed' : 'Succeeded';
        }
        return 'Running...';
    }

    public get iconPath(): TreeItemIconPath {
        if (this.done) {
            return this.error ? new ThemeIcon('error', new ThemeIcon('testing.iconFailed')) : new ThemeIcon('pass', new ThemeColor('testing.iconPassed'));
        } else {
            return new ThemeIcon('loading~spin');
        }
    }

    constructor(parent: ActivityLogsTreeItem, operation: Operation) {
        super(parent);
        this.data = operation;

        this.timestamp = Date.now();

        this.id = randomUUID();

        void callWithTelemetryAndErrorHandling('operation', async (context: IActionContext) => {
            try {
                this.result = await this.data.task();
            } catch (e) {
                this.error = parseError(e);
            } finally {
                this.done = true;
                void this.refresh(context);
            }
        });
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        if (this.error) {
            return [
                new GenericTreeItem(this, {
                    contextValue: 'operationError',
                    label: this.error.message
                })
            ];
        }

        if (this.result) {
            const ti = new GenericTreeItem(this, {
                contextValue: 'operationResult',
                label: this.result.name,
                iconPath: getIconPath(this.result.type),
                commandId: 'azureResourceGroups.revealResource'
            });

            ti.commandArgs = [
                {
                    fullId: '/subscriptions/570117a0-fe37-4dde-ae48-b692c1b25f70/resourceGroups/angular-basic-dotnet/providers/microsoft.web/staticSites/angular-basic-dotnet',
                    data: { ...this.result }
                }
            ];

            return [
                ti
            ]
        }

        return [];
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }
}

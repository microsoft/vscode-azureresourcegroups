/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { BranchDataProvider, ResourceBase, ResourceModelBase } from '../../../api/src/index';
import { ActivityLogResource } from './activityLog';

interface ActivityLogResourceModel extends ResourceModelBase {
    readonly name: string;
}

class ActivityLogResourceItem implements ActivityLogResourceModel {
    constructor(private readonly resource: ActivityLogResource) {
    }

    get name(): string {
        return this.resource.name;
    }
}

export class ActivityLogDefaultBranchDataProvider implements BranchDataProvider<ResourceBase, ActivityLogResourceModel> {
    getChildren(_element: ActivityLogResourceModel): vscode.ProviderResult<ActivityLogResourceModel[]> {
        return [];
    }

    getResourceItem(element: ActivityLogResource): ActivityLogResourceModel | Thenable<ActivityLogResourceModel> {
        return new ActivityLogResourceItem(element);
    }

    getTreeItem(element: ActivityLogResourceModel): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return new vscode.TreeItem(element.name);
    }
}

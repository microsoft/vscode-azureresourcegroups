/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { BranchDataProvider, ResourceModelBase } from '../../../api/src/index';
import { TenantResource } from './tenant';

interface TenantResourceModel extends ResourceModelBase {
    readonly name: string;
}

class TenantResourceItem implements TenantResourceModel {
    constructor(private readonly resource: TenantResource) {
    }

    get name(): string {
        return this.resource.name;
    }
}

export class TenantDefaultBranchDataProvider implements BranchDataProvider<TenantResource, TenantResourceModel> {
    getChildren(_element: TenantResourceModel): vscode.ProviderResult<TenantResourceModel[]> {
        return [];
    }

    getResourceItem(element: TenantResource): TenantResourceModel | Thenable<TenantResourceModel> {
        return new TenantResourceItem(element);
    }

    getTreeItem(element: TenantResourceModel): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return new vscode.TreeItem(element.name);
    }
}

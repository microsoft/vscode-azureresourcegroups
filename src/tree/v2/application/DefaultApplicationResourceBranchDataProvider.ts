/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider } from '../../../api/v2/v2AzureResourcesApi';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { DefaultApplicationResourceItem } from './DefaultApplicationResourceItem';

export class DefaultApplicationResourceBranchDataProvider implements BranchDataProvider<ApplicationResource, ResourceGroupsItem> {
    getChildren(element: ResourceGroupsItem): vscode.ProviderResult<ResourceGroupsItem[]> {
        return element.getChildren();
    }

    getResourceItem(element: ApplicationResource): ResourceGroupsItem | Thenable<ResourceGroupsItem> {
        return new DefaultApplicationResourceItem(element);
    }

    // TODO: Implement change eventing.
    // onDidChangeTreeData?: vscode.Event<void | ResourceGroupsItem | null | undefined> | undefined;

    getTreeItem(element: ResourceGroupsItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }
}

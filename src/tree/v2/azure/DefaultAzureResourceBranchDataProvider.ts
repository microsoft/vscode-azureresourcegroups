/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureResource, AzureResourceModel, BranchDataProvider } from '../../../api/v2/v2AzureResourcesApi';
import { DefaultApplicationResourceItem } from './DefaultApplicationResourceItem';

export class DefaultAzureResourceBranchDataProvider implements BranchDataProvider<AzureResource, AzureResourceModel> {
    getChildren(element: DefaultApplicationResourceItem): vscode.ProviderResult<AzureResourceModel[]> {
        return element.getChildren();
    }

    getResourceItem(element: AzureResource): DefaultApplicationResourceItem | Thenable<DefaultApplicationResourceItem> {
        return new DefaultApplicationResourceItem(element);
    }

    // TODO: Implement change eventing.
    // onDidChangeTreeData?: vscode.Event<void | ResourceGroupsItem | null | undefined> | undefined;

    getTreeItem(element: DefaultApplicationResourceItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }
}

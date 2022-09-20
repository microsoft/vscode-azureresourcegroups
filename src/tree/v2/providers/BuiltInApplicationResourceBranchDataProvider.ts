import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider } from '../../../api/v2/v2AzureResourcesApi';
import { localize } from "../../../utils/localize";
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { BuiltInApplicationResourceItem } from './BuiltInApplicationResourceItem';

export class BuiltInApplicationResourceBranchDataProvider implements BranchDataProvider<ApplicationResource, ResourceGroupsItem> {
    getChildren(element: ResourceGroupsItem): vscode.ProviderResult<ResourceGroupsItem[]> {
        if (!element) {
            throw new Error(localize('UnexpectedElement', 'Expected a valid element.'));
        }

        return element.getChildren();
    }

    getResourceItem(element: ApplicationResource): ResourceGroupsItem | Thenable<ResourceGroupsItem> {
        return new BuiltInApplicationResourceItem(element);
    }

    // TODO: Implement change eventing.
    // onDidChangeTreeData?: vscode.Event<void | ResourceGroupsItem | null | undefined> | undefined;

    getTreeItem(element: ResourceGroupsItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }
}

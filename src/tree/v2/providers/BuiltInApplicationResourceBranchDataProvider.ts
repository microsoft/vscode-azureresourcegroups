import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider } from '../../../api/v2/v2AzureResourcesApi';
import { BuiltInApplicationResourceItem } from './BuiltInApplicationResourceItem';
import { BuiltInResourceModelBase } from './BuiltInResourceModelBase';
import { localize } from "../../../utils/localize";

export class BuiltInApplicationResourceBranchDataProvider implements BranchDataProvider<ApplicationResource, BuiltInResourceModelBase> {
    getChildren(element?: BuiltInResourceModelBase | undefined): vscode.ProviderResult<BuiltInResourceModelBase[]> {
        if (!element) {
            throw new Error(localize('UnexpectedElement', 'Expected a valid element.'));
        }

        return element.getChildren();
    }

    getResourceItem(element: ApplicationResource): BuiltInResourceModelBase | Thenable<BuiltInResourceModelBase> {
        return new BuiltInApplicationResourceItem(element);
    }

    // TODO: Implement change eventing.
    // onDidChangeTreeData?: vscode.Event<void | BuiltInResourceModelBase | null | undefined> | undefined;

    getTreeItem(element: BuiltInResourceModelBase): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }
}

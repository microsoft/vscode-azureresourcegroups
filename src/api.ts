import { GenericResource } from '@azure/arm-resources';
import { AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';

export interface TreeNodeConfiguration {
    readonly label: string;
    readonly id?: string;
    readonly description?: string;
    readonly icon?: vscode.ThemeIcon;
    readonly contextValue?: string;
}

interface ApplicationResource extends TreeNodeConfiguration {
    getChildren?(): vscode.ProviderResult<AzExtTreeItem[]>;
    resolveTooltip?(): Thenable<string | vscode.MarkdownString>;
}

export interface GroupableApplicationResource extends ApplicationResource {
    readonly rootGroupConfig: TreeNodeConfiguration;
    readonly subGroupConfig: {
        readonly resourceGroup: TreeNodeConfiguration;
        readonly resourceType: TreeNodeConfiguration;
        readonly [label: string]: TreeNodeConfiguration; // Don't need to support right off the bat but we can put it in the interface
    }
}

export type LocalResource = AzExtTreeItem;

export declare interface ApplicationResourceProvider {
    matchesResource?(resource: GenericResource): boolean;
    // resource comes from a list returned from an @azure/arm-resources listByResourceGroup call
    resolveResource(resource: GenericResource): vscode.ProviderResult<GroupableApplicationResource | undefined>;
}

export interface LocalResourceProvider {
    provideResources(): vscode.ProviderResult<LocalResource[] | undefined>;
}

// to be implemented in and exported from host
export interface AzExtProviderApi {
    registerLocalResourceProvider(provider: LocalResourceProvider): vscode.Disposable;
    registerApplicationResourceProvider(resourceType: string, provider: ApplicationResourceProvider): vscode.Disposable;
}

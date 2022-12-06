import { AzureResource, AzureSubscription, ResourceProvider, v2AzureResourcesApi } from "@microsoft/vscode-azext-utils/hostapi.v2";
import * as vscode from 'vscode';

// v2 types that are internal to resource groups (for now)

/**
* A provider for supplying items for the Azure resource tree (e.g. Cosmos DB, Storage, etc.).
*/
export type AzureResourceProvider = ResourceProvider<AzureSubscription, AzureResource>;

export interface v2AzureResourcesApiInternal extends v2AzureResourcesApi {
    /**
     * Registers a provider of Azure resources.
     *
     * @param provider The resource provider.
     *
     * @returns A disposable that unregisters the provider when disposed.
     */
    registerAzureResourceProvider(provider: AzureResourceProvider): vscode.Disposable;
}

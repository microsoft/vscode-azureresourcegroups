/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TokenCredential } from "@azure/core-auth";
import { type AzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";

export type AzureResourceConnection<TypeT = string, KindT = string | undefined> = {
    type: TypeT;
    kind?: KindT;
    name: string;
    subscriptionId: string;
    resourceGroup: string;
};

export function partialConnectionHasAtLeastOneField(partialConnection: object): boolean {
    return typeof (partialConnection as AzureResourceConnection)?.type === "string" ||
        typeof (partialConnection as AzureResourceConnection)?.name === "string" ||
        typeof (partialConnection as AzureResourceConnection)?.subscriptionId === "string" ||
        typeof (partialConnection as AzureResourceConnection)?.resourceGroup === "string";
}

export function isNonPartialConnection(maybeNonPartialConnection: Partial<AzureResourceConnection> | undefined): maybeNonPartialConnection is AzureResourceConnection {
    return maybeNonPartialConnection?.type !== undefined &&
        maybeNonPartialConnection?.name !== undefined &&
        maybeNonPartialConnection?.subscriptionId !== undefined &&
        maybeNonPartialConnection?.resourceGroup !== undefined;
}

export const kubernetesManagedClusterType = "microsoft.containerservice/managedclusters";
export type KubernetesAppManagedClusterConnection = AzureResourceConnection<typeof kubernetesManagedClusterType>;
export function isKubernetesAppManagedClusterConnection(connection: AzureResourceConnection | undefined): connection is KubernetesAppManagedClusterConnection {
    return connection?.type === kubernetesManagedClusterType;
}

export const containerAppType = "microsoft.app/containerapps";
export type ContainerAppConnection = AzureResourceConnection<typeof containerAppType>;
export function isContainerAppConnection(connection: AzureResourceConnection | undefined): connection is ContainerAppConnection {
    return connection?.type === containerAppType;
}

export const appServiceType = "microsoft.web/sites";

export type WebAppKinds = "app" | "app,linux";
export const webAppKinds: WebAppKinds[] = ["app", "app,linux"];
export type WebAppConnection = AzureResourceConnection<typeof appServiceType, WebAppKinds>;
export function isWebAppConnection(connection: AzureResourceConnection | undefined): connection is WebAppConnection {
    return connection?.type === appServiceType && webAppKinds.includes(connection.kind as WebAppKinds);
}

export type FunctionAppKinds = "functionapp" | "functionapp,linux" | "functionapp,linux,container,kubernetes" | "functionapp,linux,kubernetes";
export const functionAppKinds: FunctionAppKinds[] = ["functionapp", "functionapp,linux", "functionapp,linux,container,kubernetes", "functionapp,linux,kubernetes"];
export type FunctionAppConnection = AzureResourceConnection<typeof appServiceType, FunctionAppKinds>;
export function isFunctionAppConnection(connection: AzureResourceConnection | undefined): connection is FunctionAppConnection {
    return connection?.type === appServiceType && functionAppKinds.includes(connection.kind as FunctionAppKinds);
}

export type AppServiceConnection = WebAppConnection | FunctionAppConnection;
export function isAppServiceConnection(connection: AzureResourceConnection | undefined): connection is AppServiceConnection {
    return connection?.type === appServiceType;
}

export const insightsComponentType = "microsoft.insights/components";
export type InsightsComponentConnection = AzureResourceConnection<typeof insightsComponentType>;
export function isInsightsComponentConnection(connection: AzureResourceConnection | undefined): connection is InsightsComponentConnection {
    return connection?.type === insightsComponentType;
}

export const insightsWorkspaceType = "microsoft.operationalinsights/workspaces";
export type InsightsWorkspaceConnection = AzureResourceConnection<typeof insightsWorkspaceType>;
export function isInsightsWorkspaceConnection(connection: AzureResourceConnection | undefined): connection is InsightsWorkspaceConnection {
    return connection?.type === insightsWorkspaceType;
}

export function getConnectionTypeDisplayName(connection: AzureResourceConnection): string | undefined {
    switch (connection.type) {
        case kubernetesManagedClusterType:
            return "Kubernetes Cluster";
        case containerAppType:
            return "Container App";
        case appServiceType:
            if (isWebAppConnection(connection)) {
                return "Web App";
            } else if (connection.kind?.startsWith("functionapp")) {
                return "Function App";
            } else if (connection.kind === "workflowapp") {
                return "Logic App";
            }
            // Likely a "containerized" or "kubernetes" web app
            return "App Service";
        case insightsComponentType:
            return "Application Insights";
        case insightsWorkspaceType:
            return "Log Analytics Workspace";
        case "microsoft.resources/resourcegroups":
            return "Resource Group";
        case "microsoft.app/containerapps":
            return "Container App";
        case "microsoft.app/managedenvironments":
            return "Container App Environment";
        case "microsoft.compute/virtualmachines":
            return "Virtual Machine";
        case "microsoft.documentdb/databaseaccounts":
            return "Cosmos DB Account";
        case "microsoft.storage/storageaccounts":
            return "Storage Account";
        case "microsoft.web/staticsites":
            return "Static Web App";
        default:
            return undefined;
    }
}

export function getResourceIdFromConnection(connection: AzureResourceConnection): string {
    return `subscriptions/${connection.subscriptionId}/resourceGroups/${connection.resourceGroup}/providers/${connection.type}/${connection.name}`;
}

export function resourceConnectionFromResourceId(resourceId: string, kind?: string, expectedType?: string): AzureResourceConnection | undefined {
    const parts = resourceId.split("/");
    const subscriptionId = parts[2];
    const resourceGroup = parts[4];
    const type = parts.slice(6, parts.length - 1).join("/").toLowerCase();
    const name = parts[parts.length - 1];
    if (expectedType && type !== expectedType) {
        return undefined;
    } else {
        return {
            type: type,
            kind: kind,
            name: name,
            subscriptionId: subscriptionId,
            resourceGroup: resourceGroup,
        };
    }
}

export async function getTokenCredentialForAzureResourceConnection(subscriptionProvider: AzureSubscriptionProvider, connection: AzureResourceConnection): Promise<{ credential: TokenCredential, tenantId: string } | undefined> {
    const isSignedIn = await subscriptionProvider.isSignedIn();
    if (!isSignedIn) {
        await subscriptionProvider.signIn();
    }

    const subscriptions = await subscriptionProvider.getSubscriptions(false);
    const matchingSubscription = subscriptions.find((sub) => sub.subscriptionId === connection.subscriptionId);
    if (matchingSubscription === undefined || matchingSubscription.credential === undefined || matchingSubscription.tenantId === undefined) {
        return undefined;
    }

    const tokenCredential = matchingSubscription?.credential;
    return { credential: tokenCredential, tenantId: matchingSubscription.tenantId };
}

import type { Environment } from '@azure/ms-rest-azure-env';
import * as vscode from 'vscode';

export declare namespace apiUtils {
    export interface AzureExtensionApiProvider {
        /**
         * Provides the API for an Azure Extension.
         *
         * @param apiVersionRange - The version range of the API you need. Any semver syntax is allowed. For example "1" will return any "1.x.x" version or "1.2" will return any "1.2.x" version
         * @param options - Options for initializing the API. See {@link GetApiOptions}
         * @throws - Error if a matching version is not found.
         */
        getApi<T extends AzureExtensionApi>(apiVersionRange: string, options?: GetApiOptions): T;
    }
    export class ExtensionNotFoundError extends Error {
        constructor(extensionId: string);
    }
    /**
     * Gets the exported API from the given extension id and version range.
     *
     * @param extensionId - The extension id to get the API from
     * @param apiVersionRange - The version range of the API you need. Any semver syntax is allowed. For example "1" will return any "1.x.x" version or "1.2" will return any "1.2.x" version
     * @param options - The options to pass when creating the API. If `options.extensionId` is left undefined, it's set to the caller extension id.
     * @throws Error if extension with id is not installed.
     */
    export function getAzureExtensionApi<T extends AzureExtensionApi>(context: vscode.ExtensionContext, extensionId: string, apiVersionRange: string, options?: GetApiOptions): Promise<T>;
    /**
     * Get extension exports for the extension with the given id. Activates extension first if needed.
     *
     * @returns `undefined` if the extension is not installed
     */
    export function getExtensionExports<T>(extensionId: string): Promise<T | undefined>;
}

/**
 * Normalized type for Azure resources that uniquely identifies resource type for the purposes
 * of the Azure extensions
 */
export declare enum AzExtResourceType {
    AppServices = "AppServices",
    ArcEnabledMachines = "ArcEnabledMachines",
    AzureCosmosDb = "AzureCosmosDb",
    ContainerApps = "ContainerApps",
    ContainerAppsEnvironment = "ContainerAppsEnvironment",
    FunctionApp = "FunctionApp",
    PostgresqlServersFlexible = "PostgresqlServersFlexible",
    PostgresqlServersStandard = "PostgresqlServersStandard",
    StaticWebApps = "StaticWebApps",
    StorageAccounts = "StorageAccounts",
    VirtualMachines = "VirtualMachines",
    ResourceGroup = "ResourceGroup",
    ApiManagementService = "ApiManagementService",
    ApplicationInsights = "ApplicationInsights",
    AppServiceKubernetesEnvironment = "AppServiceKubernetesEnvironment",
    AppServicePlans = "AppServicePlans",
    AvailabilitySets = "AvailabilitySets",
    BatchAccounts = "BatchAccounts",
    CacheRedis = "CacheRedis",
    ContainerRegistry = "ContainerRegistry",
    ContainerServiceManagedClusters = "ContainerServiceManagedClusters",
    CustomLocations = "CustomLocations",
    DeviceIotHubs = "DeviceIotHubs",
    DevTestLabs = "DevTestLabs",
    Disks = "Disks",
    EventGridDomains = "EventGridDomains",
    EventGridEventSubscriptions = "EventGridEventSubscriptions",
    EventGridTopics = "EventGridTopics",
    EventHubNamespaces = "EventHubNamespaces",
    FrontDoorAndCdnProfiles = "FrontDoorAndCdnProfiles",
    Images = "Images",
    KeyVaults = "KeyVaults",
    KubernetesConnectedClusters = "KubernetesConnectedClusters",
    LoadBalancers = "LoadBalancers",
    LogicApp = "LogicApp",
    LogicWorkflows = "LogicWorkflows",
    ManagedIdentityUserAssignedIdentities = "ManagedIdentityUserAssignedIdentities",
    MongoClusters = 'MongoClusters',
    MysqlServers = "MysqlServers",
    NetworkApplicationGateways = "NetworkApplicationGateways",
    NetworkApplicationSecurityGroups = "NetworkApplicationSecurityGroups",
    NetworkInterfaces = "NetworkInterfaces",
    NetworkLocalNetworkGateways = "NetworkLocalNetworkGateways",
    NetworkPublicIpPrefixes = "NetworkPublicIpPrefixes",
    NetworkRouteTables = "NetworkRouteTables",
    NetworkSecurityGroups = "NetworkSecurityGroups",
    NetworkVirtualNetworkGateways = "NetworkVirtualNetworkGateways",
    NetworkWatchers = "NetworkWatchers",
    NotificationHubNamespaces = "NotificationHubNamespaces",
    OperationalInsightsWorkspaces = "OperationalInsightsWorkspaces",
    OperationsManagementSolutions = "OperationsManagementSolutions",
    PublicIpAddresses = "PublicIpAddresses",
    ServiceBusNamespaces = "ServiceBusNamespaces",
    ServiceFabricClusters = "ServiceFabricClusters",
    ServiceFabricMeshApplications = "ServiceFabricMeshApplications",
    SignalRService = "SignalRService",
    SpringApps = "SpringApps",
    SqlDatabases = "SqlDatabases",
    SqlServers = "SqlServers",
    VirtualMachineScaleSets = "VirtualMachineScaleSets",
    VirtualNetworks = "VirtualNetworks",
    WebHostingEnvironments = "WebHostingEnvironments",
    WebPubSub = "WebPubSub"
}

/**
 * Represents a means of obtaining authentication data for an Azure subscription.
 */
export declare interface AzureAuthentication {
    /**
     * Gets a VS Code authentication session for an Azure subscription.
     *
     * @param scopes - The scopes for which the authentication is needed.
     *
     * @returns A VS Code authentication session or undefined, if none could be obtained.
     */
    getSession(scopes?: string[]): vscode.ProviderResult<vscode.AuthenticationSession>;
}

export declare interface AzureExtensionApi {
    /**
     * The API version for this extension. It should be versioned separately from the extension and ideally remains backwards compatible.
     */
    apiVersion: string;
}

/**
 * Represents an individual resource in Azure.
 */
export declare interface AzureResource extends ResourceBase {
    /**
     * The Azure-designated type of this resource.
     */
    readonly azureResourceType: AzureResourceType;
    /**
     * The location in which this resource exists.
     */
    readonly location?: string;
    /**
     * The resource group to which this resource belongs.
     */
    readonly resourceGroup?: string;
    /**
     * The type of this resource.
     *
     * @remarks This value is used to map resources to their associated branch data provider.
     */
    readonly resourceType?: AzExtResourceType;
    /**
     * The Azure subscription to which this resource belongs.
     */
    readonly subscription: AzureSubscription;
    /**
     * The tags associated with this resource.
     */
    readonly tags?: {
        [propertyName: string]: string;
    };
    /**
     * A copy of the raw resource.
     */
    readonly raw: {};
}

/**
 * A provider for visualizing items in the Azure resource tree (e.g. Cosmos DB, Storage, etc.).
 */
export declare type AzureResourceBranchDataProvider<TModel extends AzureResourceModel> = BranchDataProvider<AzureResource, TModel>;

/**
 * Represents a model of an individual Azure resource or its child items.
 */
export declare interface AzureResourceModel extends ResourceModelBase {
    /**
     * The Azure ID of this resource.
     *
     * @remarks This property is expected to be implemented on "application-level" resources, but may also be applicable to its child items.
     */
    readonly azureResourceId?: string;
    /**
     * The URL of the area of Azure portal related to this item.
     */
    readonly portalUrl?: vscode.Uri;
    /**
     * Define to enable the "View Properties" command.
     */
    readonly viewProperties?: ViewPropertiesModel;
}

/**
 * The current (v2) Azure Resources extension API.
 */
export declare interface AzureResourcesExtensionApi extends AzureExtensionApi {
    resources: ResourcesApi;
}

/**
 * Represents a type of resource as designated by Azure.
 */
export declare interface AzureResourceType {
    /**
     * The kinds of resources that this type can represent.
     */
    readonly kinds?: string[];
    /**
     * The (general) type of resource.
     */
    readonly type: string;
}

/**
 * Represents an Azure subscription.
 */
export declare interface AzureSubscription {
    /**
     * Access to the authentication session associated with this subscription.
     */
    readonly authentication: AzureAuthentication;
    /**
     * The Azure environment to which this subscription belongs.
     */
    readonly environment: Environment;
    /**
     * Whether this subscription belongs to a custom cloud.
     */
    readonly isCustomCloud: boolean;
    /**
     * The display name of this subscription.
     */
    readonly name: string;
    /**
     * The ID of this subscription.
     */
    readonly subscriptionId: string;
    /**
     * The tenant to which this subscription belongs or undefined, if not associated with a specific tenant.
     */
    readonly tenantId: string;
}

/**
 * The base interface for visualizers of Azure and workspace resources.
 */
export declare interface BranchDataProvider<TResource extends ResourceBase, TModel extends ResourceModelBase> extends vscode.TreeDataProvider<TModel> {
    /**
     * Get the children of `element`.
     *
     * @param element - The element from which the provider gets children. Unlike a traditional tree data provider, this will never be `undefined`.
     *
     * @returns Children of `element`.
     */
    getChildren(element: TModel): vscode.ProviderResult<TModel[]>;
    /**
     * Called to get the provider's model element for a specific resource.
     *
     * @remarks getChildren() assumes that the provider passes a known (TModel) model item, or undefined when getting the "root" children.
     *          However, branch data providers have no "root" so this function is called for each matching resource to obtain a starting branch item.
     *
     * @returns The provider's model element for `resource`.
     */
    getResourceItem(element: TResource): TModel | Thenable<TModel>;
}

export declare interface GetApiOptions {
    /**
     * The ID of the extension requesting the API.
     *
     * @remarks This is used for telemetry purposes, to measure which extensions are using the API.
     */
    readonly extensionId?: string;
}

/**
 * Gets a normalized type for an Azure resource, accounting for the fact that some
 * Azure resources share values for type and/or kind
 * @param resource - The resource to check the {@link AzExtResourceType} for
 * @returns The normalized Azure resource type
 */
export declare function getAzExtResourceType(resource: {
    type: string;
    kind?: string;
}): AzExtResourceType | undefined;

export declare function getAzureResourcesExtensionApi(extensionContext: vscode.ExtensionContext, apiVersionRange: '2.0.0', options?: GetApiOptions): Promise<AzureResourcesExtensionApi>;

export declare function isWrapper(maybeWrapper: unknown): maybeWrapper is Wrapper;

/**
 * Represents the base type for all Azure and workspace resources.
 */
export declare interface ResourceBase {
    /**
     * The ID of this resource.
     *
     * @remarks This value should be unique across all resources.
     */
    readonly id: string;
    /**
     * The display name of this resource.
     */
    readonly name: string;
}

export declare type ResourceGroupsTreeDataProvider = Pick<vscode.TreeDataProvider<unknown>, 'getChildren' | 'getTreeItem'>;

/**
 * Represents the base type for models of resources and their child items.
 */
export declare interface ResourceModelBase {
    /**
     * The ID of this model.
     *
     * @remarks This value should be unique across all models of its type.
     */
    readonly id?: string;
}

/**
 * The base interface for providers of Azure and workspace resources.
 */
export declare interface ResourceProvider<TResourceSource, TResource extends ResourceBase> {
    /**
     * Fired when the provider's resources have changed.
     */
    readonly onDidChangeResource?: vscode.Event<TResource | undefined>;
    /**
     * Called to supply the resources used as the basis for the resource views.
     *
     * @param source - The source from which resources should be generated.
     *
     * @returns The resources to be displayed in the resource view.
     */
    getResources(source: TResourceSource): vscode.ProviderResult<TResource[]>;
}

export declare interface ResourcesApi {
    /**
     * {@link vscode.TreeDataProvider} representing the Azure tree view.
     */
    readonly azureResourceTreeDataProvider: ResourceGroupsTreeDataProvider;
    /**
     * Registers an Azure resource branch data provider.
     *
     * @param type - The Azure resource type associated with the provider. Must be unique.
     * @param resolver - The branch data provider for the resource type.
     *
     * @returns A disposable that unregisters the provider.
     */
    registerAzureResourceBranchDataProvider<TModel extends AzureResourceModel>(type: AzExtResourceType, provider: AzureResourceBranchDataProvider<TModel>): vscode.Disposable;
    /**
     * {@link vscode.TreeDataProvider} representing the Workspace tree view.
     */
    readonly workspaceResourceTreeDataProvider: ResourceGroupsTreeDataProvider;
    /**
     * Registers a provider of workspace resources.
     *
     * @param provider - The resource provider.
     *
     * @returns A disposable that unregisters the provider.
     */
    registerWorkspaceResourceProvider(provider: WorkspaceResourceProvider): vscode.Disposable;
    /**
     * Registers a workspace resource branch data provider.
     *
     * @param type - The workspace resource type associated with the provider. Must be unique.
     * @param provider - The branch data provider for the resource type.
     *
     * @returns A disposable that unregisters the provider.
     */
    registerWorkspaceResourceBranchDataProvider<TModel extends WorkspaceResourceModel>(type: WorkspaceResourceType, provider: WorkspaceResourceBranchDataProvider<TModel>): vscode.Disposable;
    /**
     * Reveal a resource in the Azure tree view. Works with subscriptions, resource groups, or resources.
     *
     * @param id - The Azure Resource ID to reveal in the Azure tree view.
     * @param options - Options for revealing the resource. See {@link vscode.TreeView.reveal}
     */
    revealAzureResource(id: string, options?: VSCodeRevealOptions): Promise<void>;
}

export declare function unwrapArgs<T>(args?: unknown[]): [node?: T, nodes?: T[], ...args: unknown[]];

export declare type ViewPropertiesModel = {
    /**
     * File name displayed in VS Code.
     */
    label: string;
} & (ViewPropertiesModelAsync | ViewPropertiesModelSync);

export declare interface ViewPropertiesModelAsync {
    /**
     * Async function to get the raw data associated with the resource to populate the properties file.
     */
    getData: () => Promise<{}>;
}

export declare interface ViewPropertiesModelSync {
    /**
     * Raw data associated with the resource to populate the properties file.
     */
    data: {};
}

export declare type VSCodeRevealOptions = Parameters<vscode.TreeView<unknown>['reveal']>['1'];

/**
 * An indivdual root resource for a workspace.
 */
export declare interface WorkspaceResource extends ResourceBase {
    /**
     * The folder to which this resource belongs.
     * Leave undefined if this resource is a global or system-level resource
     * not associated with a specific workspace folder.
     */
    readonly folder?: vscode.WorkspaceFolder;
    /**
     * The type of this resource.
     *
     * @remarks This value is used to map resources to their associated branch data provider.
     */
    readonly resourceType: WorkspaceResourceType;
}

/**
 * A provider for visualizing items in the workspace resource tree (e.g., storage emulator, function apps in workspace, etc.).
 */
export declare type WorkspaceResourceBranchDataProvider<TModel extends WorkspaceResourceModel> = BranchDataProvider<WorkspaceResource, TModel>;

/**
 * Represents a model of an individual workspace resource or its child items.
 */
export declare type WorkspaceResourceModel = ResourceModelBase;

/**
 * A provider for supplying items for the workspace resource tree (e.g., storage emulator, function apps in workspace, etc.).
 */
export declare type WorkspaceResourceProvider = ResourceProvider<void, WorkspaceResource>;

/**
 * Respresents a specific type of workspace resource.
 *
 * @remarks This value should be unique across all types of workspace resources.
 */
export declare type WorkspaceResourceType = string;

/**
 * Interface describing an object that wraps another object.
 *
 * The host extension will wrap all tree nodes provided by the client
 * extensions. When commands are executed, the wrapper objects are
 * sent directly to the client extension, which will need to unwrap
 * them. The `registerCommandWithTreeNodeUnwrapping` method below, used
 * in place of `registerCommand`, will intelligently do this
 * unwrapping automatically (i.e., will not unwrap if the arguments
 * aren't wrappers)
 */
export declare interface Wrapper {
    unwrap<T>(): T;
}

export { };


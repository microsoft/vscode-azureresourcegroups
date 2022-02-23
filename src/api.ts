import { AzExtTreeItem, IActionContext } from "@microsoft/vscode-azext-utils";
import { Disposable, MarkdownString, ProviderResult, ThemeIcon } from "vscode";
import { SubscriptionTreeItem } from "./tree/SubscriptionTreeItem";

export interface TreeNodeConfiguration {
    readonly label: string;
    readonly id: string;
    readonly description?: string;
    readonly icon?: ThemeIcon;
    readonly contextValue?: string;
    readonly name: string;
}

// ex: Static Web App
interface ApplicationResource extends TreeNodeConfiguration {
    getChildren?(): ProviderResult<AzExtTreeItem[]>;
    resolve?(): Thenable<void>;

    resolveTooltip?(): Thenable<string | MarkdownString>;
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

export interface ApplicationResourceProvider {
    provideResources(subContext: IActionContext, subTreeItem: SubscriptionTreeItem): ProviderResult<GroupableApplicationResource[] | undefined>;
}

export interface ApplicationResourceResolver {
    resolveResource(resource: GroupableApplicationResource): ProviderResult<void>;
}

export interface LocalResourceProvider {
    provideResources(): ProviderResult<LocalResource[] | undefined>;
}

// called from a resource extension (SWA, Functions, etc)
export declare function registerApplicationResourceResolver(
    provider: ApplicationResourceResolver,
    resourceType: string,
    resourceKind?: string,
): Disposable;

// Resource Groups can have a default resolve() method that it supplies, that will activate the appropriate extension and give it a chance to replace the resolve() method
// ALSO, it will eliminate that default resolver from future calls for that resource type

// called from host extension (Resource Groups)
// Will need a manifest of extensions mapping type => extension ID
export declare function registerApplicationResourceProvider(
    provider: ApplicationResourceProvider,
    featureExtension: ExtensionManifestEntry, // Or similar?
    resourceType: string | 'other', // Maybe this | 'other'
    resolver?: ApplicationResourceResolver, // Maybe? // Default resolver?
    resourceKind?: string,
): Disposable;

// resource extensions need to activate onView:localResourceView and call this
export declare function registerLocalResourceProvider(
    resourceType: string,
    provider: LocalResourceProvider
): Disposable;

interface ExtensionManifestEntry {
    extensionId: string;
    minimumExtensionVersion?: string;
    resourceTypes: {
        resourceType: string,
        resourceKind?: string,
    }[];
}

export const ExtensionsManifest: ExtensionManifestEntry[] = [];

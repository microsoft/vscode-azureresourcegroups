# Unified Azure Resources Extensibility Model
## Overview
The unified Azure resources extensibility model will provide a way for any number of "client" extensions to provide UI and functionality to a "host" extension, responsible for displaying Azure and local resources in a unified way. Client extensions include Azure App Service, Azure Functions, etc. Both first- and third-party extensions could be supported.

## What Can Extensions Provide?
The host extension will provide tree nodes for all Azure resources within the subscriptions in their global subscription filter. For each of these tree nodes, the host extension will permit client extensions to _resolve_ additional information--including controlling the UI aspects, but also properties and even methods to facilitate the various commands and functionality each client extension provides.

In addition to resolving Azure resources, a second view will exist for providing _local_ resources. These could include, for example, local storage emulators, function apps in the local workspace, etc. Since each extension has very different functionality for local resources, the API for providing the nodes will be far more generic--essentially, client extensions will just provide a set of tree nodes.

## Data Flow
The data flow for the node resolving process is as follows:

1. The host extension will enumerate Azure resources, and also build groupings based on that enumeration (e.g. group by Azure Resource Group, location, type, ARM tags, etc.). This part is referred to as "fetching".
1. When a group node is expanded, each of the resource nodes within will be resolved. This will involve calling into the appropriate resolver provided by the client extension.
1. If the resolver has not been registered yet (e.g. due to the client extension not being activated yet), a wrapper resolver takes its place, which will await activation. Separately, the client extension will be activated based on custom contribution points. When it activates and registers its resolver, the wrapper resolvers will resolve using the extension. This ensures that regardless of the order or timing of activation, nodes will be resolved as soon as possible and shown to the user.
1. Once a resource node has been resolved, all the relevant commands provided by client extensions should work as before. Since each resource tree node will fundamentally have the same methods and properties as before--even though it is now being created in the host extension--only minimal changes will be needed to the code in our existing client extensions.

## API
All of the API declarations are present in the NPM package `@microsoft/vscode-azext-utils`. This package can be used as a dev dependency only, if only the declarations are needed; however it also contains a wide range of useful utilities relating to tree views, telemetry, error handling, etc.

Client extensions will primarily interact with the host extension by providing a resource resolver. This resolver will, at runtime, be able to alter the resource nodes' appearance in the tree view, along with attaching methods and data needed to facilitate various features.

```typescript
/**
 * Registers an app resource resolver
 * @param id The resolver ID. Must be unique.
 * @param resolver The resolver
 */
registerApplicationResourceResolver(id: string, resolver: AppResourceResolver): vscode.Disposable;
```

The resolver provides two methods--`matchesResource`, to see if that resolver is applicable to a given resource, and `resolveResource`--to provide a scoped set of methods, data, etc. that are applied to the resource node created by the host extension.

```typescript
/**
 * The interface that resource resolvers must implement
 */
export interface AppResourceResolver {
    /**
     * Resolves more information about an AppResource, filling in the remaining functionality of the tree item
     * @param subContext The Azure subscription context for the AppResource
     * @param resource The AppResource
     */
    resolveResource(subContext: ISubscriptionContext, resource: AppResource): vscode.ProviderResult<ResolvedAppResourceBase>;

    /**
     * Checks if this resolver is a match for a given AppResource. This should be designed to be as fast as possible.
     * @param resource The AppResource to check if this resolver matches
     */
    matchesResource(resource: AppResource): boolean;
}
```

To provide resources that should show in the workspace view, use `registerWorkspaceResourceProvider`.

```typescript
/**
 * Registers a workspace resource provider
 * @param id The provider ID. Must be unique.
 * @param provider The provider
 */
registerWorkspaceResourceProvider(id: string, provider: WorkspaceResourceProvider): vscode.Disposable;
```

The provider supplies one simple method to provide resources to show in the workspace view.

```typescript
/**
 * A provider for supplying items for the workspace resource tree (e.g., storage emulator, function apps in workspace, etc.)
 */
export interface WorkspaceResourceProvider {
    /**
     * Called to supply the tree nodes to the workspace resource tree
     * @param parent The parent tree item (which will be the root of the workspace resource tree)
     */
    provideResources(parent: AzExtParentTreeItem): vscode.ProviderResult<WorkspaceResource[] | undefined>;
}
```

## Activation
Activation of your extension can be managed in several ways. In addition to the usual activation events on commands (and any other relevant activation events), the host extension provides several ways to automatically activate your extension. In your `package.json` file, you can add `contributes.x-azResources`, like so:

```jsonc
{
    // ...
    "contributes": {
        "x-azResources": {
            "activation": {
                "onFetch": [
                    "microsoft.web/staticsites"
                ],
                "onResolve": [
                    "microsoft.web/staticsites"
                ]
            }
        }
    }
    // ...
}
```

To help determine which approach to use, choose one of the following, in order of preference:
1. If your extension has a reasonably fast activation, use `onResolve` as above. This will cause your extension to only be activated when a resource of the specified type is _resolved_. This avoids preemptive activations.
1. If your extension is slower to activate and needs a head start, use `onFetch` as above. This will cause your extension to activate as soon as a subscription is expanded containing a resource of the specified type.
1. Generally, the standard activation event `onView:azureResourceGroups` should be avoided, but is available as an option. A better option is to improve activation performance.

Additionally, if you are supplying a `WorkspaceResourceProvider`, you will also need the standard activation event, `onView:azureWorkspace`.

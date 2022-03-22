# Unified Azure Resources Extensibility Model
## Overview
The unified Azure resources extensibility model will provide a way for any number of "client" extensions to provide UI and functionality to a "host" extension, responsible for displaying Azure and local resources in a unified way. Client extensions include Azure App Service, Azure Functions, etc. Both first- and third-party extensions could be supported.

## What Can Extensions Provide?
The host extension will provide tree nodes for all Azure resources within the subscriptions in their global subscription filter. For each of these tree nodes, the host extension will permit client extensions to _resolve_ additional information--including controlling the UI aspects, but also properties and even methods to facilitate the various commands and functionality each client extension provides.

In addition to resolving Azure resources, a second view will exist for providing _local_ resources. These could include, for example, local storage emulators, function apps in the local workspace, etc. Since each extension has very different functionality for local resources, the API for providing the nodes will be far more generic--essentially, client extensions will just provide a set of tree nodes.

## Data Flow
The data flow for the node resolving process is as follows:

1. The host extension will enumerate Azure resources, and also build groupings based on that enumeration (e.g. group by Azure Resource Group, location, type, ARM tags, etc.).
1. When a group node is expanded, each of the resource nodes within will be resolved. This will involve calling into the appropriate resolver provided by the client extension.
1. If the resolver has not been registered yet (e.g. due to the client extension not being activated yet), a no-op resolver takes its place. Separately, the client extension will be activated based on custom contribution points. When it activates and registers its resolver, all matching visible resource nodes will be re-resolved. This ensures that regardless of the order or timing of activation, nodes will be resolved as soon as possible and shown to the user.
1. Once a resource node has been resolved, all the relevant commands provided by client extensions should work as before. Since each resource tree node will fundamentally have the same methods and properties as before--even though it is now being created in the host extension--only minimal changes will be needed to the code in our existing client extensions.

## API
Client extensions will primarily interact with the host extension by providing a resource resolver. This resolver will, at runtime, be able to alter the resource nodes' appearance in the tree view, along with attaching methods and data needed to facilitate various features.
<details>
<summary>registerApplicationResourceResolver</summary>

```typescript
/**
 * Resource extensions call this to register app resource resolvers.
 *
 * @param id An identifier string that must be unique
 * @param resolver The resolver
 */
export declare function registerApplicationResourceResolver(id: string, resolver: AppResourceResolver): vscode.Disposable;
```
</details>

The resolver provides two methods--`matchesResource`, to see if that resolver is applicable to a given resource, and `resolveResource`--to provide a scoped set of methods, data, etc. that are applied to the resource node created by the host extension.
<details>
<summary>AppResourceResolver</summary>

```typescript
export interface AppResourceResolver {
    resolveResource(subContext: ISubscriptionContext, resource: AppResource): vscode.ProviderResult<ResolvedAppResourceBase>;
    matchesResource(resource: AppResource): boolean;
}
```
</details>

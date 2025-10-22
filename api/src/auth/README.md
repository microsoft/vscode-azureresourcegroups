# Azure Resources Authentication and API Retrieval

This guide explains the Azure Resources authentication handshake required for API retrieval by client extensions. It also provides tools to help extensions onboard quickly and to reduce the need for custom implementations.

## The Authentication Handshake

### Setup

Azure Resources APIs are protected behind the v4 authentication layer. This layer exposes two methods that client extensions must use to gain access: `createAzureResourcesApiSession` and `getAzureResourcesApis`. On activation, client extensions must also export a receiver method called `receiveAzureResourcesApiSession` before initiating the handshake.

### Steps

1. On activation, the client extension should export its API and initiate the handshake by calling `createAzureResourcesApiSession`. The client extension should provide its own credential as part of this request, which will be used for verification later.
1. The Azure Resources extension verifies that the requesting extension is on the approved list. If approved, Azure Resources does not respond directly. Instead, it retrieves the extension's API from VS Code using the approved extension ID, then delivers the session credential via the `receiveAzureResourcesApiSession` receiver method. This ensures the credential reaches the intended recipient, even if a malicious actor initiated the request. Azure Resources also returns the original client credential so the client extension can verify it's communicating with the genuine Azure Resources extension and not a pretend actor.
1. The client extension should then use the crednetial to retrieve the Azure Resources APIs by calling `getAzureResourcesApis`.

### Diagram

![Azure Resources Handshake Diagram](../../docs/media/auth/azure-resources-handshake.png)

## Automating the Handshake

To simplify the handshake process and reduce boilerplate code, the following tools are made available and outlined below.

### The API Request

Create your extension's API (`AzureExtensionApi`) and pass it along with the necessary request context (`AzureResourcesApiRequestContext`). We'll explore how to populate this context in the section that follows.

The `prepareAzureResourcesApiRequest` function performs two key operations:

1. **Prepares client extension API** - Returns your client extension API with the required `receiveAzureResourcesApiSession` receiver method automatically added.
2. **Provides handshake initializer** - Returns a function that initiates the Resources API request handshake when called. This method polls both the client extension and host extension for up to 10 seconds to ensure both parties are ready before starting the handshake process.

```ts
const containerAppsApi: api.AzureContainerAppsExtensionApi = {
    apiVersion: '1.0.0',
    deployImage: deployImageApi,
    deployWorkspaceProject: deployWorkspaceProjectApi,
};

const { clientApi, requestResourcesApis } = prepareAzureResourcesApiRequest(context, containerAppsApi);
requestResourcesApis(/** Optional: maxWaitTimeMs */);
return createApiProvider([clientApi]);
```

### The API Request Context

The following example shows how to configure the context for an Azure Resources API handshake request. Each component serves a specific purpose in the authentication process:

**Key Components:**
- `clientCredentialManager` - Any `AzExtCredentialManager` implementation capable of creating and verifying its own credentials. This verifies that the client credential returned back with the Resources credential matches what was supplied in the original request.
- `onDidReceiveAzureResourcesApis` - Callback function that handles successful retrieval of Resources APIs.  Use this to store and register your branch provider data.
- `onHandshakeError` - Optional callback for handling handshake errors that may occur during the authentication process.

```ts
const credentialManager: AzExtCredentialManager<string> = new AzExtSignatureCredentialManager();

const context: AzureResourcesApiRequestContext = {
    azureResourcesApiVersions: ['2.0.0'],
    clientExtensionId: ext.context.extension.id,
    clientCredentialManager: credentialManager,
    onDidReceiveAzureResourcesApis: (azureResourcesApis: (AzureResourcesExtensionApi | undefined)[]) => {
        const [rgApiV2] = azureResourcesApis;
        if (!rgApiV2) {
            throw new Error();
        }
        ext.rgApiV2 = rgApiV2;
        ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(AzExtResourceType.ContainerAppsEnvironment, ext.branchDataProvider);
    },
    // Optional:
    onHandshakeError: (error: AzureResourcesHandshakeError) => {
        switch (true) {
            case error.code === AzureResourcesHandshakeErrors.CLIENT_EXT_NOT_READY.code:
            case error.code === AzureResourcesHandshakeErrors.HOST_EXT_NOT_READY.code:
            case error.code === AzureResourcesHandshakeErrors.INSUFFICIENT_CREDENTIALS.code:
            case error.code === AzureResourcesHandshakeErrors.FAILED_VERIFICATION.code:
            case error.code === AzureResourcesHandshakeErrors.FAILED_GET_API.code:
            case error.code === AzureResourcesHandshakeErrors.UNEXPECTED.code:
            default:
        }
    },
};
```

# Azure Resources Authentication and API Retrieval

This guide covers the Azure Resources authentication handshake required for API retrieval by client extensions. It also provides information on the tools available to help client extensions quickly onboard to the new flow.

## The Authentication Handshake

### Overview

Azure Resources APIs are protected behind the new v4 authentication layer. This layer exposes two methods that client extensions must use to gain access: `createAzureResourcesApiSession` and `getAzureResourcesApis`. During activation, client extensions are expected to export an API including a receiver method called `receiveAzureResourcesApiSession` before initiating the API request handshake.

### Steps

1. On activation, the client extension should export its API and initiate the handshake by calling `createAzureResourcesApiSession`. The client extension should provide its own verification credential as part of this request (more on this later).

1. The Azure Resources host extension verifies that the requesting extension is on its approved list. If approved, Azure Resources does not respond directly. Instead, it retrieves the extension's API from VS Code directly using the approved extension ID, then delivers the session credential via the `receiveAzureResourcesApiSession` receiver method. This ensures the credential reaches the approved recipient, even if a malicious actor tried to initiate the request. Azure Resources also returns the original client credential so the client extension can verify that it is communicating with the genuine Azure Resources extension.

1. The client extension should then use the Azure Resources credential to retrieve the Azure Resources APIs by calling `getAzureResourcesApis`.

### Diagram
![Azure Resources API Request Handshake](https://github.com/microsoft/vscode-azureresourcegroups/blob/main/api/docs/media/api-request-handshake.png)

## Automating the Handshake

To simplify the handshake process, the following tools are made available and outlined below.

### The API Request

Create your extension's API (`AzureExtensionApi`) and pass it along with the requisite request context (`AzureResourcesApiRequestContext`). We'll explore how to populate this context in the section that follows.

The `prepareAzureResourcesApiRequest` tool that we provide performs two key operations:

1. **Prepares client extension API** - Returns your modified client extension API with the required `receiveAzureResourcesApiSession` receiver method added.
2. **Provides handshake initializer** - Returns a function that initiates the Resources API request handshake when called.  Call this before exporting your API during extension activation.

```ts
const containerAppsApi: api.AzureContainerAppsExtensionApi = {
    apiVersion: '1.0.0',
    deployImage: deployImageApi,
    deployWorkspaceProject: deployWorkspaceProjectApi,
};

const { clientApi, requestResourcesApis } = prepareAzureResourcesApiRequest(context, containerAppsApi);
requestResourcesApis();
return createApiProvider([clientApi]);
```

### The API Request Context

The following example shows how to configure the context when preparing for an Azure Resources API handshake request.

```ts
const v2: string = '^2.0.0';

const context: AzureResourcesApiRequestContext = {
    azureResourcesApiVersions: [v2],
    clientExtensionId: 'ms-azuretools.vscode-azurecontainerapps',

    // Successful retrieval of Azure Resources APIs will be returned here
    onDidReceiveAzureResourcesApis: (azureResourcesApis: (AzureResourcesExtensionApi | undefined)[]) => {
        const [rgApiV2] = azureResourcesApis;
        if (!rgApiV2) {
            throw new Error(l10n.t('Failed to find a matching Azure Resources API for version "{0}".', v2));
        }
        ext.rgApiV2 = rgApiV2;
        ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(AzExtResourceType.ContainerAppsEnvironment, ext.branchDataProvider);
    },

    // Optional
    onApiRequestError: async (error: AzureResourcesApiRequestError) => {
        switch (true) {
            case error.code === AzureResourcesHandshakeErrors.CLIENT_FAILED_CREATE_CREDENTIAL.code:
            case error.code === AzureResourcesHandshakeErrors.HOST_CREATE_SESSION_FAILED.code:
            case error.code === AzureResourcesHandshakeErrors.CLIENT_RECEIVED_INSUFFICIENT_CREDENTIALS.code:
            case error.code === AzureResourcesHandshakeErrors.CLIENT_CREDENTIAL_FAILED_VERIFICATION.code:
            case error.code === AzureResourcesHandshakeErrors.HOST_API_PROVISIONING_FAILED.code:
            default:
        }
    },

};
```

---

[Back to README](https://github.com/microsoft/vscode-azureresourcegroups/blob/main/api/README.md)

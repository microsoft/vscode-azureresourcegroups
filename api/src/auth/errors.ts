/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Standard errors for Azure Resources API handshake operations.
 */
export const AzureResourcesHandshakeErrors = {
    /**
     * The client extension failed to export its API within the expected timeout period during handshake initialization.
     */
    CLIENT_EXT_NOT_READY: { code: 'ERR_CLIENT_EXT_NOT_READY', message: 'Client extension has no available API.' },

    /**
     * The host extension failed to export its API within the expected timeout period during handshake initialization.
     */
    HOST_EXT_NOT_READY: { code: 'ERR_HOST_EXT_NOT_READY', message: 'Host extension has no available API.' },

    /**
     * The client extension's receiver method was invoked without the required authentication credentials.
     */
    INSUFFICIENT_CREDENTIALS: { code: 'ERR_INSUFFICIENT_CREDENTIALS', message: 'Insufficient credentials were provided for the operation.' },

    /**
     * The provided client credentials failed verification or could not be validated.
     */
    FAILED_VERIFICATION: { code: 'ERR_FAILED_VERIFICATION' },

    /**
     * An error occurred while requesting the API from the Azure Resources extension.
     */
    FAILED_GET_API: { code: 'ERR_GET_AZURE_RESOURCES_API' },

    /**
     * An unexpected error occurred during the handshake process.
     */
    UNEXPECTED: { code: 'ERR_UNEXPECTED' },

} as const;

export type AzureResourcesHandshakeError = Omit<typeof AzureResourcesHandshakeErrors[keyof typeof AzureResourcesHandshakeErrors], 'message'> & { message: string };

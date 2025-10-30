/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * List of errors that could occur during the authentication handshake between client extension and Azure Resources host extension.
 */
export const AzureResourcesHandshakeErrors = {

    /**
     * The client extension failed to activate and export its API within the timeout period allotted.
     */
    CLIENT_EXT_HANDSHAKE_TIMEOUT: {
        code: 'ERR_CLIENT_EXT_HANDSHAKE_TIMEOUT',
        message: 'Client extension API not available.'
    },

    /**
     * The Azure Resources host extension failed to activate and export its API within the timeout period allotted.
     */
    HOST_EXT_HANDSHAKE_TIMEOUT: {
        code: 'ERR_HOST_EXT_HANDSHAKE_TIMEOUT',
        message: 'Azure Resources host extension API not available.'
    },

    /**
     * The authentication handshake failed because the client was provided incomplete or missing credentials.
     *
     * This occurs when the client's receiver method is invoked without the required
     * Azure Resources token and client extension token.
     */
    CLIENT_RECEIVED_INSUFFICIENT_CREDENTIALS: {
        code: 'ERR_CLIENT_RECEIVED_INSUFFICIENT_CREDENTIALS',
        message: 'Insufficient credentials were provided back to the client.',
    },

    /**
     * The client token that was passed back with the Azure Resources token failed verification.
     *
     * This may occur when:
     * - An untrusted extension pretends to be the Azure Resources host extension
     * - There is a faulty behavior in the client credential manager's verification process
     */
    CLIENT_RECEIVED_UNVERIFIED_CREDENTIAL: { code: 'ERR_CLIENT_RECEIVED_UNVERIFIED_CREDENTIAL' },

    /**
     * Failed to obtain the Azure Resources API from the host extension.
     *
     * This may occur when:
     * - The Azure Resources extension cannot verify the issued token that was passed back
     * - The requesting extension is not on the Azure Resources allowlist
     * - The host extension encounters an internal error during API provisioning
     */
    HOST_FAILED_GET_AZURE_RESOURCES_API: { code: 'ERR_HOST_FAILED_GET_AZURE_RESOURCES_API' },

    /**
     * An unaccounted-for error occurred anytime during the handshake process.
     */
    UNEXPECTED: { code: 'ERR_UNEXPECTED' },

} as const;

export type AzureResourcesHandshakeError = Omit<typeof AzureResourcesHandshakeErrors[keyof typeof AzureResourcesHandshakeErrors], 'message'> & { message: string };

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * List of errors that could occur during the authentication handshake between client extension and Azure Resources host extension.
 */
export const AzureResourcesApiRequestErrors = {

    /**
     * An error occurred while the client extension was creating its verification credential for the Azure Resources host extension.
     */
    CLIENT_FAILED_CREATE_CREDENTIAL: { code: 'ERR_CLIENT_FAILED_CREATE_CREDENTIAL' },

    /**
     * An error occurred while the Azure Resources host extension was trying to create an API session.
     */
    HOST_CREATE_SESSION_FAILED: { code: 'ERR_HOST_CREATE_SESSION_FAILED' },

    /**
     * An error occurred because the client's receiver method was provided incomplete or missing credentials.
     */
    CLIENT_RECEIVED_INSUFFICIENT_CREDENTIALS: {
        code: 'ERR_CLIENT_RECEIVED_INSUFFICIENT_CREDENTIALS',
        message: 'Insufficient credentials were provided back to the client.',
    },

    /**
     * The client's receiver method was provided a client credential that failed verification.
     *
     * This may occur when:
     * - An untrusted extension pretends to be the Azure Resources host extension and tries to pass a fake credential
     * - There is a faulty behavior in the client's verification process
     */
    CLIENT_CREDENTIAL_FAILED_VERIFICATION: { code: 'ERR_CLIENT_CREDENTIAL_FAILED_VERIFICATION' },

    /**
     * An error occurred while asking the Azure Resources host extension to provision the specified APIs.
     *
     * This may occur when:
     * - The Azure Resources extension cannot verify the issued credential that was passed back
     * - The requesting extension is not on the Azure Resources allow list
     * - The host extension encounters an internal error during API provisioning
     */
    HOST_API_PROVISIONING_FAILED: { code: 'ERR_HOST_API_PROVISIONING_FAILED' },

} as const;

export type AzureResourcesApiRequestError = Omit<typeof AzureResourcesApiRequestErrors[keyof typeof AzureResourcesApiRequestErrors], 'message'> & { message: string };

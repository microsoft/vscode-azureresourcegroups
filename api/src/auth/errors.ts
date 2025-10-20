/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const AzureResourcesHandshakeErrors = {
    CLIENT_EXT_NOT_READY: { code: 'ERR_CLIENT_EXT_NOT_READY', message: 'Client extension has no available API.' },
    HOST_EXT_NOT_READY: { code: 'ERR_HOST_EXT_NOT_READY', message: 'Host extension has no available API.' },
    /**
     * This generally shouldn't happen - it likely means an extension is calling your endpoint with missing credentials
     */
    INSUFFICIENT_CREDENTIALS: { code: 'ERR_INSUFFICIENT_CREDENTIALS', message: 'Insufficient credentials were provided for the operation.' },
    FAILED_VERIFICATION: { code: 'ERR_FAILED_VERIFICATION' },
    FAILED_GET_API: { code: 'ERR_GET_AZURE_RESOURCES_API' },
    UNEXPECTED: { code: 'ERR_UNEXPECTED' },
} as const;

export type AzureResourcesHandshakeError = Omit<typeof AzureResourcesHandshakeErrors[keyof typeof AzureResourcesHandshakeErrors], 'message'> & { message: string };

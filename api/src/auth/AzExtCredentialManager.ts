/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AzExtCredentialManager<T> {
    createCredential(payload?: T): string | Promise<string>;
    verifyCredential(credential: string, expectedPayload?: T): AzExtVerifyCredentialResult<T> | Promise<AzExtVerifyCredentialResult<T>>;

    /**
     * Masks sensitive information from a given string to ensure private credential management keys are not contained.
     * @param data The string to be processed.
     * @returns The string with any sensitive credentials masked.
     */
    maskCredentials(data: string): string;
}

export type AzExtVerifyCredentialResult<T> = {
    verified: boolean;
    payload?: T;
    [key: string]: unknown;
};

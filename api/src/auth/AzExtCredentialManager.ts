/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AzExtCredentialManager<T> {
    createCredential(payload?: T): string | Promise<string>;
    verifyCredential(credential: string, expectedPayload?: T): AzExtVerifyCredentialResult<T> | Promise<AzExtVerifyCredentialResult<T>>;
    getMaskValues(): string[];
}

export type AzExtVerifyCredentialResult<T> = {
    verified: boolean;
    payload?: T;
    [key: string]: unknown;
};

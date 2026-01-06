/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AzExtCredentialManager {
    createCredential(extensionId: string): string | Promise<string>;
    verifyCredential(credential: string, extensionId?: string): boolean | Promise<boolean>;

    /**
     * Masks sensitive information from a given string to ensure private credential management keys from the manager are not exposed.
     * @param data - The string to be processed.
     * @returns The same string stripped of any sensitive credentials.
     */
    maskCredentials(data: string): string;
}

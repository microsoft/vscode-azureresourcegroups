/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

export * from './AzExtResourceType';
export * from './extensionApi';
export * from './getAzExtResourceType';
export * from './resources/azure';
export * from './resources/base';
export * from './resources/resourcesApi';
export * from './resources/workspace';
export * from './utils/apiUtils';
export * from './utils/getApi';
export * from './utils/wrapper';

// Temporary until @types/vscode 1.105.0 is published
declare module 'vscode' {
    /**
     * Represents parameters for creating a session based on a WWW-Authenticate header value.
     * This is used when an API returns a 401 with a WWW-Authenticate header indicating
     * that additional authentication is required. The details of which will be passed down
     * to the authentication provider to create a session.
     */
    export interface AuthenticationWwwAuthenticateRequest {
        /**
         * The raw WWW-Authenticate header value that triggered this challenge.
         * This will be parsed by the authentication provider to extract the necessary
         * challenge information.
         */
        readonly wwwAuthenticate: string;

        /**
         * The fallback scopes to use if no scopes are found in the WWW-Authenticate header.
         */
        readonly fallbackScopes?: readonly string[];
    }
}

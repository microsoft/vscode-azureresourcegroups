/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vscode-nls';

const localize: nls.LocalizeFunc = nls.loadMessageBundle();

/**
 * Aliases that identify a service as a data store.
 */
const dataStoreAliases = {
    azureStorage: ["storage", "azurite"],
    postgres: ["postgre"],
    cosmosDb: ["cosmos"],
    sql: ["sql"],
    mysql: ["mysql", "mariadb"],
    redis: ["redis", "cache"],
    mongo: ["mongo"],
    cassandra: ["cassandra"],
    gremlin: ["gremlin"],
    database: ["database", "db"],
} as const;

/**
 * Data stores that have full-fidelity local emulator support.
 */
const supportedDataStoreAliases = {
    azureStorage: ["storage", "azurite"],
    postgres: ["postgre"],
} as const;

/**
 * Returns true if the service is a data store that lacks full emulator support.
 */
export function isLimitedSupportDataStore(service: string): boolean {
    const s = service.trim().toLowerCase();

    const isDataStore = Object.values(dataStoreAliases).some((aliases) =>
        aliases.some((alias) => s.includes(alias)),
    );
    if (!isDataStore) {
        return false;
    }

    const isSupported = Object.values(supportedDataStoreAliases).some((aliases) =>
        aliases.some((alias) => s.includes(alias)),
    );

    return !isSupported;
}

/**
 * The user-facing message shown when a data store lacks a full-fidelity local
 * emulator. Kept in one place so every view surfaces identical wording.
 */
export function limitedSupportWarningMessage(): string {
    return localize('limitedSupportWarning', 'Limited Support - Emulator support for this service has not yet been fully implemented');
}

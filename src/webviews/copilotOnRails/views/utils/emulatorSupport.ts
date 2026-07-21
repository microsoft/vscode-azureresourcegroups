/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vscode-nls';

const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const supportedDataStoreAliases = {
    azureStorage: ["storage", "azurite"],
    postgres: ["postgre"],
} as const;

const limitedSupportDataStoreAliases = {
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
 * Data store services whose local emulators only partially replicate the real
 * Azure service.
 */
export function isLimitedSupportDataStore(service: string): boolean {
    const s = service.trim().toLowerCase();

    const isSupported = Object.values(supportedDataStoreAliases).some((aliases) =>
        aliases.some((alias) => s.includes(alias)),
    );

    if (isSupported) {
        return false;
    }

    return Object.values(limitedSupportDataStoreAliases).some((aliases) =>
        aliases.some((alias) => s.includes(alias)),
    );
}

/**
 * The user-facing message shown when a data store lacks a full-fidelity local
 * emulator. Kept in one place so every view surfaces identical wording.
 */
export function limitedSupportWarningMessage(): string {
    return localize('limitedSupportWarning', 'Limited Support - Emulator support for this service has not yet been fully implemented');
}

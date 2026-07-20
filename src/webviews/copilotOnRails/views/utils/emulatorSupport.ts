/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Data store services whose local emulators only partially replicate the real
 * Azure service. Azure Storage (Azurite) and PostgreSQL have full-fidelity
 * emulators, so they're excluded. Non-data-store services (e.g. messaging) are
 * intentionally not flagged.
 */
export function isLimitedSupportDataStore(service: string): boolean {
    const s = service.toLowerCase();
    if (/storage|azurite|postgre/.test(s)) {
        return false;
    }

    return /cosmos|\bsql\b|mysql|mariadb|redis|cache|mongo|cassandra|gremlin|database|\bdb\b/.test(
        s,
    );
}

/**
 * The user-facing message shown when a data store lacks a full-fidelity local
 * emulator. Kept in one place so every view surfaces identical wording.
 */
export function limitedSupportWarningMessage(): string {
    return 'Limited Support - Emulator support for this service has not yet been fully implemented';
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure logic behind the temporary migration firewall exception. Deliberately free of `vscode` and
 * Azure SDK imports so the invariants below can be unit-tested directly — they are the entire
 * reason the tool pair exists, and an invariant that is only asserted inside an ARM round-trip is
 * an invariant nobody tests.
 *
 * The Azure-facing half lives in `migrationFirewallAccess.ts`.
 */

/** Database servers whose firewall this tool is allowed to touch. */
export type SupportedServerKind = 'postgresql-flexible' | 'mysql-flexible' | 'sql-server';

/**
 * Reserved prefix for rules this extension creates. Nothing outside this prefix is ever created,
 * modified, or deleted, which is what makes an abandoned rule unambiguously ours to reap.
 */
export const TEMP_RULE_PREFIX = 'cor-tempmigration-';

/** Default lifetime of an access lease. */
export const DEFAULT_TTL_MINUTES = 30;
/** Upper bound on lease lifetime — a migration that takes longer should use tier 1 or 2. */
export const MAX_TTL_MINUTES = 120;

/** Bound on outstanding leases. Reaching it means reconciliation is not keeping up — see `MAX_LEASES` use in `openMigrationAccess`. */
export const MAX_LEASES = 10;

export interface ParsedServerResourceId {
    subscriptionId: string;
    resourceGroup: string;
    serverName: string;
    kind: SupportedServerKind;
}

/** A recorded, still-outstanding firewall exception. Persisted so it can be reaped after a crash. */
export interface MigrationAccessLease {
    serverResourceId: string;
    serverKind: SupportedServerKind;
    subscriptionId: string;
    ruleName: string;
    clientIp: string;
    sessionId: string;
    /** ISO-8601. */
    createdAt: string;
    /** ISO-8601. */
    expiresAt: string;
    /** Why tiers 1 and 2 were not viable, surfaced in the deploy summary. */
    reason: string;
}

const PROVIDER_TO_KIND: ReadonlyMap<string, SupportedServerKind> = new Map([
    ['microsoft.dbforpostgresql/flexibleservers', 'postgresql-flexible'],
    ['microsoft.dbformysql/flexibleservers', 'mysql-flexible'],
    ['microsoft.sql/servers', 'sql-server'],
]);

/**
 * API versions pinned to the ones the scaffold phase generates in `bicep-patterns-data.md`, so the
 * rule this tool writes and the rules the IaC writes are managed through the same contract.
 */
const API_VERSION_BY_KIND: Readonly<Record<SupportedServerKind, string>> = {
    'postgresql-flexible': '2024-08-01',
    'mysql-flexible': '2023-12-30',
    'sql-server': '2021-11-01',
};

export function firewallApiVersion(kind: SupportedServerKind): string {
    return API_VERSION_BY_KIND[kind];
}

/**
 * Parses a server ARM id, returning `undefined` for anything that is not one of the three
 * supported server kinds. Refusing unknown providers is a safety property, not just validation:
 * it stops the tool being pointed at an arbitrary resource whose `firewallRules` child means
 * something entirely different.
 */
export function parseServerResourceId(resourceId: string): ParsedServerResourceId | undefined {
    const match = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/([^/]+\/[^/]+)\/([^/]+)$/i.exec(resourceId.trim());
    if (!match) {
        return undefined;
    }
    const [, subscriptionId, resourceGroup, provider, serverName] = match;
    const kind = PROVIDER_TO_KIND.get(provider.toLowerCase());
    return kind ? { subscriptionId, resourceGroup, serverName, kind } : undefined;
}

export type ClientIpRejection = 'malformed' | 'unspecified' | 'broadcast';

export interface ClientIpValidation {
    ip?: string;
    rejection?: ClientIpRejection;
}

/**
 * Accepts a single dotted-quad IPv4 address and rejects the two values that would turn a
 * "single IP" rule into a wildcard. `0.0.0.0` is special-cased by Azure to mean "all Azure
 * services", and a `0.0.0.0`–`255.255.255.255` pair is the open-to-the-internet rule this tool
 * exists to prevent, so neither endpoint may ever originate from caller input.
 */
export function validateClientIp(candidate: string): ClientIpValidation {
    const trimmed = candidate.trim();
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(trimmed);
    if (!match) {
        return { rejection: 'malformed' };
    }
    const octets = match.slice(1, 5);
    for (const octet of octets) {
        // Reject leading zeros so "010.0.0.1" can't be read as octal by one parser and decimal by another.
        if (octet.length > 1 && octet.startsWith('0')) {
            return { rejection: 'malformed' };
        }
        if (Number(octet) > 255) {
            return { rejection: 'malformed' };
        }
    }
    if (trimmed === '0.0.0.0') {
        return { rejection: 'unspecified' };
    }
    if (trimmed === '255.255.255.255') {
        return { rejection: 'broadcast' };
    }
    return { ip: trimmed };
}

/** Azure firewall rule names allow alphanumerics, hyphens and underscores only. */
export function sanitizeSessionId(sessionId: string): string {
    const cleaned = sessionId.replace(/[^A-Za-z0-9-]/g, '').slice(0, 32);
    return cleaned.length > 0 ? cleaned : 'nosession';
}

export function buildTempRuleName(sessionId: string, expiresAt: Date): string {
    return `${TEMP_RULE_PREFIX}${sanitizeSessionId(sessionId)}-${Math.floor(expiresAt.getTime() / 1000)}`;
}

/**
 * Recognises a rule name this extension generated, by matching the **whole grammar**
 * `buildTempRuleName` emits rather than just its prefix.
 *
 * This is a resource-name check, not a label check, and the distinction is the point.
 * `closeMigrationAccess` interpolates the name into an ARM resource id, so a prefix-only
 * guard would accept `cor-tempmigration-x/..` and let extra path segments through — the
 * caller could then aim the delete at a resource this extension never created, which is
 * precisely the protection the prefix was supposed to provide.
 *
 * Anchored, no path separators, and length-bounded to Azure's 128-character limit for
 * firewall rule names.
 */
export function isTempRuleName(ruleName: string): boolean {
    return ruleName.length <= 128 && /^cor-tempmigration-[A-Za-z0-9-]{1,32}-\d{1,19}$/.test(ruleName);
}

export function clampTtlMinutes(ttlMinutes: number | undefined): number {
    if (ttlMinutes === undefined || !Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
        return DEFAULT_TTL_MINUTES;
    }
    // Floored, so a fractional value under a minute would otherwise become 0 and mint a lease
    // that is already expired the moment it is written.
    return Math.max(1, Math.min(Math.floor(ttlMinutes), MAX_TTL_MINUTES));
}

export function isLeaseExpired(lease: MigrationAccessLease, now: Date = new Date()): boolean {
    const expiry = Date.parse(lease.expiresAt);
    // An unparseable expiry is treated as expired so a corrupted record still gets reaped.
    return Number.isNaN(expiry) || expiry <= now.getTime();
}

/**
 * Reads `publicNetworkAccess` across the two shapes the supported providers use: the flexible
 * servers nest it under `properties.network`, Azure SQL puts it directly on `properties`.
 */
export function readPublicNetworkAccess(properties: unknown): 'Enabled' | 'Disabled' | undefined {
    if (typeof properties !== 'object' || properties === null) {
        return undefined;
    }
    const bag = properties as { publicNetworkAccess?: unknown; network?: { publicNetworkAccess?: unknown } };
    const raw = bag.publicNetworkAccess ?? bag.network?.publicNetworkAccess;
    if (typeof raw !== 'string') {
        return undefined;
    }
    const normalized = raw.toLowerCase();
    if (normalized === 'enabled') {
        return 'Enabled';
    }
    return normalized === 'disabled' ? 'Disabled' : undefined;
}

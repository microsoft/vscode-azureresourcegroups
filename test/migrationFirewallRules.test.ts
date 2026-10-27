/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type { MigrationAccessLease } from '../src/utils/copilotOnRails/migrationFirewallRules';
import {
    buildTempRuleName,
    clampTtlMinutes,
    firewallApiVersion,
    isLeaseExpired,
    isTempRuleName,
    MAX_TTL_MINUTES,
    parseServerResourceId,
    readPublicNetworkAccess,
    sanitizeSessionId,
    TEMP_RULE_PREFIX,
    validateClientIp,
} from '../src/utils/copilotOnRails/migrationFirewallRules';

const pgServerId = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-app/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg-app';

function lease(overrides: Partial<MigrationAccessLease> = {}): MigrationAccessLease {
    return {
        serverResourceId: pgServerId,
        serverKind: 'postgresql-flexible',
        subscriptionId: '00000000-0000-0000-0000-000000000000',
        ruleName: `${TEMP_RULE_PREFIX}session1-1700000000`,
        clientIp: '20.30.40.50',
        sessionId: 'session1',
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-01T00:30:00.000Z',
        reason: 'no compute in the database network',
        ...overrides,
    };
}

suite('migrationFirewallRules', () => {

    suite('parseServerResourceId', () => {
        test('recognizes the three supported server kinds', () => {
            assert.strictEqual(parseServerResourceId(pgServerId)?.kind, 'postgresql-flexible');
            assert.strictEqual(parseServerResourceId('/subscriptions/s/resourceGroups/rg/providers/Microsoft.DBforMySQL/flexibleServers/my')?.kind, 'mysql-flexible');
            assert.strictEqual(parseServerResourceId('/subscriptions/s/resourceGroups/rg/providers/Microsoft.Sql/servers/sql')?.kind, 'sql-server');
        });

        test('is case insensitive on the provider segment', () => {
            assert.strictEqual(parseServerResourceId('/subscriptions/s/resourcegroups/rg/providers/microsoft.dbforpostgresql/flexibleservers/pg')?.kind, 'postgresql-flexible');
        });

        test('extracts subscription, resource group and server name', () => {
            const parsed = parseServerResourceId(pgServerId);
            assert.strictEqual(parsed?.subscriptionId, '00000000-0000-0000-0000-000000000000');
            assert.strictEqual(parsed?.resourceGroup, 'rg-app');
            assert.strictEqual(parsed?.serverName, 'pg-app');
        });

        // Refusing unknown providers keeps the tool from being pointed at an arbitrary resource
        // whose `firewallRules` child means something else entirely.
        test('rejects unsupported providers', () => {
            assert.strictEqual(parseServerResourceId('/subscriptions/s/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa'), undefined);
            assert.strictEqual(parseServerResourceId('/subscriptions/s/resourceGroups/rg/providers/Microsoft.DBforPostgreSQL/servers/legacy-single'), undefined);
        });

        test('rejects malformed ids', () => {
            assert.strictEqual(parseServerResourceId(''), undefined);
            assert.strictEqual(parseServerResourceId('not-an-arm-id'), undefined);
            // A child resource id must not be accepted as a server id.
            assert.strictEqual(parseServerResourceId(`${pgServerId}/firewallRules/some-rule`), undefined);
        });
    });

    suite('validateClientIp', () => {
        test('accepts a normal public IPv4 address', () => {
            assert.strictEqual(validateClientIp('20.30.40.50').ip, '20.30.40.50');
            assert.strictEqual(validateClientIp('  20.30.40.50  ').ip, '20.30.40.50');
        });

        // These two are the whole point: either endpoint would turn a "single IP" rule into a
        // wildcard, and 0.0.0.0 additionally means "all Azure services" to Azure.
        test('rejects the wildcard addresses', () => {
            assert.strictEqual(validateClientIp('0.0.0.0').rejection, 'unspecified');
            assert.strictEqual(validateClientIp('255.255.255.255').rejection, 'broadcast');
        });

        test('rejects malformed addresses', () => {
            for (const bad of ['', 'localhost', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.-1', '20.30.40.50/32', '::1']) {
                assert.strictEqual(validateClientIp(bad).rejection, 'malformed', `expected "${bad}" to be rejected`);
            }
        });

        test('rejects leading zeros so octal and decimal readings cannot diverge', () => {
            assert.strictEqual(validateClientIp('010.0.0.1').rejection, 'malformed');
        });
    });

    suite('rule naming', () => {
        test('every generated name carries the reserved prefix', () => {
            assert.ok(isTempRuleName(buildTempRuleName('abc', new Date('2026-01-01T00:30:00Z'))));
        });

        test('strips characters Azure rule names disallow', () => {
            assert.strictEqual(sanitizeSessionId('ab/c_1.2 3'), 'abc123');
            assert.strictEqual(sanitizeSessionId('!!!'), 'nosession');
            assert.strictEqual(sanitizeSessionId('a'.repeat(64)).length, 32);
        });

        test('encodes the expiry so an abandoned rule is self-describing', () => {
            const expires = new Date('2026-01-01T00:30:00Z');
            assert.strictEqual(buildTempRuleName('sess', expires), `${TEMP_RULE_PREFIX}sess-${Math.floor(expires.getTime() / 1000)}`);
        });

        // The guard that stops a caller deleting an IaC-created rule.
        test('does not claim rules it did not create', () => {
            assert.strictEqual(isTempRuleName('AllowAllAzureServicesAndResourcesWithinAzureIps'), false);
            assert.strictEqual(isTempRuleName('AllowAllWindowsAzureIps'), false);
            assert.strictEqual(isTempRuleName('ClientIPAddress_2026-1-1'), false);
        });

        // The prefix alone is not a resource-name check: `closeMigrationAccess` interpolates the
        // name into an ARM resource id, so anything that can introduce a path segment or otherwise
        // escape the firewallRules child must be rejected even though it starts correctly.
        test('rejects names that carry the prefix but escape the rule grammar', () => {
            for (const bad of [
                `${TEMP_RULE_PREFIX}x/..`,
                `${TEMP_RULE_PREFIX}x/../../providers/Microsoft.Sql/servers/other`,
                `${TEMP_RULE_PREFIX}sess-1700000000/suffix`,
                `${TEMP_RULE_PREFIX}sess`,                       // no expiry segment
                `${TEMP_RULE_PREFIX}sess-notanumber`,
                `${TEMP_RULE_PREFIX}se ss-1700000000`,           // whitespace
                `${TEMP_RULE_PREFIX}sess-1700000000 `,           // trailing space
                `x${TEMP_RULE_PREFIX}sess-1700000000`,           // not anchored at the start
                `${TEMP_RULE_PREFIX}${'a'.repeat(200)}-1700000000`,
            ]) {
                assert.strictEqual(isTempRuleName(bad), false, `expected "${bad}" to be rejected`);
            }
        });

        test('accepts exactly what buildTempRuleName emits', () => {
            for (const sessionId of ['sess', 'a-b-c', 'A1b2C3', 'a'.repeat(40)]) {
                const name = buildTempRuleName(sessionId, new Date('2026-01-01T00:30:00Z'));
                assert.strictEqual(isTempRuleName(name), true, `expected "${name}" to be accepted`);
            }
        });
    });

    suite('clampTtlMinutes', () => {
        test('defaults and caps out-of-range values', () => {
            assert.strictEqual(clampTtlMinutes(undefined), 30);
            assert.strictEqual(clampTtlMinutes(0), 30);
            assert.strictEqual(clampTtlMinutes(-5), 30);
            assert.strictEqual(clampTtlMinutes(NaN), 30);
            assert.strictEqual(clampTtlMinutes(45), 45);
            assert.strictEqual(clampTtlMinutes(9999), MAX_TTL_MINUTES);
        });

        // Floored, so without a lower bound these would mint a lease that is already expired at
        // the moment it is written — and therefore reaped before the migration could run.
        test('never returns a lifetime of zero for a positive fractional input', () => {
            assert.strictEqual(clampTtlMinutes(0.5), 1);
            assert.strictEqual(clampTtlMinutes(0.001), 1);
            assert.strictEqual(clampTtlMinutes(1.9), 1);
        });
    });

    suite('lease bookkeeping', () => {
        test('detects expiry', () => {
            assert.strictEqual(isLeaseExpired(lease(), new Date('2026-01-01T00:10:00Z')), false);
            assert.strictEqual(isLeaseExpired(lease(), new Date('2026-01-01T01:00:00Z')), true);
        });

        // A record we can't read is a record we can't trust to be closed, so treat it as reapable.
        test('treats an unparseable expiry as expired', () => {
            assert.strictEqual(isLeaseExpired(lease({ expiresAt: 'not-a-date' })), true);
        });
    });

    suite('readPublicNetworkAccess', () => {
        test('reads the flexible-server shape nested under network', () => {
            assert.strictEqual(readPublicNetworkAccess({ network: { publicNetworkAccess: 'Disabled' } }), 'Disabled');
        });

        test('reads the Azure SQL shape on properties directly', () => {
            assert.strictEqual(readPublicNetworkAccess({ publicNetworkAccess: 'Enabled' }), 'Enabled');
        });

        test('is case insensitive', () => {
            assert.strictEqual(readPublicNetworkAccess({ publicNetworkAccess: 'disabled' }), 'Disabled');
        });

        // Unknown shapes must read as undefined, never as "Disabled" — a false Disabled would block
        // a legitimate migration, and a false Enabled would be worse.
        test('returns undefined for missing or unrecognized values', () => {
            assert.strictEqual(readPublicNetworkAccess(undefined), undefined);
            assert.strictEqual(readPublicNetworkAccess(null), undefined);
            assert.strictEqual(readPublicNetworkAccess({}), undefined);
            assert.strictEqual(readPublicNetworkAccess({ publicNetworkAccess: 42 }), undefined);
            assert.strictEqual(readPublicNetworkAccess({ publicNetworkAccess: 'SomethingElse' }), undefined);
        });
    });

    suite('firewallApiVersion', () => {
        test('pins the versions the scaffold phase generates', () => {
            assert.strictEqual(firewallApiVersion('postgresql-flexible'), '2024-08-01');
            assert.strictEqual(firewallApiVersion('mysql-flexible'), '2023-12-30');
            assert.strictEqual(firewallApiVersion('sql-server'), '2021-11-01');
        });
    });
});

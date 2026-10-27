/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import { closeMigrationAccess, openMigrationAccess } from '../../src/utils/copilotOnRails/migrationFirewallAccess';

const context = {} as unknown as IActionContext;

const pgServerId = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-app/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg-app';

/**
 * Guard-path coverage for the firewall access tools. Each case here returns before any Azure call
 * is attempted, which is the point: these are the refusals that must hold even when the caller is
 * signed in and everything else would have succeeded.
 */
suite('migrationFirewallAccess guards', () => {

    suite('openMigrationAccess', () => {
        test('refuses a server kind it does not manage', async () => {
            const outcome = await openMigrationAccess(context, {
                serverResourceId: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa',
                clientIp: '20.30.40.50',
                sessionId: 'sess',
                reason: 'test',
            });
            assert.deepStrictEqual(outcome, { status: 'refused', reason: 'unsupportedServer' });
        });

        test('refuses the wildcard address that would open the server to everything', async () => {
            const outcome = await openMigrationAccess(context, {
                serverResourceId: pgServerId,
                clientIp: '0.0.0.0',
                sessionId: 'sess',
                reason: 'test',
            });
            assert.strictEqual(outcome.status, 'refused');
            assert.strictEqual(outcome.status === 'refused' ? outcome.reason : undefined, 'invalidIp');
        });

        test('refuses a malformed address rather than passing it to ARM', async () => {
            const outcome = await openMigrationAccess(context, {
                serverResourceId: pgServerId,
                clientIp: '20.30.40.50/24',
                sessionId: 'sess',
                reason: 'test',
            });
            assert.strictEqual(outcome.status, 'refused');
            assert.strictEqual(outcome.status === 'refused' ? outcome.reason : undefined, 'invalidIp');
        });
    });

    suite('closeMigrationAccess', () => {
        // The single most important guard in the feature: without it, a caller could hand the tool
        // the name of a rule the generated infrastructure created and have it deleted — exactly the
        // failure this work exists to prevent.
        test('refuses to delete a rule it did not create', async () => {
            for (const ruleName of ['AllowAllAzureServicesAndResourcesWithinAzureIps', 'AllowAllWindowsAzureIps', 'ClientIPAddress_2026-1-1']) {
                const outcome = await closeMigrationAccess(context, { serverResourceId: pgServerId, ruleName });
                assert.deepStrictEqual(outcome, { status: 'refused', reason: 'notATempRule' }, `expected "${ruleName}" to be refused`);
            }
        });

        test('refuses a server kind it does not manage', async () => {
            const outcome = await closeMigrationAccess(context, {
                serverResourceId: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa',
                ruleName: 'cor-tempmigration-sess-1700000000',
            });
            assert.deepStrictEqual(outcome, { status: 'refused', reason: 'unsupportedServer' });
        });
    });
});

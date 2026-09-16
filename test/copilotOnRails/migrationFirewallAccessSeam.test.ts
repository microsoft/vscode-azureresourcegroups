/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import type { MigrationFirewallOperations, OpenAccessInput } from '../../src/utils/copilotOnRails/migrationFirewallAccess';
import { isTempRuleName, MAX_LEASES } from '../../src/utils/copilotOnRails/migrationFirewallRules';
import { createMockSubscriptionWithFunctions } from '../api/mockServiceFactory';
import { getCachedTestApi } from '../utils/testApiAccess';

/** The running extension instance. Importing from src/ would give a second module whose ext.context is undefined. */
const mf = () => getCachedTestApi().testing.migrationFirewall;

const context = {} as unknown as IActionContext;

interface Recorder {
    ops: MigrationFirewallOperations;
    puts: { ruleResourceId: string; ip: string }[];
    deletes: string[];
    /** Leases visible at the moment `putFirewallRule` was entered, to prove write-before-create ordering. */
    leasesAtPut: number;
}

/**
 * A fake for the two ARM calls this feature makes. `properties` is what the server reports as its
 * `publicNetworkAccess` shape; `failPut`/`failDelete` drive the partial-failure paths.
 */
function recorder(options: { properties?: unknown; failPut?: boolean; failDelete?: boolean } = {}): Recorder {
    const state: Recorder = {
        puts: [],
        deletes: [],
        leasesAtPut: -1,
        ops: undefined as unknown as MigrationFirewallOperations,
    };
    state.ops = {
        getServerProperties: async () => options.properties,
        putFirewallRule: async (_c, _s, ruleResourceId, _a, ip) => {
            state.leasesAtPut = mf().readLeases().length;
            state.puts.push({ ruleResourceId, ip });
            if (options.failPut) {
                throw new Error('simulated ARM create failure');
            }
        },
        deleteFirewallRule: async (_c, _s, ruleResourceId) => {
            state.deletes.push(ruleResourceId);
            if (options.failDelete) {
                throw new Error('simulated ARM delete failure');
            }
        },
    };
    return state;
}

const ENABLED = { network: { publicNetworkAccess: 'Enabled' } };

function serverId(subscriptionId: string): string {
    return `/subscriptions/${subscriptionId}/resourceGroups/rg-app/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg-app`;
}

function input(subscriptionId: string, overrides: Partial<OpenAccessInput> = {}) {
    return {
        serverResourceId: serverId(subscriptionId),
        clientIp: '20.30.40.50',
        sessionId: 'sess1',
        reason: 'no compute in the database network',
        ...overrides,
    };
}

/**
 * Seam-level coverage of the guarantees the feature actually sells: never open a server whose
 * posture is unproven, never lose track of a rule that was created, and always be able to name a
 * rule that was left behind. The guard-path tests in the sibling file stop before Azure is
 * reached; these drive the whole path through the injected operations.
 */
suite('migrationFirewallAccess', () => {
    let subscriptionId: string;

    setup(async () => {
        subscriptionId = createMockSubscriptionWithFunctions().sub1.subscriptionId;
        await mf().clearLeases();
    });

    teardown(async () => {
        mf().setOverrideOperations(undefined);
        await mf().clearLeases();
    });

    suite('network posture is proven before anything is opened', () => {
        test('refuses a server with public access disabled', async () => {
            const fake = recorder({ properties: { network: { publicNetworkAccess: 'Disabled' } } });
            mf().setOverrideOperations(fake.ops);

            const outcome = await mf().open(context, input(subscriptionId));

            assert.deepStrictEqual(outcome, { status: 'refused', reason: 'privateNetworkingOnly' });
            assert.strictEqual(fake.puts.length, 0, 'no rule may be created');
            assert.strictEqual(mf().readLeases().length, 0);
        });

        // Fail closed. `readPublicNetworkAccess` returns undefined for an absent property, an
        // unrecognised value, or a provider shape it does not know -- and the seam allows the
        // properties bag itself to be undefined. Any of those proceeding would open a public rule
        // on a server whose posture was never established.
        for (const [label, properties] of [
            ['properties absent entirely', undefined],
            ['empty properties bag', {}],
            ['unrecognised value', { publicNetworkAccess: 'SomethingElse' }],
            ['non-string value', { publicNetworkAccess: 42 }],
        ] as const) {
            test(`refuses when posture is unverifiable: ${label}`, async () => {
                const fake = recorder({ properties });
                mf().setOverrideOperations(fake.ops);

                const outcome = await mf().open(context, input(subscriptionId));

                assert.strictEqual(outcome.status, 'refused');
                assert.strictEqual(outcome.status === 'refused' ? outcome.reason : undefined, 'publicAccessUnverified');
                assert.strictEqual(fake.puts.length, 0, 'no rule may be created');
                assert.strictEqual(mf().readLeases().length, 0);
            });
        }
    });

    suite('opening access', () => {
        test('creates a single-IP rule and records a lease', async () => {
            const fake = recorder({ properties: ENABLED });
            mf().setOverrideOperations(fake.ops);

            const outcome = await mf().open(context, input(subscriptionId));

            assert.strictEqual(outcome.status, 'opened');
            const ruleName = outcome.status === 'opened' ? outcome.lease.ruleName : '';
            assert.ok(isTempRuleName(ruleName), `"${ruleName}" should satisfy the rule grammar`);
            assert.strictEqual(fake.puts.length, 1);
            assert.strictEqual(fake.puts[0].ip, '20.30.40.50');
            assert.ok(fake.puts[0].ruleResourceId.endsWith(`/firewallRules/${ruleName}`));

            const leases = mf().readLeases();
            assert.strictEqual(leases.length, 1);
            assert.strictEqual(leases[0].ruleName, ruleName);
            assert.strictEqual(leases[0].clientIp, '20.30.40.50');
        });

        // The ordering is the whole reason a crash mid-create is recoverable: if the rule were
        // created first, a process death before the write would leave a rule nothing knows about.
        test('persists the lease before the ARM create is attempted', async () => {
            const fake = recorder({ properties: ENABLED });
            mf().setOverrideOperations(fake.ops);

            await mf().open(context, input(subscriptionId));

            assert.strictEqual(fake.leasesAtPut, 1, 'the lease must already be persisted when the create runs');
        });

        test('refuses once MAX_LEASES exceptions are already outstanding', async () => {
            const fake = recorder({ properties: ENABLED });
            mf().setOverrideOperations(fake.ops);
            for (let i = 0; i < MAX_LEASES; i++) {
                const opened = await mf().open(context, input(subscriptionId, { sessionId: `sess${i}`, ttlMinutes: 10 + i }));
                assert.strictEqual(opened.status, 'opened', `open ${i} should succeed`);
            }

            const outcome = await mf().open(context, input(subscriptionId, { sessionId: 'overflow' }));

            assert.strictEqual(outcome.status, 'refused');
            assert.strictEqual(outcome.status === 'refused' ? outcome.reason : undefined, 'tooManyOutstandingLeases');
            // The cap must refuse rather than evict: dropping the oldest lease would strand the
            // rule that has been outstanding longest, which is the opposite of the guarantee.
            assert.strictEqual(mf().readLeases().length, MAX_LEASES);
        });
    });

    suite('a create that fails', () => {
        test('cleans up and reports no change when the compensating delete succeeds', async () => {
            const fake = recorder({ properties: ENABLED, failPut: true });
            mf().setOverrideOperations(fake.ops);

            const outcome = await mf().open(context, input(subscriptionId));

            assert.strictEqual(outcome.status, 'refused');
            assert.strictEqual(fake.deletes.length, 1, 'the partially-applied rule must be cleaned up');
            assert.strictEqual(mf().readLeases().length, 0, 'a cleaned-up lease must not linger');
        });

        // The case the reviewer flagged: if cleanup also fails, a rule may exist and the caller
        // must be able to name it. Reporting "no firewall change was made" here would be false.
        test('names the outstanding rule and keeps the lease when cleanup also fails', async () => {
            const fake = recorder({ properties: ENABLED, failPut: true, failDelete: true });
            mf().setOverrideOperations(fake.ops);

            const outcome = await mf().open(context, input(subscriptionId));

            assert.strictEqual(outcome.status, 'openFailedRuleOutstanding');
            const ruleName = outcome.status === 'openFailedRuleOutstanding' ? outcome.ruleName : '';
            assert.ok(isTempRuleName(ruleName));

            const leases = mf().readLeases();
            assert.strictEqual(leases.length, 1, 'the lease must survive so reconciliation retries');
            assert.strictEqual(leases[0].ruleName, ruleName);
        });
    });

    suite('closing access', () => {
        test('removes the rule and clears the lease', async () => {
            const fake = recorder({ properties: ENABLED });
            mf().setOverrideOperations(fake.ops);
            const opened = await mf().open(context, input(subscriptionId));
            const ruleName = opened.status === 'opened' ? opened.lease.ruleName : '';

            const outcome = await mf().close(context, { serverResourceId: serverId(subscriptionId), ruleName });

            assert.deepStrictEqual(outcome, { status: 'closed' });
            assert.strictEqual(fake.deletes.length, 1);
            assert.strictEqual(mf().readLeases().length, 0);
        });

        // The agent is told to call close unconditionally in its cleanup path, so a second call
        // must not be an error. The production seam swallows 404; here the delete simply succeeds
        // again, which is the same observable contract.
        test('is idempotent', async () => {
            const fake = recorder({ properties: ENABLED });
            mf().setOverrideOperations(fake.ops);
            const opened = await mf().open(context, input(subscriptionId));
            const ruleName = opened.status === 'opened' ? opened.lease.ruleName : '';

            await mf().close(context, { serverResourceId: serverId(subscriptionId), ruleName });
            const second = await mf().close(context, { serverResourceId: serverId(subscriptionId), ruleName });

            assert.deepStrictEqual(second, { status: 'closed' });
            assert.strictEqual(mf().readLeases().length, 0);
        });

        test('keeps the lease when the delete fails, so reconciliation can retry', async () => {
            const fake = recorder({ properties: ENABLED, failDelete: true });
            mf().setOverrideOperations(fake.ops);
            const opened = await mf().open(context, input(subscriptionId));
            const ruleName = opened.status === 'opened' ? opened.lease.ruleName : '';

            const outcome = await mf().close(context, { serverResourceId: serverId(subscriptionId), ruleName });

            assert.strictEqual(outcome.status, 'failed');
            assert.strictEqual(outcome.status === 'failed' ? outcome.ruleName : undefined, ruleName);
            assert.strictEqual(mf().readLeases().length, 1, 'a rule that may still exist must stay recorded');
        });
    });

    suite('activation reconciliation', () => {
        // This is the guarantee the agent instructions cannot make: whatever happened to the
        // previous session, an abandoned rule is removed the next time the workspace opens.
        test('reaps a lease an abandoned session left behind', async () => {
            const fake = recorder({ properties: ENABLED });
            mf().setOverrideOperations(fake.ops);
            const opened = await mf().open(context, input(subscriptionId));
            const ruleName = opened.status === 'opened' ? opened.lease.ruleName : '';
            assert.strictEqual(mf().readLeases().length, 1);

            const result = await mf().reconcile(context);

            assert.strictEqual(result.removed, 1);
            assert.strictEqual(result.failed, 0);
            assert.ok(fake.deletes.some((id) => id.endsWith(`/firewallRules/${ruleName}`)));
            assert.strictEqual(mf().readLeases().length, 0);
        });

        test('is a no-op when nothing is outstanding', async () => {
            const fake = recorder({ properties: ENABLED });
            mf().setOverrideOperations(fake.ops);

            const result = await mf().reconcile(context);

            assert.deepStrictEqual(result, { removed: 0, failed: 0 });
            assert.strictEqual(fake.deletes.length, 0);
        });

        test('reports a failure and keeps the lease when the rule cannot be removed', async () => {
            const open = recorder({ properties: ENABLED });
            mf().setOverrideOperations(open.ops);
            await mf().open(context, input(subscriptionId));

            // Swap in a seam whose delete fails, standing in for a permissions or network problem
            // at activation time.
            mf().setOverrideOperations(recorder({ properties: ENABLED, failDelete: true }).ops);
            const result = await mf().reconcile(context);

            assert.strictEqual(result.removed, 0);
            assert.strictEqual(result.failed, 1);
            assert.strictEqual(mf().readLeases().length, 1, 'an unremovable rule must stay recorded');
        });
    });
});

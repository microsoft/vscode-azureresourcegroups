/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AuthAccountStateManager, getAuthAccountStateManager } from '../src/exportAuthRecord';

suite('AuthAccountStateManager Tests', () => {
    let stateManager: AuthAccountStateManager;

    setup(() => {
        stateManager = getAuthAccountStateManager();
        // Clear cache before each test
        stateManager.clearCache();
    });

    teardown(() => {
        // Clean up after each test
        stateManager.clearCache();
    });

    test('getInstance returns singleton instance', () => {
        const instance1 = getAuthAccountStateManager();
        const instance2 = getAuthAccountStateManager();
        assert.strictEqual(instance1, instance2, 'Should return the same singleton instance');
    });

    test('getCachedAccounts returns empty array initially', () => {
        const cachedAccounts = stateManager.getCachedAccounts();
        assert.strictEqual(cachedAccounts.length, 0, 'Should return empty array initially');
    });

    test('clearCache resets the cached accounts', async () => {
        // First, fetch accounts to populate cache
        await stateManager.getAccounts('microsoft');

        // Verify cache is populated (may be empty if no accounts, but should not throw)
        const cachedBefore = stateManager.getCachedAccounts();
        assert.ok(Array.isArray(cachedBefore), 'Cached accounts should be an array');

        // Clear cache
        stateManager.clearCache();

        // Verify cache is empty
        const cachedAfter = stateManager.getCachedAccounts();
        assert.strictEqual(cachedAfter.length, 0, 'Should return empty array after clearing cache');
    });

    test('getAccounts returns accounts with change detection flags', async () => {
        const result = await stateManager.getAccounts('microsoft');

        assert.ok(result, 'Result should be defined');
        assert.ok(Array.isArray(result.accounts), 'accounts should be an array');
        assert.strictEqual(typeof result.hasNewAccounts, 'boolean', 'hasNewAccounts should be a boolean');
        assert.strictEqual(typeof result.accountsRemoved, 'boolean', 'accountsRemoved should be a boolean');
    });

    test('getAccounts caches accounts after first fetch', async () => {
        // First fetch
        const firstResult = await stateManager.getAccounts('microsoft');
        const firstCached = stateManager.getCachedAccounts();

        // Verify cache is populated
        assert.strictEqual(firstCached.length, firstResult.accounts.length, 'Cache should match fetched accounts');

        // Verify cached accounts match fetched accounts
        for (let i = 0; i < firstCached.length; i++) {
            assert.strictEqual(firstCached[i].id, firstResult.accounts[i].id, 'Cached account IDs should match');
            assert.strictEqual(firstCached[i].label, firstResult.accounts[i].label, 'Cached account labels should match');
        }
    });

    test('getCachedAccounts returns a copy of the cache', () => {
        const cached1 = stateManager.getCachedAccounts();
        const cached2 = stateManager.getCachedAccounts();

        // Both should be arrays
        assert.ok(Array.isArray(cached1), 'Should return an array');
        assert.ok(Array.isArray(cached2), 'Should return an array');

        // They should have the same content but not be the same reference
        assert.notStrictEqual(cached1, cached2, 'Should return different array instances');
    });

    test('getAccounts handles concurrent calls gracefully', async () => {
        // Make multiple concurrent calls
        const promises = [
            stateManager.getAccounts('microsoft'),
            stateManager.getAccounts('microsoft'),
            stateManager.getAccounts('microsoft')
        ];

        const results = await Promise.all(promises);

        // All results should be defined
        results.forEach((result: Awaited<ReturnType<typeof stateManager.getAccounts>>, index: number) => {
            assert.ok(result, `Result ${index} should be defined`);
            assert.ok(Array.isArray(result.accounts), `Result ${index} accounts should be an array`);
        });

        // All results should have the same account IDs
        const firstAccountIds = results[0].accounts.map((acc: { id: string }) => acc.id).sort();
        results.forEach((result: Awaited<ReturnType<typeof stateManager.getAccounts>>, index: number) => {
            const accountIds = result.accounts.map((acc: { id: string }) => acc.id).sort();
            assert.deepStrictEqual(accountIds, firstAccountIds, `Result ${index} should have the same account IDs`);
        });
    });

    test('hasNewAccounts is true on first fetch with accounts', async function () {
        this.timeout(10000); // Increase timeout for authentication checks

        // Clear cache to ensure fresh state
        stateManager.clearCache();

        // First fetch
        const result = await stateManager.getAccounts('microsoft');

        // If there are accounts, hasNewAccounts should be true on first fetch
        if (result.accounts.length > 0) {
            assert.strictEqual(result.hasNewAccounts, true, 'Should detect new accounts on first fetch when accounts exist');
        } else {
            // If no accounts exist, hasNewAccounts should be false
            assert.strictEqual(result.hasNewAccounts, false, 'Should not detect new accounts when no accounts exist');
        }
    });

    test('hasNewAccounts is false on subsequent fetch with same accounts', async function () {
        this.timeout(10000); // Increase timeout for authentication checks

        // First fetch to populate cache
        await stateManager.getAccounts('microsoft');

        // Second fetch should not detect new accounts (assuming accounts haven't changed)
        const result = await stateManager.getAccounts('microsoft');

        assert.strictEqual(result.hasNewAccounts, false, 'Should not detect new accounts on subsequent fetch');
    });

    test('accountsRemoved is false when no accounts are removed', async function () {
        this.timeout(10000); // Increase timeout for authentication checks

        // First fetch to populate cache
        await stateManager.getAccounts('microsoft');

        // Second fetch should not detect removed accounts (assuming accounts haven't changed)
        const result = await stateManager.getAccounts('microsoft');

        assert.strictEqual(result.accountsRemoved, false, 'Should not detect removed accounts when accounts remain the same');
    });

    test('multiple calls to clearCache are safe', () => {
        // Clear multiple times
        stateManager.clearCache();
        stateManager.clearCache();
        stateManager.clearCache();

        // Should still return empty array
        const cached = stateManager.getCachedAccounts();
        assert.strictEqual(cached.length, 0, 'Should return empty array after multiple clears');
    });
});

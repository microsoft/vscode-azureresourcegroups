# V6 Auth Package Integration - Bug Fixes

## Overview
Integrating the v6 auth package (`@microsoft/vscode-azext-azureauth@6.0.0-alpha.1`) into the Azure Resource Groups extension.

---

## Bug 1: Accounts & Tenants view shows "Sign In" when user is already signed in

### Symptom
The Resources view correctly shows the user is signed in and displays subscriptions, but the Accounts & Tenants view incorrectly shows "Sign in to Azure..." prompt.

### Root Cause
In `TenantResourceTreeDataProvider.onGetChildren()`, when `getTenantsForAccount()` throws a `NotSignedInError` (e.g., session couldn't be obtained silently for a specific account), the error bubbled up to the outer catch block and triggered sign-in items for the entire view.

This differs from `AzureSubscriptionProviderBase.getAvailableSubscriptions()` which catches `NotSignedInError` per-account and simply skips that account, continuing to process other valid accounts.

### Fix
**File:** `src/tree/tenants/TenantResourceTreeDataProvider.ts`

1. Added `getTenantsForAccountSafe()` helper method that wraps `getTenantsForAccount()` and catches `NotSignedInError` per-account, returning `undefined` to skip that account.
2. Modified the loop to use this safe method and only add accounts that successfully load.

---

## Bug 2: Views don't refresh after signing in

### Symptom
After signing in, the views still show "Sign in to Azure..." until manually refreshed with the refresh button.

### Root Cause
The `logIn()` function and sign-in commands were calling `ext.actions.refreshAzureTree()` and `ext.actions.refreshTenantTree()` after sign-in, but they weren't setting `ext.clearCacheOnNextLoad = true`. This caused the trees to refresh but use stale cached data.

### Fix
**Files:** 
- `src/commands/accounts/logIn.ts`
- `src/commands/registerCommands.ts`

Added `ext.clearCacheOnNextLoad = true` before refreshing trees after any sign-in operation:

```typescript
// In logIn.ts
} finally {
    _isLoggingIn = false;
    ext.clearCacheOnNextLoad = true;  // Added
    ext.actions.refreshAzureTree();
    ext.actions.refreshTenantTree();
}

// In registerCommands.ts - signInToTenant commands
registerCommand('azureTenantsView.signInToTenant', async (_context, node: TenantTreeItem) => {
    await (await ext.subscriptionProviderFactory()).signIn(node);
    ext.clearCacheOnNextLoad = true;  // Added
    ext.actions.refreshTenantTree();
    ext.actions.refreshAzureTree();   // Added - refresh both trees
});

registerCommand('azureResourceGroups.signInToTenant', async () => {
    await signInToTenant(await ext.subscriptionProviderFactory());
    ext.clearCacheOnNextLoad = true;  // Added
    ext.actions.refreshTenantTree();
    ext.actions.refreshAzureTree();
});
```

---

## Status

| Bug | Status |
|-----|--------|
| Sign-in shown when already signed in | ✅ Fixed |
| Views don't refresh after signing in | ✅ Fixed |
| Build verification | ✅ Passing |

---

## Files Modified

- `src/tree/tenants/TenantResourceTreeDataProvider.ts`
  - Added import for `AzureAccount`, `AzureSubscriptionProvider`
  - Added `getTenantsForAccountSafe()` helper method
  - Skips accounts that fail to authenticate

- `src/commands/accounts/logIn.ts`
  - Added `ext.clearCacheOnNextLoad = true` after sign-in

- `src/commands/registerCommands.ts`
  - Fixed `azureTenantsView.signInToTenant` to clear cache and refresh both trees
  - Fixed `azureResourceGroups.signInToTenant` to clear cache and refresh both trees

- `src/commands/sovereignCloud/configureSovereignCloud.ts`
  - Added `ext.clearCacheOnNextLoad = true` before refreshing after environment switch

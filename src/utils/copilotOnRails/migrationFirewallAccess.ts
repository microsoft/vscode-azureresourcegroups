/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, parseError } from "@microsoft/vscode-azext-utils";
import type { AzureSubscription } from "api/src/resources/azure";
import * as vscode from "vscode";
import { ext } from "../../extensionVariables";
import { createResourceClientForSubscription } from "../../services/AzureResourcesService";
import { resolveSubscription } from "./deploymentInventoryCapture";
import {
    buildTempRuleName,
    clampTtlMinutes,
    firewallApiVersion,
    isLeaseExpired,
    isTempRuleName,
    MAX_LEASES,
    MigrationAccessLease,
    parseServerResourceId,
    readPublicNetworkAccess,
    SupportedServerKind,
    validateClientIp,
} from "./migrationFirewallRules";

/**
 * Azure-facing half of the temporary migration firewall exception.
 *
 * The agent instructions tell the model to restore the firewall "on every path — success, failure,
 * or abort". A model has no `finally`: if the chat session is compacted, the model errors, or the
 * user closes the window mid-migration, a prompt-enforced restore silently does not happen and the
 * database stays reachable. So the removal guarantee lives here instead —
 * {@link reconcileMigrationFirewallLeases} runs on activation and reaps anything an interrupted
 * session left behind. This is the same reasoning that put the deployment inventory in
 * `deploymentInventoryCapture.ts` rather than in the model's memory.
 */

const LEASE_STATE_KEY = 'copilotOnRails.firewallLeases';

/** Narrow seam over the two ARM calls this feature makes, so tests can drive it without Azure. */
export interface MigrationFirewallOperations {
    /** Returns the server's `properties` bag, or `undefined` when the server cannot be read. */
    getServerProperties(context: IActionContext, subscription: AzureSubscription, serverResourceId: string, apiVersion: string): Promise<unknown>;
    putFirewallRule(context: IActionContext, subscription: AzureSubscription, ruleResourceId: string, apiVersion: string, ip: string): Promise<void>;
    /** Must tolerate a missing rule (404) so closing an already-closed lease succeeds. */
    deleteFirewallRule(context: IActionContext, subscription: AzureSubscription, ruleResourceId: string, apiVersion: string): Promise<void>;
}

export const defaultMigrationFirewallOperations: MigrationFirewallOperations = {
    async getServerProperties(context, subscription, serverResourceId, apiVersion) {
        const client = await createResourceClientForSubscription(context, subscription);
        const resource = await client.resources.getById(serverResourceId, apiVersion);
        return resource.properties;
    },
    async putFirewallRule(context, subscription, ruleResourceId, apiVersion, ip) {
        const client = await createResourceClientForSubscription(context, subscription);
        await client.resources.beginCreateOrUpdateByIdAndWait(ruleResourceId, apiVersion, {
            properties: { startIpAddress: ip, endIpAddress: ip },
        });
    },
    async deleteFirewallRule(context, subscription, ruleResourceId, apiVersion) {
        const client = await createResourceClientForSubscription(context, subscription);
        try {
            await client.resources.beginDeleteByIdAndWait(ruleResourceId, apiVersion);
        } catch (error) {
            // A rule that is already gone is the desired end state, not a failure.
            if (getStatusCode(error) !== 404) {
                throw error;
            }
        }
    },
};

function getOperations(): MigrationFirewallOperations {
    return ext.testing.overrideMigrationFirewallOperations ?? defaultMigrationFirewallOperations;
}

function getStatusCode(error: unknown): number | undefined {
    if (typeof error === 'object' && error !== null) {
        const statusCode: unknown = (error as { statusCode?: unknown }).statusCode;
        if (typeof statusCode === 'number') {
            return statusCode;
        }
    }
    return undefined;
}

function ruleResourceId(serverResourceId: string, ruleName: string): string {
    return `${serverResourceId}/firewallRules/${ruleName}`;
}

// #region lease store

export function readLeases(): MigrationAccessLease[] {
    return ext.context.workspaceState.get<MigrationAccessLease[]>(LEASE_STATE_KEY) ?? [];
}

async function writeLeases(leases: readonly MigrationAccessLease[]): Promise<void> {
    // Deliberately not bounded here. A lease is the only record that a firewall rule exists, so
    // dropping the oldest to cap the list would strand exactly the rule that has been outstanding
    // longest — the removal guarantee would be broken by the code meant to keep state tidy.
    // Growth is bounded at the other end instead: `openMigrationAccess` refuses once MAX_LEASES
    // are outstanding, and reconciliation removes them on every activation.
    await ext.context.workspaceState.update(LEASE_STATE_KEY, [...leases]);
}

async function addLease(lease: MigrationAccessLease): Promise<void> {
    const remaining = readLeases().filter((l) => l.ruleName !== lease.ruleName);
    await writeLeases([...remaining, lease]);
}

async function removeLease(ruleName: string): Promise<void> {
    await writeLeases(readLeases().filter((l) => l.ruleName !== ruleName));
}

/** Test-only: resets the lease store between cases. Reached through `TestApi.testing.migrationFirewall`. */
export async function clearLeasesForTesting(): Promise<void> {
    await ext.context.workspaceState.update(LEASE_STATE_KEY, undefined);
}

// #endregion

export type OpenAccessOutcome =
    | { status: 'opened'; lease: MigrationAccessLease }
    | { status: 'refused'; reason: 'privateNetworkingOnly' | 'publicAccessUnverified' | 'unsupportedServer' | 'invalidIp' | 'serverUnreadable' | 'tooManyOutstandingLeases'; detail?: string }
    /**
     * The create failed *and* the compensating delete also failed, so a rule may exist with no
     * successful open to pair it with. Distinct from `refused` because the caller must be able to
     * name the rule: reporting "no firewall change was made" here would be false.
     */
    | { status: 'openFailedRuleOutstanding'; ruleName: string; detail: string };

export interface OpenAccessInput {
    serverResourceId: string;
    clientIp: string;
    sessionId: string;
    reason: string;
    ttlMinutes?: number;
}

/**
 * Creates a single-IP allow rule and records a lease for it *before* the ARM call, so a crash
 * between the write and the response still leaves a reapable record.
 */
export async function openMigrationAccess(context: IActionContext, input: OpenAccessInput): Promise<OpenAccessOutcome> {
    const parsed = parseServerResourceId(input.serverResourceId);
    if (!parsed) {
        return { status: 'refused', reason: 'unsupportedServer' };
    }

    const ipValidation = validateClientIp(input.clientIp);
    if (!ipValidation.ip) {
        return { status: 'refused', reason: 'invalidIp', detail: ipValidation.rejection };
    }

    // Leases are never dropped to make room, so the cap has to refuse here instead. Reaching it
    // means previous exceptions were not cleaned up, and opening another would compound the
    // problem rather than reveal it.
    const outstanding = readLeases();
    if (outstanding.length >= MAX_LEASES) {
        return { status: 'refused', reason: 'tooManyOutstandingLeases', detail: String(outstanding.length) };
    }

    const subscription = await resolveSubscription(parsed.subscriptionId);
    if (!subscription) {
        return { status: 'refused', reason: 'serverUnreadable', detail: 'subscriptionUnavailable' };
    }

    const apiVersion = firewallApiVersion(parsed.kind);
    const operations = getOperations();

    let serverProperties: unknown;
    try {
        serverProperties = await operations.getServerProperties(context, subscription, input.serverResourceId, apiVersion);
    } catch (error) {
        return { status: 'refused', reason: 'serverUnreadable', detail: parseError(error).message };
    }

    // Fail closed. The documented precondition for tier 3 is that public access is *already*
    // enabled, so the only value that may proceed is an explicit `Enabled`.
    //
    // `readPublicNetworkAccess` returns undefined for an absent property, an unrecognised value,
    // or a provider shape it does not know — and the seam allows `getServerProperties` to return
    // undefined outright. Treating any of those as "probably fine" would open a public firewall
    // rule on a server whose posture was never established, which is the one outcome this tool
    // exists to prevent. Refusing costs a fallback to tier 2 or a failed deploy; guessing wrong
    // costs an exposed database.
    const publicAccess = readPublicNetworkAccess(serverProperties);
    if (publicAccess === 'Disabled') {
        return { status: 'refused', reason: 'privateNetworkingOnly' };
    }
    if (publicAccess !== 'Enabled') {
        return { status: 'refused', reason: 'publicAccessUnverified' };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + clampTtlMinutes(input.ttlMinutes) * 60_000);
    const ruleName = buildTempRuleName(input.sessionId, expiresAt);

    const lease: MigrationAccessLease = {
        serverResourceId: input.serverResourceId,
        serverKind: parsed.kind,
        subscriptionId: parsed.subscriptionId,
        ruleName,
        clientIp: ipValidation.ip,
        sessionId: input.sessionId,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        reason: input.reason,
    };

    await addLease(lease);
    try {
        await operations.putFirewallRule(context, subscription, ruleResourceId(input.serverResourceId, ruleName), apiVersion, ipValidation.ip);
    } catch (error) {
        const detail = parseError(error).message;
        // The create may have partially applied, so the rule's existence is unknown. Attempt an
        // immediate cleanup rather than waiting for the next activation.
        const cleanup = await closeMigrationAccess(context, { serverResourceId: input.serverResourceId, ruleName });
        if (cleanup.status !== 'closed') {
            // The lease stays, so reconciliation will retry. But the caller must be told a rule may
            // be outstanding and given its name — reporting "no firewall change was made" would be
            // false, and the agent would report a clean deploy over an open firewall.
            return { status: 'openFailedRuleOutstanding', ruleName, detail };
        }
        return { status: 'refused', reason: 'serverUnreadable', detail };
    }

    return { status: 'opened', lease };
}

export type CloseAccessOutcome =
    | { status: 'closed' }
    | { status: 'refused'; reason: 'notATempRule' | 'unsupportedServer' }
    | { status: 'failed'; ruleName: string; detail: string };

export interface CloseAccessInput {
    serverResourceId: string;
    ruleName: string;
}

/**
 * Removes a rule this extension created. Idempotent: closing an already-closed lease succeeds, so
 * the agent can call it unconditionally in its own cleanup path.
 */
export async function closeMigrationAccess(context: IActionContext, input: CloseAccessInput): Promise<CloseAccessOutcome> {
    // Without this guard a caller could pass the name of an IaC-created rule (for example
    // `AllowAllAzureServicesAndResourcesWithinAzureIps`) and have it deleted.
    if (!isTempRuleName(input.ruleName)) {
        return { status: 'refused', reason: 'notATempRule' };
    }

    const parsed = parseServerResourceId(input.serverResourceId);
    if (!parsed) {
        return { status: 'refused', reason: 'unsupportedServer' };
    }

    const subscription = await resolveSubscription(parsed.subscriptionId);
    if (!subscription) {
        return { status: 'failed', ruleName: input.ruleName, detail: 'subscriptionUnavailable' };
    }

    try {
        await getOperations().deleteFirewallRule(context, subscription, ruleResourceId(input.serverResourceId, input.ruleName), firewallApiVersion(parsed.kind));
    } catch (error) {
        // The lease is deliberately retained so reconciliation retries on the next activation.
        return { status: 'failed', ruleName: input.ruleName, detail: parseError(error).message };
    }

    await removeLease(input.ruleName);
    return { status: 'closed' };
}

export interface ReconcileResult {
    removed: number;
    failed: number;
}

/**
 * Reaps leases an interrupted session left behind. This is the guarantee the agent instructions
 * cannot make: it runs on activation regardless of how the previous session ended, so a temporary
 * rule cannot outlive the workspace that created it.
 *
 * Expired leases are removed even if their rule is already gone, so a corrupted or already-cleaned
 * record cannot accumulate forever.
 */
export async function reconcileMigrationFirewallLeases(context: IActionContext): Promise<ReconcileResult> {
    const leases = readLeases();
    if (leases.length === 0) {
        return { removed: 0, failed: 0 };
    }

    let removed = 0;
    let failed = 0;
    for (const lease of leases) {
        const outcome = await closeMigrationAccess(context, { serverResourceId: lease.serverResourceId, ruleName: lease.ruleName });
        if (outcome.status === 'closed') {
            removed++;
        } else if (outcome.status === 'failed') {
            failed++;
            ext.outputChannel.warn(`Could not remove leftover database firewall rule "${lease.ruleName}" on ${lease.serverResourceId}: ${outcome.detail}`);
            // Drop an expired lease we still can't clean so it doesn't retry forever; the warning
            // above is the durable record, and the rule name is named explicitly for the user.
            if (isLeaseExpired(lease)) {
                await removeLease(lease.ruleName);
            }
        } else {
            // Malformed record (not our prefix, or an unsupported server) — never actionable.
            await removeLease(lease.ruleName);
        }
    }

    if (removed > 0) {
        void vscode.window.showWarningMessage(
            vscode.l10n.t('Removed {0} temporary database firewall rule(s) left behind by an interrupted migration.', removed),
        );
    }

    return { removed, failed };
}

/** Human-readable server kind for tool output. */
export function describeServerKind(kind: SupportedServerKind): string {
    switch (kind) {
        case 'postgresql-flexible':
            return 'PostgreSQL Flexible Server';
        case 'mysql-flexible':
            return 'MySQL Flexible Server';
        case 'sql-server':
            return 'Azure SQL Server';
    }
}

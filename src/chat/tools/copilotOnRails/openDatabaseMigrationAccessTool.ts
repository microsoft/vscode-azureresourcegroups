/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import * as vscode from "vscode";
import { z } from "zod/mini";
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import { describeServerKind, openMigrationAccess } from "../../../utils/copilotOnRails/migrationFirewallAccess";
import { callWithDiagnosticsAndTelemetryHandling, setCorErrorProp, setCorProp } from "../../../utils/copilotOnRails/telemetryUtils";

const openDatabaseMigrationAccessToolName = 'open_database_migration_access';

const openDatabaseMigrationAccessInputSchema = z.object({
    /** Full ARM id of the PostgreSQL Flexible, MySQL Flexible, or Azure SQL server. */
    serverResourceId: z.string(),
    /** Single IPv4 address to allow, read from the database's own connection-refusal message. */
    clientIp: z.string(),
    /** App Onboard session id, used to name the rule and correlate telemetry. */
    sessionId: z.string(),
    /** Why tiers 1 and 2 (exec in the deployed app, one-shot job) were not viable. */
    reason: z.string(),
    /** Lease lifetime; defaults to 30 minutes and is capped at 120. */
    ttlMinutes: z.optional(z.number()),
});

type OpenAccessToolInput = z.infer<typeof openDatabaseMigrationAccessInputSchema>;

export const openDatabaseMigrationAccessTool: CopilotTool<typeof openDatabaseMigrationAccessInputSchema, typeof UnspecifiedOutputSchema> = {
    name: openDatabaseMigrationAccessToolName,
    description: 'Last-resort database access for running post-deploy migrations from the local machine. Adds a temporary firewall rule allowing exactly one IP address, and records it so the extension removes it even if this session crashes or is abandoned. Only call this after tier 1 (az containerapp exec / az webapp ssh inside the deployed app) and tier 2 (a one-shot job in the same environment) have been ruled out — both reach the database with no network change at all. Refuses servers whose public network access is disabled rather than enabling it. Always pair with close_database_migration_access when the migration finishes.',
    inputSchema: openDatabaseMigrationAccessInputSchema,
    annotations: {
        openWorldHint: true,
        readOnlyHint: false,
        // Additive and reversible: creates one narrowly-scoped rule and never edits or removes
        // any rule it did not create.
        destructiveHint: false,
        idempotentHint: true,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openDatabaseMigrationAccessToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: openDatabaseMigrationAccessToolName, extras }, async (corContext) => {
                return await openAccess(corContext, input);
            });
        }) ?? {
            message: vscode.l10n.t('Failed to open temporary database migration access.'),
        };
    }
};

async function openAccess(context: CopilotOnRailsContext, input: OpenAccessToolInput): Promise<Record<string, unknown>> {
    const outcome = await openMigrationAccess(context, input);
    setCorProp(context, 'migrationAccessOutcome', outcome.status);

    if (outcome.status === 'refused') {
        setCorErrorProp(context, 'migrationAccessRefusedReason', outcome.reason);
        return { message: refusalMessage(outcome.reason, outcome.detail), refused: true, refusedReason: outcome.reason };
    }

    const { lease } = outcome;
    setCorProp(context, 'migrationAccessServerKind', lease.serverKind);
    return {
        message: vscode.l10n.t(
            'Temporary access opened on {0}: rule "{1}" allows {2} until {3}. Run the migration now, then call close_database_migration_access with this rule name. If this session ends without closing it, the extension removes the rule on its next activation.',
            describeServerKind(lease.serverKind), lease.ruleName, lease.clientIp, lease.expiresAt,
        ),
        ruleName: lease.ruleName,
        clientIp: lease.clientIp,
        expiresAt: lease.expiresAt,
        serverKind: lease.serverKind,
    };
}

function refusalMessage(reason: string, detail: string | undefined): string {
    switch (reason) {
        case 'privateNetworkingOnly':
            return vscode.l10n.t('This server has public network access disabled, so it is reachable only through its private endpoint. A firewall rule cannot help, and enabling public access is not permitted. Run the migration from inside the network instead (tier 1 or tier 2), or record the migration as incomplete in deploy-result.json and fail the deploy.');
        case 'unsupportedServer':
            return vscode.l10n.t('That resource id is not a PostgreSQL Flexible Server, MySQL Flexible Server, or Azure SQL Server, so this tool will not modify its firewall.');
        case 'invalidIp':
            return vscode.l10n.t('"{0}" is not a usable single IPv4 address. Read the client IP from the database connection-refusal message and pass exactly that address — wildcard addresses are rejected.', detail ?? 'the supplied value');
        default:
            return vscode.l10n.t('Could not read the database server, so no firewall change was made. {0}', detail ?? '');
    }
}

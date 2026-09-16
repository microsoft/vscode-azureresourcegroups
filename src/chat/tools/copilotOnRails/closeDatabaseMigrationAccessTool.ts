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
import { closeMigrationAccess } from "../../../utils/copilotOnRails/migrationFirewallAccess";
import { callWithDiagnosticsAndTelemetryHandling, setCorErrorProp, setCorProp } from "../../../utils/copilotOnRails/telemetryUtils";

const closeDatabaseMigrationAccessToolName = 'close_database_migration_access';

const closeDatabaseMigrationAccessInputSchema = z.object({
    /** The same server ARM id passed to open_database_migration_access. */
    serverResourceId: z.string(),
    /** The rule name returned by open_database_migration_access. */
    ruleName: z.string(),
});

type CloseAccessToolInput = z.infer<typeof closeDatabaseMigrationAccessInputSchema>;

export const closeDatabaseMigrationAccessTool: CopilotTool<typeof closeDatabaseMigrationAccessInputSchema, typeof UnspecifiedOutputSchema> = {
    name: closeDatabaseMigrationAccessToolName,
    description: 'Removes the temporary single-IP firewall rule created by open_database_migration_access and clears its record. Call it as soon as the migration finishes, on success and on failure alike. Safe to call more than once. It only ever removes rules this extension created, so it can never delete a rule from the generated infrastructure. If it reports that the rule could not be removed, treat the deployment as failed and name the outstanding rule to the user.',
    inputSchema: closeDatabaseMigrationAccessInputSchema,
    annotations: {
        openWorldHint: true,
        readOnlyHint: false,
        // Restores the prior state rather than destroying anything the user relies on.
        destructiveHint: false,
        idempotentHint: true,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${closeDatabaseMigrationAccessToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: closeDatabaseMigrationAccessToolName, extras }, async (corContext) => {
                return await closeAccess(corContext, input);
            });
        }) ?? {
            message: vscode.l10n.t('Failed to close temporary database migration access.'),
        };
    }
};

async function closeAccess(context: CopilotOnRailsContext, input: CloseAccessToolInput): Promise<Record<string, unknown>> {
    const outcome = await closeMigrationAccess(context, input);
    setCorProp(context, 'migrationAccessCloseOutcome', outcome.status);

    switch (outcome.status) {
        case 'closed':
            return {
                message: vscode.l10n.t('Temporary firewall rule "{0}" removed. The server firewall is back to its previous state.', input.ruleName),
                restored: true,
            };
        case 'refused':
            setCorErrorProp(context, 'migrationAccessCloseRefusedReason', outcome.reason);
            return {
                message: outcome.reason === 'notATempRule'
                    ? vscode.l10n.t('"{0}" was not created by this extension, so it will not be removed. This tool only removes its own temporary migration rules; never delete a rule created by the generated infrastructure.', input.ruleName)
                    : vscode.l10n.t('That resource id is not a supported database server, so no firewall change was made.'),
                restored: false,
                refusedReason: outcome.reason,
            };
        case 'failed':
            setCorErrorProp(context, 'migrationAccessCloseFailure', outcome.detail);
            return {
                message: vscode.l10n.t('Could not remove temporary firewall rule "{0}": {1}. Treat this deployment as FAILED, record the rule name in deploy-result.json, and tell the user it is still in place. The extension will retry removing it the next time this workspace is opened.', outcome.ruleName, outcome.detail),
                restored: false,
                outstandingRuleName: outcome.ruleName,
            };
    }
}

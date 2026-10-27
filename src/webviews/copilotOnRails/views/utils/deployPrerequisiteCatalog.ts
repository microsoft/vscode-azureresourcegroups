/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Single source of truth for the deploy-stage CLIs' canonical display names, shared by the
 * recorder (`deployPrerequisites.ts`), the deploy plan view's "unknown" fallback list, and the
 * install-link catalog (`prerequisiteInstallLinks.ts`). Centralizing the strings here keeps the
 * name the install link resolves against identical everywhere, so the azd/az rows can't drift
 * apart across the three call sites.
 *
 * This module is webview-safe (no `vscode` import) so both the extension host and the views can
 * import it.
 */

/** The tools the deploy stage always depends on. The agent may only report status for these ids. */
export type DeployPrerequisiteId = 'azd' | 'az';

export const AZURE_DEVELOPER_CLI_TOOL_NAME = 'Azure Developer CLI (azd)';
export const AZURE_CLI_TOOL_NAME = 'Azure CLI (az)';

/**
 * Fixed catalog of deploy prerequisites, in display order. The id → display-name mapping lives
 * here (not in model output), so the agent only ever reports *which known tool* and *whether it
 * was found* (the view then resolves the install link from its own catalog by this display name).
 */
export const DEPLOY_PREREQUISITE_CATALOG: readonly { id: DeployPrerequisiteId; tool: string }[] = [
    { id: 'azd', tool: AZURE_DEVELOPER_CLI_TOOL_NAME },
    { id: 'az', tool: AZURE_CLI_TOOL_NAME },
];

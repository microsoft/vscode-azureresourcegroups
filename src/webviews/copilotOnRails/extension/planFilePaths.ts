/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Canonical workspace-relative paths of the `.azure/*` plan files written by the
 * Create-with-Copilot agents. These are the single source of truth for the plan
 * file locations: import from here instead of re-declaring the literals so the
 * paths can't drift between the flow-state resolver, the plan views, and the
 * progress tree.
 *
 * Note: the `package.json` `workspaceContains` activation events reference the
 * same paths but can't import these constants (the manifest is declarative), so
 * keep them in sync by hand if a path ever changes.
 */

/** Requirements captured before planning begins. */
export const REQUIREMENTS_GLOB = '.azure/requirements.json';
/** Project (scaffold) plan. */
export const PROJECT_PLAN_GLOB = '.azure/project-plan.md';
/** Local debug / run plan. */
export const DEBUG_PLAN_GLOB = '.azure/vscode-debug-plan.md';
/** Deployment plan. */
export const DEPLOYMENT_PLAN_GLOB = '.azure/deployment-plan.md';

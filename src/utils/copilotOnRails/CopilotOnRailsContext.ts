/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";

export interface CopilotOnRailsContext extends IActionContext {
    /**
     * A stripped down set of properties analagous to `context.telemetry.properties` that are automatically attached to recorded diagnostic events.
     *
     * **Important**: This separate set of properties exists because it is not always wise to mirror telemetry properties in case of PII concerns.
     */
    diagnostics?: { properties: Record<string, unknown> };
}

export type RequiredCopilotOnRailsContext = CopilotOnRailsContext & Required<Pick<CopilotOnRailsContext, 'diagnostics'>>;

export function ensureRequiredCopilotOnRailsContext(context: IActionContext): RequiredCopilotOnRailsContext {
    const corContext: CopilotOnRailsContext = context as CopilotOnRailsContext;
    corContext.diagnostics ??= { properties: {} };
    return corContext as RequiredCopilotOnRailsContext;
}

/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";

interface WrapFunctionsInTelemetryOptions {
    /**
     * Called before each function is executed. Intended for adding telemetry properties.
     */
    beforeHook?(context: IActionContext): void;
    /**
     * Optionally add a prefix to all function callbackIds.
     */
    callbackIdPrefix?: string;
}

/**
 * Wraps a set of functions in telemetry and error handling.
 *
 * Automatically sets the following on context:
 * ```
 * context.errorHandling.rethrow = true;
 * context.errorHandling.suppressDisplay = true;
 * context.errorHandling.suppressReportIssue = true;
 * ```
 */
export function wrapFunctionsInTelemetry<TFunctions extends Record<string, (...args: unknown[]) => unknown | Promise<unknown>>>(functions: TFunctions, options?: WrapFunctionsInTelemetryOptions): TFunctions {
    const wrappedFunctions = {};

    Object.entries(functions).forEach(([functionName, func]) => {
        wrappedFunctions[functionName] = async (...args: Parameters<typeof func>): Promise<ReturnType<typeof func>> => {
            return await callWithTelemetryAndErrorHandling((options?.callbackIdPrefix ?? '') + functionName, async (context) => {
                context.errorHandling.rethrow = true;
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.suppressReportIssue = true;
                options?.beforeHook?.(context);
                return await func(...args);
            });
        }
    });

    return wrappedFunctions as TFunctions;
}

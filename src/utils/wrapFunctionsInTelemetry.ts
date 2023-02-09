/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext, parseError } from "@microsoft/vscode-azext-utils";
import { ext } from "../extensionVariables";

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
                try {
                    // await to ensure errors are handled in this scope
                    return await func(...args);
                } catch (e) {
                    ext.outputChannel.appendLog(`Internal error: '${functionName}' threw an exception\n\t${stringifyError(e)}`);
                    if (e instanceof Error) {
                        // shortened message since it might be displayed on the tree
                        e.message = `Internal error: '${functionName}' threw exception ${parseError(e).message}`;
                    }
                    throw e;
                }
            });
        }
    });

    return wrappedFunctions as TFunctions;
}

function stringifyError(e: unknown): string {
    const error = parseError(e);
    let str = `${error.message}`;
    if (error.stack) {
        str = str.concat(`\n\t\tat ${error.stack.split('\n').join('\n\t\t')}`);
    }
    return str;
}

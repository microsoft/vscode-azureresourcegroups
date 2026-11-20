/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandlingSync, IActionContext, parseError } from "@microsoft/vscode-azext-utils";
import { ext } from "../extensionVariables";
import { callWithTreeErrorHandling } from "./treeOperations";

function stringifyError(e: unknown): string {
    const error = parseError(e);
    let str = `${error.message}`;
    if (error.stack) {
        str = str.concat(`\n\t\tat ${error.stack.split('\n').join('\n\t\t')}`);
    }
    return str;
}

function handleError(e: unknown, functionName: string): never {
    ext.outputChannel?.appendLog(`Internal error: '${functionName}' threw an exception\n\t${stringifyError(e)}`);
    if (e instanceof Error) {
        e.message = functionName === 'branchDataProvider.getResourceItem' ?
            // shortened message for anything displayed on the tree
            parseError(e).message :
            `Internal error: '${functionName}' threw exception ${parseError(e).message}`;
    }

    throw e;
}

interface WrapFunctionsInTelemetryOptions {
    propagateErrors?(args: readonly unknown[]): boolean;
    /**
     * Called before each function is executed. Intended for adding telemetry properties.
     */
    beforeHook?(context: IActionContext): void;
    /**
     * Optionally add a prefix to all function callbackIds.
     */
    callbackIdPrefix?: string;
}

type AsyncFunctions<T extends Record<string, (...args: unknown[]) => unknown | Promise<unknown>>> = {
    [P in keyof T]: AsyncFunction<T[P]>;
};

type ObjectWithFunctions = Record<symbol, (...args: unknown[]) => unknown | Promise<unknown>>;

type AsyncFunction<T extends (...args: unknown[]) => Promise<unknown> | unknown> = (...args: Parameters<T>) => ReturnType<T> extends Promise<infer TPromise> ? Promise<TPromise> : Promise<ReturnType<T>>;

/**
 * Wraps a set of functions in telemetry and error handling. Returned functions are always async.
 *
 * Automatically sets the following on context:
 * ```
 * context.errorHandling.rethrow = true;
 * context.errorHandling.suppressDisplay = true;
 * context.errorHandling.suppressReportIssue = true;
 * ```
 */
export function wrapFunctionsInTelemetry<TFunctions extends ObjectWithFunctions>(functions: TFunctions, options?: WrapFunctionsInTelemetryOptions): AsyncFunctions<TFunctions> {
    const wrappedFunctions: Record<string, (...args: unknown[]) => unknown> = {};

    Object.entries(functions as Record<string, (...args: unknown[]) => unknown>).forEach(([functionName, func]) => {
        wrappedFunctions[functionName] = (...args: Parameters<typeof func>): ReturnType<typeof func> => {
            return callWithTreeErrorHandling((options?.callbackIdPrefix ?? '') + functionName, async (context) => {
                context.errorHandling.rethrow = true;
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.suppressReportIssue = true;
                options?.beforeHook?.(context);
                try {
                    return await func(...args);
                } catch (e) {
                    handleError(e, (options?.callbackIdPrefix ?? '') + functionName);
                }
            }, { propagateErrors: options?.propagateErrors?.(args) });
        };
    });

    return wrappedFunctions as AsyncFunctions<TFunctions>;
}

/**
 * Wraps a set of sync functions in telemetry and error handling.
 *
 * Automatically sets the following on context:
 * ```
 * context.errorHandling.rethrow = true;
 * context.errorHandling.suppressDisplay = true;
 * context.errorHandling.suppressReportIssue = true;
 * ```
 */
export function wrapFunctionsInTelemetrySync<TFunctions extends ObjectWithFunctions>(functions: TFunctions, options?: WrapFunctionsInTelemetryOptions): TFunctions {
    const wrappedFunctions: Record<string, (...args: unknown[]) => unknown> = {};

    Object.entries(functions as Record<string, (...args: unknown[]) => unknown>).forEach(([functionName, func]) => {
        wrappedFunctions[functionName] = (...args: Parameters<typeof func>): ReturnType<typeof func> => {
            return callWithTelemetryAndErrorHandlingSync((options?.callbackIdPrefix ?? '') + functionName, (context) => {
                context.errorHandling.rethrow = true;
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.suppressReportIssue = true;
                options?.beforeHook?.(context);
                try {
                    return func(...args);
                } catch (e) {
                    handleError(e, (options?.callbackIdPrefix ?? '') + functionName);
                }
            });
        };
    });

    return wrappedFunctions as TFunctions;
}

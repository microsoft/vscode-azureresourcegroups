#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Parse the migration controller's explicit probe switch.
 *
 * Azure controllers may serialize booleans as `true`, `True`, `false`, or `False`. Those four
 * values are unambiguous. Missing values and aliases such as `1`, `yes`, or an empty string are
 * rejected so a malformed probe request can never fall through to a real migration.
 */
export function parseMigrationProbeOnly(value) {
    if (typeof value !== "string") {
        throw new Error("MIGRATION_PROBE_ONLY is required and must be true or false");
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
        return true;
    }
    if (normalized === "false") {
        return false;
    }

    throw new Error("MIGRATION_PROBE_ONLY must be true or false");
}

export function resolveMigrationControllerMode(environment = process.env) {
    return parseMigrationProbeOnly(environment.MIGRATION_PROBE_ONLY) ? "probe" : "migrate";
}

function expectFailure(action, message) {
    try {
        action();
    } catch {
        return;
    }
    throw new Error(`Self-test failed: ${message}`);
}

function runSelfTest() {
    const history = [];
    const invoke = value => {
        const mode = resolveMigrationControllerMode({ MIGRATION_PROBE_ONLY: value });
        if (mode === "migrate") {
            history.push("applied");
        }
        return mode;
    };

    if (invoke("true") !== "probe" || invoke("True") !== "probe") {
        throw new Error("Self-test failed: canonical probe values");
    }
    if (history.length !== 0) {
        throw new Error("Self-test failed: probe changed migration history");
    }
    if (invoke("false") !== "migrate" || invoke("False") !== "migrate" || history.length !== 2) {
        throw new Error("Self-test failed: explicit migration value");
    }
    expectFailure(() => invoke(undefined), "missing value rejection");
    expectFailure(() => invoke("1"), "ambiguous value rejection");
    expectFailure(() => invoke(""), "empty value rejection");
    if (history.length !== 2) {
        throw new Error("Self-test failed: invalid values changed migration history");
    }

    return { passed: true };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    if (process.argv.length !== 3 || process.argv[2] !== "--self-test") {
        console.error("Usage: migration-probe-mode.mjs --self-test");
        process.exitCode = 1;
    } else {
        try {
            console.log(JSON.stringify(runSelfTest()));
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    }
}

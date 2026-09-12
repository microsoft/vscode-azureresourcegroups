/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Environment-level checks on the generated local development setup.
 *
 * Everything here catches a defect that a purely structural read of `launch.json`
 * cannot see: a config file that looks well-formed but hands the service a masked
 * credential, an empty interpolated variable, or an emulator that rejects the SDK
 * the app actually uses. Each rule was learned from a real failed run, so they are
 * kept together and applied to whatever generated files exist.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ArtifactValidationIssue } from './validationTypes.ts';

/** Generated files that carry credentials and connection strings. */
const CONFIG_FILE_PATTERN = /(^|[/\\])(docker-compose\.ya?ml|compose\.ya?ml|local\.settings\.json|\.env(\..+)?)$/i;

/** A run of asterisks where a value belongs — the fingerprint of a redaction filter. */
const REDACTION_MASK_PATTERN = /\*{3,}/;

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'out', '.venv', '__pycache__']);

export interface DebugEnvironmentContext {
    /** Whether the plan asked for emulators, which is what makes compose mandatory. */
    hasEmulators: boolean;
    /** Task labels declared in `tasks.json`. */
    taskLabels: Set<string>;
    /** Raw plan text, used to tell which emulator images were requested. */
    planText: string;
}

export async function validateDebugEnvironment(
    workspace: string,
    context: DebugEnvironmentContext,
    issues: ArtifactValidationIssue[],
): Promise<void> {
    await validateRedactedSecrets(workspace, issues);
    await validateComposeInterpolation(workspace, issues);
    await validateEmulatorSetup(workspace, context, issues);
}

/**
 * A secret-redaction filter rewrites a concrete credential to `***` before the text
 * reaches disk. The resulting file parses fine and then fails at runtime with an
 * authentication error that looks like a misconfigured service.
 */
async function validateRedactedSecrets(workspace: string, issues: ArtifactValidationIssue[]): Promise<void> {
    for (const filePath of await listFiles(workspace)) {
        if (!CONFIG_FILE_PATTERN.test(filePath)) {
            continue;
        }
        const content = await readIfExists(filePath);
        if (content === undefined) {
            continue;
        }
        const relative = path.relative(workspace, filePath) || path.basename(filePath);
        content.split('\n').forEach((line, index) => {
            const match = REDACTION_MASK_PATTERN.exec(line);
            // Glob patterns such as `**/*` legitimately contain adjacent asterisks.
            if (!match || line.includes('*/') || line.includes('/*')) {
                return;
            }
            issues.push({
                code: 'redactedSecretPlaceholder',
                path: `$.generatedConfig["${relative}"].line[${index + 1}]`,
                message: `${relative} line ${index + 1} contains a redaction mask ("${match[0]}") where a value is expected. `
                    + 'Build connection strings from discrete variables instead of inlining user:password@host.',
            });
        });
    }
}

/**
 * `${VAR}` in a compose file interpolates from `.env` or the shell, never from a
 * service's own `environment:` block. With nothing to resolve it, compose substitutes
 * an empty string and the dependency starts with blank credentials instead of
 * failing fast.
 */
async function validateComposeInterpolation(workspace: string, issues: ArtifactValidationIssue[]): Promise<void> {
    const composeFile = await findFirstExisting(workspace, COMPOSE_FILES);
    if (!composeFile) {
        return;
    }
    const compose = await readIfExists(path.join(workspace, composeFile));
    if (compose === undefined) {
        return;
    }

    const referenced = new Set<string>();
    for (const match of compose.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(:?-[^}]*)?\}/g)) {
        // A default (`${VAR:-fallback}`) makes the reference safe on its own.
        if (!match[2]) {
            referenced.add(match[1]);
        }
    }
    if (referenced.size === 0) {
        return;
    }

    const envText = await readIfExists(path.join(workspace, '.env'));
    const declared = envText === undefined ? new Set<string>() : parseEnvKeys(envText);
    const missing = [...referenced].filter(name => !declared.has(name)).sort();
    if (missing.length > 0) {
        issues.push({
            code: 'missingComposeEnvValues',
            path: '$.compose.interpolation',
            message: `${composeFile} interpolates ${missing.map(name => `\${${name}}`).join(', ')} but `
                + `${envText === undefined ? 'no .env file exists' : `.env does not declare ${missing.length === 1 ? 'it' : 'them'}`}. `
                + 'Compose resolves undeclared variables to an empty string, so services start with blank credentials.',
        });
    }
}

async function validateEmulatorSetup(
    workspace: string,
    context: DebugEnvironmentContext,
    issues: ArtifactValidationIssue[],
): Promise<void> {
    if (!context.hasEmulators) {
        return;
    }
    if (!context.taskLabels.has('Start Emulators')) {
        issues.push({
            code: 'missingEmulatorTask',
            path: '$.tasks',
            message: 'A plan with emulators requires a "Start Emulators" task so the dependencies come up before the debugger attaches.',
        });
    }

    const composeFile = await findFirstExisting(workspace, COMPOSE_FILES);
    if (!composeFile || !/\bazurite\b/i.test(context.planText)) {
        return;
    }
    const compose = await readIfExists(path.join(workspace, composeFile));
    // Azurite rejects API versions newer than the ones it knows about, so a current
    // Azure Storage SDK fails against it unless the check is disabled.
    if (compose !== undefined && !/skipApiVersionCheck/i.test(compose)) {
        issues.push({
            code: 'azuriteApiVersionCheckEnabled',
            path: '$.compose.services.azurite',
            message: 'Azurite must start with --skipApiVersionCheck, otherwise newer Azure Storage SDK API versions are rejected locally.',
        });
    }
}

function parseEnvKeys(content: string): Set<string> {
    return new Set(content.split('\n').flatMap(line => {
        const parsed = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        return parsed ? [parsed[1]] : [];
    }));
}

async function listFiles(directory: string): Promise<string[]> {
    const found: string[] = [];
    let entries;
    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
        return found;
    }
    for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRECTORIES.has(entry.name)) {
                found.push(...await listFiles(absolute));
            }
            continue;
        }
        found.push(absolute);
    }
    return found;
}

async function findFirstExisting(workspace: string, candidates: string[]): Promise<string | undefined> {
    for (const candidate of candidates) {
        try {
            await fs.access(path.join(workspace, candidate));
            return candidate;
        } catch {
            continue;
        }
    }
    return undefined;
}

async function readIfExists(target: string): Promise<string | undefined> {
    try {
        return await fs.readFile(target, 'utf8');
    } catch {
        return undefined;
    }
}

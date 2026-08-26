/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Conformance between `.azure/vscode-debug-plan.md` and the artifacts the generation
 * phase produced from it.
 *
 * The generation contract is "the plan specifies WHAT to generate" and "only generate
 * artifacts for rows where Generate is checked (`[x]`)". So every checked row must
 * yield exactly one artifact, and every unchecked row must yield none — a plan that
 * silently disagrees with the workspace is the failure this catches.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ParsedDebugPlan } from './localDebugPlan.ts';
import { parseDebugPlan } from './localDebugPlan.ts';
import { validateDebugEnvironment } from './debugEnvironment.ts';
import { parseJsonc, readLaunchDocument, readTasksDocument, validateDebugLaunchConfiguration } from './launchConfig.ts';
import type { ArtifactValidationIssue, ArtifactValidationResult } from './validationTypes.ts';
import { createValidationResult } from './validationTypes.ts';

const PLAN_PATH = path.join('.azure', 'vscode-debug-plan.md');
const LAUNCH_PATH = path.join('.vscode', 'launch.json');
const TASKS_PATH = path.join('.vscode', 'tasks.json');
const EXTENSIONS_PATH = path.join('.vscode', 'extensions.json');
const API_COLLECTIONS_DIR = 'api-test-collections';

/** Compose file names the orchestrator may emit, in the order the plan prefers them. */
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

export async function validateDebugArtifacts(workspace: string): Promise<ArtifactValidationResult> {
    const issues: ArtifactValidationIssue[] = [];

    const planText = await readIfExists(path.join(workspace, PLAN_PATH));
    if (planText === undefined) {
        return createValidationResult([issue('planMissing', '$', `${path.join(workspace, PLAN_PATH)} does not exist, so no artifact can be checked against it.`)]);
    }
    const plan = parseDebugPlan(planText);

    const launchText = await readIfExists(path.join(workspace, LAUNCH_PATH));
    const tasksText = await readIfExists(path.join(workspace, TASKS_PATH));
    if (launchText === undefined) {
        issues.push(issue('launchJsonMissing', '$.launch', `${LAUNCH_PATH} was never generated.`));
    }

    if (launchText !== undefined) {
        // Structural problems make the conformance comparison meaningless, so report
        // them and skip the name matching rather than emitting cascading noise.
        const structural = validateDebugLaunchConfiguration(launchText, tasksText);
        const fatal = structural.issues.filter(entry => entry.code.endsWith('Unparseable'));
        if (fatal.length > 0) {
            return createValidationResult([...issues, ...fatal]);
        }
        validateConfigConformance(plan, launchText, issues);
    }

    await validateEmulatorArtifacts(workspace, plan, issues);
    await validateExtensionRecommendations(workspace, issues);
    await validateConvenienceScripts(workspace, plan, issues);
    await validateApiTestCollections(workspace, plan, issues);

    await validateDebugEnvironment(workspace, {
        hasEmulators: plan.emulators.length > 0,
        taskLabels: readTaskLabels(tasksText),
        planText,
    }, issues);

    return createValidationResult(issues);
}

function readTaskLabels(tasksText: string | undefined): Set<string> {
    if (tasksText === undefined) {
        return new Set();
    }
    try {
        return new Set(readTasksDocument(tasksText)
            .tasks
            .flatMap(task => (typeof task.label === 'string' ? [task.label] : [])));
    } catch {
        // A malformed tasks.json is already reported by the structural validator.
        return new Set();
    }
}

/**
 * Without a recommendation for the debugger the scenario needs, the user is asked to
 * install nothing and F5 fails with an unresolved debug type.
 */
async function validateExtensionRecommendations(workspace: string, issues: ArtifactValidationIssue[]): Promise<void> {
    const raw = await readIfExists(path.join(workspace, EXTENSIONS_PATH));
    if (raw === undefined) {
        issues.push(issue('extensionRecommendationsMissing', '$.extensions', `${EXTENSIONS_PATH} was never generated.`));
        return;
    }
    let recommendations: unknown;
    try {
        recommendations = (parseJsonc(raw) as { recommendations?: unknown } | null)?.recommendations;
    } catch (error) {
        issues.push(issue('extensionsJsonUnparseable', '$.extensions', describeError(error)));
        return;
    }
    const entries = Array.isArray(recommendations) ? recommendations : [];
    // A marketplace id is always `publisher.extension`; anything else will not resolve.
    if (entries.length === 0 || entries.some(entry => typeof entry !== 'string' || !entry.includes('.'))) {
        issues.push(issue('invalidExtensionRecommendations', '$.extensions', `${EXTENSIONS_PATH} must list at least one "publisher.extension" recommendation.`));
    }
}

function validateConfigConformance(
    plan: ParsedDebugPlan,
    launchText: string,
    issues: ArtifactValidationIssue[],
): void {
    const launch = readLaunchDocument(launchText);
    const configNames = new Set(
        launch.configurations
            .map(config => (typeof config.name === 'string' ? config.name.trim().toLowerCase() : ''))
            .filter(Boolean),
    );
    const compoundNames = new Set(
        launch.compounds
            .map(compound => (typeof compound.name === 'string' ? compound.name.trim().toLowerCase() : ''))
            .filter(Boolean),
    );

    for (const row of plan.debugConfigs) {
        if (!row.name) {
            continue;
        }
        const key = row.name.toLowerCase();
        const present = row.isCompound ? compoundNames.has(key) : configNames.has(key);

        if (row.generate && !present) {
            issues.push(issue(
                row.isCompound ? 'compoundConfigMissing' : 'debugConfigMissing',
                '$.launch',
                `Plan row "${row.name}" is marked [x] but no matching ${row.isCompound ? 'compound' : 'launch configuration'} exists in launch.json.`,
            ));
        }
        if (!row.generate && present) {
            issues.push(issue(
                'uncheckedConfigGenerated',
                '$.launch',
                `Plan row "${row.name}" is marked [ ] but launch.json generated it anyway.`,
            ));
        }
    }

    // A configuration nobody planned means the workspace drifted from the plan.
    const plannedNames = new Set(plan.debugConfigs.map(row => row.name.toLowerCase()).filter(Boolean));
    if (plannedNames.size > 0) {
        for (const name of [...configNames, ...compoundNames]) {
            if (!plannedNames.has(name)) {
                issues.push(issue('unplannedConfigGenerated', '$.launch', `launch.json declares "${name}", which no plan row describes.`));
            }
        }
    }
}

async function validateEmulatorArtifacts(
    workspace: string,
    plan: ParsedDebugPlan,
    issues: ArtifactValidationIssue[],
): Promise<void> {
    const composeFile = await findFirstExisting(workspace, COMPOSE_FILES);
    const emulatorCount = plan.emulators.length;

    if (emulatorCount > 0 && !composeFile) {
        issues.push(issue('composeMissing', '$.compose', `The plan lists ${emulatorCount} emulator(s) but no compose file was generated.`));
        return;
    }
    if (emulatorCount === 0 && composeFile) {
        issues.push(issue('unexpectedCompose', '$.compose', `The plan lists no emulators but ${composeFile} was generated.`));
        return;
    }
    if (!composeFile) {
        return;
    }

    // The agent picks its own compose service names, and plan labels are prose that
    // often carry the image in a parenthetical — e.g.
    // "SQL Server 2022 Container (`mcr.microsoft.com/mssql/server:2022-latest`)".
    // Match on any recognisable token from the label rather than the whole string.
    const compose = (await fs.readFile(path.join(workspace, composeFile), 'utf8')).toLowerCase();
    for (const row of plan.emulators) {
        const label = (row[1] ?? row[0] ?? '').trim();
        const candidates = emulatorTokens(label);
        if (candidates.length > 0 && !candidates.some(candidate => compose.includes(candidate))) {
            issues.push(issue('emulatorNotInCompose', '$.compose', `Planned emulator "${label}" does not appear in ${composeFile} (looked for ${candidates.map(value => `"${value}"`).join(', ')}).`));
        }
    }
}

/**
 * Tokens that would identify an emulator inside a compose file: the image reference
 * the plan quotes, the image's own name, and the descriptive label stripped of its
 * parenthetical and the word "container".
 */
function emulatorTokens(label: string): string[] {
    const tokens = new Set<string>();
    const add = (value: string): void => {
        const cleaned = value.trim().toLowerCase();
        // Very short fragments ("db", "sql") match almost any compose file, which
        // would make the check unfalsifiable.
        if (cleaned.length >= 4) {
            tokens.add(cleaned);
        }
    };

    for (const match of label.matchAll(/`([^`]+)`/g)) {
        const image = match[1].trim();
        add(image);
        // `mcr.microsoft.com/mssql/server:2022-latest` also identifies as `mssql/server`.
        const withoutTag = image.replace(/:[^/:]*$/, '');
        add(withoutTag);
        add(withoutTag.split('/').slice(-2).join('/'));
        add(withoutTag.split('/').pop() ?? '');
    }

    const prose = label
        .replace(/\([^)]*\)/g, '')
        .replace(/`[^`]*`/g, '')
        .replace(/\bcontainer\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    add(prose);
    // "PostgreSQL 16" and "Azurite" both reduce to a product name the compose file
    // almost certainly mentions, in an image, a service key, or both.
    add(prose.split(/\s+/)[0] ?? '');

    return [...tokens];
}

async function validateConvenienceScripts(
    workspace: string,
    plan: ParsedDebugPlan,
    issues: ArtifactValidationIssue[],
): Promise<void> {
    for (const row of plan.convenienceScripts) {
        if (!row.generate || !row.script) {
            continue;
        }
        const manifestPath = row.registeredIn || './package.json';
        const absolute = path.join(workspace, manifestPath);
        const raw = await readIfExists(absolute);
        if (raw === undefined) {
            issues.push(issue('scriptManifestMissing', '$.scripts', `Convenience script "${row.script}" is registered in ${manifestPath}, which does not exist.`));
            continue;
        }
        let scripts: Record<string, unknown>;
        try {
            scripts = ((parseJsonc(raw) as { scripts?: Record<string, unknown> } | null)?.scripts) ?? {};
        } catch (error) {
            issues.push(issue('scriptManifestUnparseable', '$.scripts', `${manifestPath} could not be parsed: ${error instanceof Error ? error.message : String(error)}`));
            continue;
        }
        if (!(row.script in scripts)) {
            issues.push(issue('scriptNotRegistered', '$.scripts', `Convenience script "${row.script}" is marked [x] but is not registered in ${manifestPath}.`));
        }
    }
}

async function validateApiTestCollections(
    workspace: string,
    plan: ParsedDebugPlan,
    issues: ArtifactValidationIssue[],
): Promise<void> {
    const checked = plan.apiTestCollections.filter(row => row.generate);
    const root = path.join(workspace, API_COLLECTIONS_DIR);
    const directories = await listDirectories(root);

    if (checked.length === 0) {
        if (directories.length > 0) {
            issues.push(issue('unexpectedApiCollections', '$.apiTestCollections', `${API_COLLECTIONS_DIR}/ was generated but no plan row requests it.`));
        }
        return;
    }
    if (directories.length === 0) {
        issues.push(issue('apiCollectionsMissing', '$.apiTestCollections', `${checked.length} service(s) request API test collections but ${API_COLLECTIONS_DIR}/ is empty or absent.`));
        return;
    }
    // The plan names services by label while the directories use service ids, so
    // compare counts rather than inventing a label-to-id mapping.
    if (directories.length < checked.length) {
        issues.push(issue('apiCollectionsIncomplete', '$.apiTestCollections', `${checked.length} service(s) request API test collections but only ${directories.length} directory/directories exist under ${API_COLLECTIONS_DIR}/.`));
    }

    for (const directory of directories) {
        const invocations = await findInvokeScripts(path.join(root, directory));
        if (invocations === 0) {
            issues.push(issue('apiCollectionEmpty', '$.apiTestCollections', `${API_COLLECTIONS_DIR}/${directory} contains no invoke script.`));
        }
    }
}

async function findInvokeScripts(directory: string): Promise<number> {
    let count = 0;
    for (const child of await listDirectories(directory)) {
        const entries = await listFiles(path.join(directory, child));
        if (entries.some(name => /^invoke\.(sh|ps1)$/i.test(name))) {
            count++;
        }
    }
    return count;
}

async function readIfExists(target: string): Promise<string | undefined> {
    try {
        return await fs.readFile(target, 'utf8');
    } catch {
        return undefined;
    }
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

async function listDirectories(target: string): Promise<string[]> {
    try {
        const entries = await fs.readdir(target, { withFileTypes: true });
        return entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    } catch {
        return [];
    }
}

async function listFiles(target: string): Promise<string[]> {
    try {
        const entries = await fs.readdir(target, { withFileTypes: true });
        return entries.filter(entry => entry.isFile()).map(entry => entry.name);
    } catch {
        return [];
    }
}

function issue(code: string, path: string, message: string): ArtifactValidationIssue {
    return { code, path, message };
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

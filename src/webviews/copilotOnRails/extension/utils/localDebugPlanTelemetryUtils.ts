/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { maskUserInfo } from "@microsoft/vscode-azext-utils";
import { CopilotOnRailsContext } from "../../../../utils/copilotOnRails/CopilotOnRailsContext";
import { setCorProp } from "../../../../utils/copilotOnRails/telemetryUtils";
import { findColumnIndex, findSection, findTable, flattenContent, isChecked, type LocalPlanData, type LocalPlanSection } from "../../views/utils/parseLocalDebugPlanMarkdown";

/**
 * Currently supported debug project types according to the local debug custom agent
 */
export enum SupportedDebugProjectType {
    Functions = 'functions',
    FrontendSpa = 'frontend-spa',
}

/**
 * Currently supported debug runtimes according to the local debug custom agent
 */
export enum SupportedDebugRuntime {
    NodeTS = 'node-ts',
    NodeJS = 'node-js',
}

export interface LocalDebugPlanTelemetry {
    /** Whether the plan markdown parsed into a structured view without error. */
    planParsedOk: boolean;
    /** Reported execution mode (e.g. `Guided`, `Auto`). Normalized to a lowercase token, or `unknown`. */
    planExecutionMode: string;
    /** Number of top-level (`##`) sections in the plan. */
    planSectionCount: number;
    /** Top-level (`##`) section titles in document order, normalized to lowercase tokens and comma-separated. */
    planSectionTitles: string;

    /** Total number of prerequisite rows. */
    prereqTotalCount: number;
    /** Prerequisites marked installed (✅). */
    prereqInstalledCount: number;
    /** Prerequisites not confirmed installed (❓). */
    prereqUnknownCount: number;
    /** Prerequisites that are VS Code extensions. */
    prereqExtensionCount: number;
    /** Distinct extension ids (e.g. `ms-azuretools.vscode-azurefunctions`) detected among the prerequisite rows, comma separated. */
    prereqExtensionIds: string;

    /** Non-compound debug configs offered by the plan. */
    debugNonCompoundOfferedCount: number;
    /** Non-compound debug configs the user selected to generate (checked). */
    debugNonCompoundSelectedCount: number;
    /** Compound ("Debug All"/"Full Stack") configs offered by the plan. */
    debugCompoundOfferedCount: number;
    /** Compound configs the user selected to generate (checked). */
    debugCompoundSelectedCount: number;
    /** All debug config rows offered (non-compound + compound). */
    debugTotalOfferedCount: number;
    /** All debug config rows the user selected to generate. */
    debugTotalSelectedCount: number;
    /**
     * Project type per non-compound service, in document order. Each entry is a canonical
     * {@link SupportedDebugProjectType} or an unlisted limited support type.
     */
    debugProjectTypes: string;
    /**
     * Runtime per non-compound service, positionally aligned with {@link debugProjectTypes}. Each entry
     * is a canonical {@link SupportedDebugRuntime} or an unlisted limited support type.
     */
    debugRuntimes: string;

    /**
     * Azure dependencies per non-compound service, positionally aligned with {@link debugProjectTypes} as per-service comma separated values.
     * Multiple dependencies for one service are joined with `|`; a service with none is `none`.
     */
    debugAzureDependencies: string;
    /** Whether a dev-server → API proxy was detected. */
    proxyDetected: boolean;

    /** Orchestrator name, normalized (e.g. `docker compose`), or `none`. */
    orchestrator: string;

    /** Number of emulator rows. */
    emulatorCount: number;
    /** Distinct emulator types (e.g. `azurite container,postgresql container`). */
    emulatorTypes: string;

    /** Whether an architecture (mermaid) diagram is present. */
    hasArchitectureDiagram: boolean;

    /** Whether the plan involves a database (and therefore may need migrations). */
    hasDatabase: boolean;
    /** Whether a Migrations section was generated in the plan. */
    hasMigrationSection: boolean;
    /** Migration rows offered by the plan. */
    migrationOfferedCount: number;
    /** Migration rows the user selected to generate (checked). */
    migrationSelectedCount: number;

    /** Services offered an API test collection. */
    apiTestServiceOfferedCount: number;
    /** Services the user selected to generate an API test collection for (checked). */
    apiTestServiceSelectedCount: number;
    /** Total HTTP endpoints covered by generated API test collections. */
    apiTestHttpEndpointCount: number;
    /** Total triggers covered by generated API test collections. */
    apiTestTriggerCount: number;
    /** Total API test cases (HTTP endpoints + triggers). */
    apiTestTotalCount: number;

    /** Convenience scripts offered by the plan. */
    convenienceScriptOfferedCount: number;
    /** Convenience scripts the user selected to generate (checked). */
    convenienceScriptSelectedCount: number;
}

export const LOCAL_DEBUG_PLAN_TELEMETRY_PREFIX = 'localDebugPlan.';

/**
 * Upper bound on the number of section titles emitted in {@link LocalDebugPlanTelemetry.planSectionTitles}.
 * Titles are model-generated free text, so we cap the emitted list to keep telemetry cardinality and
 * property length bounded; any titles beyond this limit are dropped.
 */
const MAX_SECTION_TITLES = 15;

/**
 * Parses a structured {@link LocalPlanData} into a flat, telemetry-safe {@link LocalDebugPlanTelemetry}
 * summary. This is the single, centralized place that derives telemetry from a debug plan.
 */
export function getLocalDebugPlanTelemetry(planData: LocalPlanData): LocalDebugPlanTelemetry {
    const prereq = getPrerequisiteMetrics(planData);
    const debug = getDebugConfigMetrics(planData);
    const emulators = getEmulatorMetrics(planData);
    const apiTest = getApiTestMetrics(planData);
    const migration = getMigrationMetrics(planData);
    const scripts = getOfferedSelected(planData, 'Convenience Scripts', 'Script');

    return {
        planParsedOk: !planData.parseError,
        planExecutionMode: normalizeToken(planData.executionMode) || 'unknown',
        planSectionCount: planData.sections.length,
        planSectionTitles: getPlanSectionTitles(planData),

        prereqTotalCount: prereq.total,
        prereqInstalledCount: prereq.installed,
        prereqUnknownCount: prereq.unknown,
        prereqExtensionCount: prereq.extensions,
        prereqExtensionIds: prereq.extensionIds,

        debugNonCompoundOfferedCount: debug.nonCompoundOffered,
        debugNonCompoundSelectedCount: debug.nonCompoundSelected,
        debugCompoundOfferedCount: debug.compoundOffered,
        debugCompoundSelectedCount: debug.compoundSelected,
        debugTotalOfferedCount: debug.nonCompoundOffered + debug.compoundOffered,
        debugTotalSelectedCount: debug.nonCompoundSelected + debug.compoundSelected,
        debugProjectTypes: debug.projectTypes,
        debugRuntimes: debug.runtimes,
        debugAzureDependencies: debug.azureDependencies,
        proxyDetected: debug.proxyDetected,

        orchestrator: getOrchestrator(planData),

        emulatorCount: emulators.count,
        emulatorTypes: emulators.types,

        hasArchitectureDiagram: hasArchitectureDiagram(planData),

        hasDatabase: hasDatabaseDependency(debug.azureDependencies, emulators.types),
        hasMigrationSection: migration.hasSection,
        migrationOfferedCount: migration.offered,
        migrationSelectedCount: migration.selected,

        apiTestServiceOfferedCount: apiTest.serviceOffered,
        apiTestServiceSelectedCount: apiTest.serviceSelected,
        apiTestHttpEndpointCount: apiTest.httpEndpointCount,
        apiTestTriggerCount: apiTest.triggerCount,
        apiTestTotalCount: apiTest.httpEndpointCount + apiTest.triggerCount,

        convenienceScriptOfferedCount: scripts.offered,
        convenienceScriptSelectedCount: scripts.selected,
    };
}

export function recordLocalDebugPlanTelemetry(context: CopilotOnRailsContext, planData: LocalPlanData): void {
    try {
        const telemetry = getLocalDebugPlanTelemetry(planData);
        for (const [key, value] of Object.entries(telemetry)) {
            setCorProp(context, `${LOCAL_DEBUG_PLAN_TELEMETRY_PREFIX}${key}`, value);
        }
    } catch {
        // Telemetry extraction must never block the approval flow; swallow any parsing errors.
        setCorProp(context, `${LOCAL_DEBUG_PLAN_TELEMETRY_PREFIX}parseFailed`, true);
    }
}

//#region Section metrics

/**
 * Masks and normalizes each top-level (`##`) section title, dropping empties and capping the list at
 * {@link MAX_SECTION_TITLES} to keep the emitted telemetry property bounded.
 */
function getPlanSectionTitles(planData: LocalPlanData): string {
    return planData.sections
        .map((section) => normalizeToken(maskUserInfo(section.title, [])))
        .filter((title) => title !== '')
        .slice(0, MAX_SECTION_TITLES)
        .join(',');
}

function getPrerequisiteMetrics(planData: LocalPlanData): {
    total: number;
    installed: number;
    unknown: number;
    extensions: number;
    extensionIds: string;
} {
    const section = findSection(planData, 'Prerequisites');
    const table = section && findTable(section, ['Installed']);

    let installed = 0;
    let unknown = 0;
    let extensions = 0;
    // Preserve first-seen order while de-duplicating repeated extension ids.
    const extensionIds = new Set<string>();

    if (table) {
        const installedIdx = findColumnIndex(table.headers, 'Installed');
        const categoryIdx = findColumnIndex(table.headers, 'Category');
        const toolIdx = findColumnIndex(table.headers, 'Tool');

        for (const row of table.rows) {
            // Anything not explicitly confirmed installed (✅) is treated as unknown — we
            // intentionally do not distinguish "missing" from "unconfirmed".
            if (cell(row, installedIdx).includes('✅')) {
                installed++;
            } else {
                unknown++;
            }

            // A row is an extension if its category says so or its Tool cell is a recognizable
            // extension id — the same signal that feeds the id list, so the two never diverge.
            const category = cell(row, categoryIdx).toLowerCase();
            const extensionId = extractExtensionId(cell(row, toolIdx));
            if (category.includes('extension') || extensionId) {
                extensions++;
                if (extensionId) {
                    extensionIds.add(extensionId);
                }
            }
        }
    }

    return {
        total: table?.rows.length ?? 0,
        installed,
        unknown,
        extensions,
        extensionIds: [...extensionIds].join(','),
    };
}

/**
 * Extracts a VS Code extension id (`publisher.name`) from a Tool/Extension cell. Extension ids are
 * authored wrapped in backticks (e.g. `` `ms-azuretools.vscode-azurefunctions` ``); returns the
 * lowercased id only when the backticked value is a recognizable `publisher.name`, otherwise
 * `undefined`. The backtick requirement avoids false positives from dotted tool names like `Node.js`.
 */
function extractExtensionId(tool: string): string | undefined {
    const backticked = tool.match(/`([^`]+)`/);
    if (!backticked) {
        return undefined;
    }
    const candidate = backticked[1].trim();
    return /^[\w-]+\.[\w-]+$/.test(candidate) ? candidate.toLowerCase() : undefined;
}

function getDebugConfigMetrics(planData: LocalPlanData): {
    nonCompoundOffered: number;
    nonCompoundSelected: number;
    compoundOffered: number;
    compoundSelected: number;
    projectTypes: string;
    runtimes: string;
    azureDependencies: string;
    proxyDetected: boolean;
} {
    const section = findSection(planData, 'Debug Configurations');
    const table = section && findTable(section, ['Debug Config Name']);

    let nonCompoundOffered = 0;
    let nonCompoundSelected = 0;
    let compoundOffered = 0;
    let compoundSelected = 0;
    // Parallel, positionally-aligned lists: index i across all three describes the same
    // (non-compound) service row, in document order, so consumers can reconstruct the full
    // attribute set that belongs to each service. Emitted as per-service comma-separated strings.
    const projectTypes: string[] = [];
    const runtimes: string[] = [];
    const azureDependencies: string[] = [];

    if (table) {
        const generateIdx = findColumnIndex(table.headers, 'Generate');
        const projectTypeIdx = findColumnIndex(table.headers, 'Project Type');
        const runtimeIdx = findColumnIndex(table.headers, 'Runtime');
        const azureDepIdx = findColumnIndex(table.headers, 'Azure Dependencies');

        for (const row of table.rows) {
            const projectType = cell(row, projectTypeIdx);
            const isCompound = /compound\s+config/i.test(projectType);
            const checked = isChecked(cell(row, generateIdx));

            if (isCompound) {
                compoundOffered++;
                if (checked) { compoundSelected++; }
                continue;
            }

            nonCompoundOffered++;
            if (checked) { nonCompoundSelected++; }

            projectTypes.push(normalizeToken(projectType));
            runtimes.push(normalizeToken(cell(row, runtimeIdx)));
            const deps = splitList(cell(row, azureDepIdx)).map(normalizeToken).filter((dep) => dep !== '');
            azureDependencies.push(deps.length > 0 ? deps.join('|') : 'none');
        }
    }

    return {
        nonCompoundOffered,
        nonCompoundSelected,
        compoundOffered,
        compoundSelected,
        projectTypes: projectTypes.join(','),
        runtimes: runtimes.join(','),
        azureDependencies: azureDependencies.join(','),
        proxyDetected: section ? sectionHasText(section, 'proxy detected') : false,
    };
}

function getOrchestrator(planData: LocalPlanData): string {
    const section = findSection(planData, 'Orchestrator');
    const table = section && findTable(section, ['Orchestrator']);
    if (!table || table.rows.length === 0) {
        return 'none';
    }
    const idx = findColumnIndex(table.headers, 'Orchestrator');
    return normalizeToken(cell(table.rows[0], idx)) || 'none';
}

function getEmulatorMetrics(planData: LocalPlanData): { count: number; types: string } {
    const section = findSection(planData, 'Emulators');
    const table = section && findTable(section, ['Emulator']);
    if (!table) {
        return { count: 0, types: '' };
    }
    const idx = findColumnIndex(table.headers, 'Emulator');
    const types = new Set<string>();
    for (const row of table.rows) {
        addToken(types, cell(row, idx));
    }
    return { count: table.rows.length, types: joinSet(types) };
}

function hasArchitectureDiagram(planData: LocalPlanData): boolean {
    const section = findSection(planData, 'Architecture');
    if (!section) {
        return false;
    }
    return flattenContent(section.content).some((content) => content.type === 'codeBlock' && /mermaid/i.test(content.language));
}

function getApiTestMetrics(planData: LocalPlanData): {
    serviceOffered: number;
    serviceSelected: number;
    httpEndpointCount: number;
    triggerCount: number;
} {
    const section = findSection(planData, 'API Test Collections');
    const table = section && findTable(section, ['Service']);
    if (!table) {
        return { serviceOffered: 0, serviceSelected: 0, httpEndpointCount: 0, triggerCount: 0 };
    }

    const descriptionIdx = findColumnIndex(table.headers, 'Description');
    const generateIdx = findColumnIndex(table.headers, 'Generate');
    let httpEndpointCount = 0;
    let triggerCount = 0;
    for (const row of table.rows) {
        const description = cell(row, descriptionIdx);
        httpEndpointCount += sumCounts(description, /Endpoints?\s*\((\d+)\)/gi);
        triggerCount += sumCounts(description, /Triggers?\s*\((\d+)\)/gi);
    }

    return {
        serviceOffered: table.rows.length,
        serviceSelected: generateIdx < 0 ? table.rows.length : table.rows.filter((row) => isChecked(cell(row, generateIdx))).length,
        httpEndpointCount,
        triggerCount,
    };
}

/**
 * Returns how many rows a generatable section offers and how many the user selected (checked `[x]`).
 * When the section has no `Generate` column, every offered row is treated as selected.
 */
function getOfferedSelected(planData: LocalPlanData, sectionTitle: string, anchorHeader: string): { offered: number; selected: number } {
    const section = findSection(planData, sectionTitle);
    const table = section && findTable(section, [anchorHeader]);
    if (!table) {
        return { offered: 0, selected: 0 };
    }
    const generateIdx = findColumnIndex(table.headers, 'Generate');
    const offered = table.rows.length;
    const selected = generateIdx < 0 ? offered : table.rows.filter((row) => isChecked(cell(row, generateIdx))).length;
    return { offered, selected };
}

/** Migration metrics: whether a Migrations section exists plus its offered/selected row counts. */
function getMigrationMetrics(planData: LocalPlanData): { hasSection: boolean; offered: number; selected: number } {
    const hasSection = findSection(planData, 'Migrations') !== undefined;
    const { offered, selected } = getOfferedSelected(planData, 'Migrations', 'Migration Tool');
    return { hasSection, offered, selected };
}

/**
 * Detects whether the plan involves a database (and therefore may need migrations) by scanning the
 * debug configs' Azure dependencies and the emulator types for a database-like token.
 */
function hasDatabaseDependency(debugAzureDependencies: string, emulatorTypes: string): boolean {
    const haystack = `${debugAzureDependencies} ${emulatorTypes}`.toLowerCase();
    return /postgres|mysql|mariadb|sqlite|mssql|sql server|\bsql\b|mongo|cosmos|oracle|dynamo|database/.test(haystack);
}

//#endregion

//#region Parsing helpers

function sectionHasText(section: LocalPlanSection, needle: string): boolean {
    const lowerNeedle = needle.toLowerCase();
    return flattenContent(section.content).some((content) => {
        if (content.type === 'blockquote' || content.type === 'paragraph') {
            return content.text.toLowerCase().includes(lowerNeedle);
        }
        return false;
    });
}

function cell(row: string[], index: number): string {
    return index >= 0 && index < row.length ? row[index] : '';
}

/** Splits a comma-separated cell, dropping empty and placeholder (`—`, `-`, `n/a`) entries. */
function splitList(value: string): string[] {
    return value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '' && part !== '—' && part !== '-' && part.toLowerCase() !== 'n/a');
}

function addToken(set: Set<string>, value: string): void {
    const token = normalizeToken(value);
    if (token) {
        set.add(token);
    }
}

function joinSet(set: Set<string>): string {
    return [...set].sort().join(',');
}

/** Lowercases and collapses a value to a stable, low-cardinality token; drops placeholder dashes. */
function normalizeToken(value: string): string {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === '' || trimmed === '—' || trimmed === '-' || trimmed === 'n/a') {
        return '';
    }
    return trimmed.replace(/\s+/g, ' ');
}

function sumCounts(text: string, pattern: RegExp): number {
    let total = 0;
    for (const match of text.matchAll(pattern)) {
        total += Number(match[1]);
    }
    return total;
}

//#endregion

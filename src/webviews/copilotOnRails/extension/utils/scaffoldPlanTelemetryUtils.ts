/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { maskUserInfo } from "@microsoft/vscode-azext-utils";
import { findColumnIndex, findKeyValue, findSection, findTable, type ScaffoldPlanData, type ScaffoldPlanSection } from "../../views/utils/parseScaffoldPlanMarkdown";

export const SCAFFOLD_PLAN_TELEMETRY_PREFIX = 'projectScaffoldPlan.';

export interface ScaffoldPlanTelemetry {
    /** Whether the plan markdown parsed into a structured view without error. */
    planParsedOk: boolean;
    /** Reported execution mode (e.g. `auto`, `guided`). Normalized to a lowercase token, or `unknown`. */
    planExecutionMode: string;
    /** Reported project mode (e.g. `new`, `existing`). Normalized to a lowercase token, or `unknown`. */
    planMode: string;
    /** Number of top-level (`##`) sections in the plan. */
    planSectionCount: number;
    /** Top-level section titles in document order, normalized, masked, and comma-separated. */
    planSectionTitles: string;
    /** Reported app type (e.g. `spa + api`) from Project Overview. Normalized to a lowercase token, or `unknown`. */
    appType: string;

    /** Total run-prerequisite rows. */
    runPrereqTotalCount: number;
    /** Run prerequisites marked installed (✅). */
    runPrereqInstalledCount: number;
    /** Run prerequisites not confirmed installed (❓). */
    runPrereqUnknownCount: number;
    /** Total debug-prerequisite rows. */
    debugPrereqTotalCount: number;
    /** Debug prerequisites marked installed (✅). */
    debugPrereqInstalledCount: number;
    /** Debug prerequisites not confirmed installed (❓). */
    debugPrereqUnknownCount: number;
    /** Debug prerequisites that are VS Code extensions. */
    debugPrereqExtensionCount: number;
    /** Distinct debug-prerequisite VS Code extension IDs (e.g. `ms-azuretools.vscode-azurefunctions`), comma-separated and sorted. */
    debugPrereqExtensionIds: string;

    /** Number of application service sections (each with a Component/Technology table). */
    serviceCount: number;
    /** Distinct service languages (e.g. `typescript`), comma-separated and sorted. */
    serviceLanguages: string;
    /** Distinct service runtimes (e.g. `node`), comma-separated and sorted. */
    serviceRuntimes: string;
    /** Distinct service frameworks (e.g. `react + vite`), comma-separated and sorted. */
    serviceFrameworks: string;
    /** Distinct service package managers (e.g. `npm`), comma-separated and sorted. */
    servicePackageManagers: string;
    /** Distinct service test runners (e.g. `vitest`), comma-separated and sorted. */
    serviceTestRunners: string;

    /** Number of distinct required Azure services. */
    azureServiceCount: number;
    /** Distinct required Azure service types, comma-separated */
    azureServiceTypes: string;
    /** Whether the plan involves a database (and therefore may need migrations). */
    hasDatabase: boolean;

    /** Reported component library (e.g. `fluent ui v9`). Normalized token, or `none`. */
    componentLibrary: string;
    /** Number of pages defined in the design system. */
    pageCount: number;

    /** Total number of route definitions. */
    routeCount: number;
    /** Distinct HTTP methods across route definitions (e.g. `get,post`), comma-separated and sorted. */
    routeMethods: string;
    /** Routes that declare an authorization requirement (auth other than `none`). */
    authenticatedRouteCount: number;
}

/**
 * Parses a structured {@link ScaffoldPlanData} into a flat, telemetry-safe {@link ScaffoldPlanTelemetry}
 * summary. This is the single, centralized place that derives diagnostics/telemetry from a scaffold plan.
 */
export function getScaffoldPlanTelemetry(planData: ScaffoldPlanData): ScaffoldPlanTelemetry {
    const services = getServiceMetrics(planData);
    const azure = getAzureServiceMetrics(planData);
    const prereqs = getPrerequisiteMetrics(planData);
    const design = getDesignSystemMetrics(planData);
    const routes = getRouteMetrics(planData);

    return {
        planParsedOk: !planData.parseError,
        planExecutionMode: normalizeToken(planData.executionMode) || 'unknown',
        planMode: normalizeToken(planData.mode) || 'unknown',
        planSectionCount: planData.sections.length,
        planSectionTitles: getSectionTitles(planData),
        appType: getAppType(planData),

        serviceCount: services.count,
        serviceLanguages: services.languages,
        serviceRuntimes: services.runtimes,
        serviceFrameworks: services.frameworks,
        servicePackageManagers: services.packageManagers,
        serviceTestRunners: services.testRunners,

        azureServiceCount: azure.count,
        azureServiceTypes: azure.types,
        hasDatabase: hasDatabaseDependency(azure.types),

        runPrereqTotalCount: prereqs.run.total,
        runPrereqInstalledCount: prereqs.run.installed,
        runPrereqUnknownCount: prereqs.run.unknown,
        debugPrereqTotalCount: prereqs.debug.total,
        debugPrereqInstalledCount: prereqs.debug.installed,
        debugPrereqUnknownCount: prereqs.debug.unknown,
        debugPrereqExtensionCount: prereqs.debug.extensions,
        debugPrereqExtensionIds: prereqs.debug.extensionIds,

        componentLibrary: design.componentLibrary,
        pageCount: design.pageCount,

        routeCount: routes.count,
        routeMethods: routes.methods,
        authenticatedRouteCount: routes.authenticated,
    };
}

//#region Section metrics

/** Reads the `App Type` key from the Project Overview section, normalized to a lowercase token, or `unknown`. */
function getAppType(planData: ScaffoldPlanData): string {
    const section = findSection(planData, 'Project Overview');
    const value = section && findKeyValue(section, 'App Type');
    return (value && normalizeToken(value)) || 'unknown';
}

/**
 * Returns the top-level section titles in document order as a normalized, comma-separated string.
 */
function getSectionTitles(planData: ScaffoldPlanData): string {
    return planData.sections
        .map((section) => normalizeToken(maskUserInfo(section.title, [])))
        .join(',');
}

function getServiceMetrics(planData: ScaffoldPlanData): {
    count: number;
    languages: string;
    runtimes: string;
    frameworks: string;
    packageManagers: string;
    testRunners: string;
} {
    // Distinct values across all service sections (deduped and sorted). Service count is tracked
    // separately, so these sets intentionally don't preserve per-service alignment.
    const languages = new Set<string>();
    const runtimes = new Set<string>();
    const frameworks = new Set<string>();
    const packageManagers = new Set<string>();
    const testRunners = new Set<string>();
    let count = 0;

    for (const section of planData.sections) {
        const table = findTable(section, ['Component', 'Technology']);
        if (!table) {
            continue;
        }
        count++;

        const components = readComponentTable(table);
        addToken(languages, components.get('language'));
        addToken(runtimes, components.get('runtime'));
        addToken(frameworks, components.get('framework'));
        addToken(packageManagers, components.get('package manager'));
        addToken(testRunners, components.get('test runner'));
    }

    return {
        count,
        languages: joinSet(languages),
        runtimes: joinSet(runtimes),
        frameworks: joinSet(frameworks),
        packageManagers: joinSet(packageManagers),
        testRunners: joinSet(testRunners),
    };
}

function getAzureServiceMetrics(planData: ScaffoldPlanData): { count: number; types: string } {
    const section = findSection(planData, 'Services Required');
    const table = section && findTable(section, ['Azure Service']);
    if (!table) {
        return { count: 0, types: '' };
    }

    const serviceIdx = findColumnIndex(table.headers, 'Azure Service');
    // The plan lists Azure services in a single flat table with no mapping back to the individual
    // project services that consume them, so we can only report the distinct set (sorted), not a
    // per-service breakdown like the local-debug plan's `azureDependencies`.
    const types = new Set<string>();
    for (const row of table.rows) {
        addToken(types, cell(row, serviceIdx));
    }

    return { count: types.size, types: joinSet(types) };
}

interface PrereqMetrics {
    total: number;
    installed: number;
    unknown: number;
    extensions: number;
    extensionIds: string;
}

function getPrerequisiteMetrics(planData: ScaffoldPlanData): { run: PrereqMetrics; debug: PrereqMetrics } {
    const section = findSection(planData, 'Prerequisites');
    const tables = section ? getPrereqTablesBySubheading(section) : {};
    return {
        run: countPrereqTable(tables.run),
        debug: countPrereqTable(tables.debug),
    };
}

/**
 * Splits a Prerequisites section into its `Run` and `Debug` tables by tracking the most recent
 * `### Run` / `### Debug` subheading before each table.
 */
function getPrereqTablesBySubheading(section: ScaffoldPlanSection): { run?: ScaffoldPlanSection['content'][number]; debug?: ScaffoldPlanSection['content'][number] } {
    const result: { run?: ScaffoldPlanSection['content'][number]; debug?: ScaffoldPlanSection['content'][number] } = {};
    let current: 'run' | 'debug' | undefined;
    for (const content of section.content) {
        if (content.type === 'subheading') {
            const text = content.text.toLowerCase();
            if (text.includes('run')) {
                current = 'run';
            } else if (text.includes('debug')) {
                current = 'debug';
            } else {
                current = undefined;
            }
            continue;
        }
        if (content.type === 'table' && current && !result[current]) {
            result[current] = content;
        }
    }
    return result;
}

function countPrereqTable(content: ScaffoldPlanSection['content'][number] | undefined): PrereqMetrics {
    if (!content || content.type !== 'table') {
        return { total: 0, installed: 0, unknown: 0, extensions: 0, extensionIds: '' };
    }

    const installedIdx = findColumnIndex(content.headers, 'Installed');
    const categoryIdx = findColumnIndex(content.headers, 'Category');
    const toolIdx = findColumnIndex(content.headers, 'Tool');

    let installed = 0;
    let unknown = 0;
    let extensions = 0;
    const extensionIds = new Set<string>();
    for (const row of content.rows) {
        // Anything not explicitly confirmed installed (✅) is treated as unknown — we
        // intentionally do not distinguish "missing" from "unconfirmed".
        if (cell(row, installedIdx).includes('✅')) {
            installed++;
        } else {
            unknown++;
        }

        const category = cell(row, categoryIdx).toLowerCase();
        const toolRaw = cell(row, toolIdx);
        const tool = toolRaw.toLowerCase();
        if (category.includes('extension') || (tool.includes('.') && tool.includes('`'))) {
            extensions++;
            // Extension rows carry a backtick-wrapped VS Code extension ID (e.g. `ms-azuretools.vscode-azurefunctions`).
            addToken(extensionIds, toolRaw.replace(/`/g, ''));
        }
    }

    return { total: content.rows.length, installed, unknown, extensions, extensionIds: joinSet(extensionIds) };
}

function getDesignSystemMetrics(planData: ScaffoldPlanData): { componentLibrary: string; pageCount: number } {
    const section = findSection(planData, 'Design System');
    if (!section) {
        return { componentLibrary: 'none', pageCount: 0 };
    }

    const componentLibrary = normalizeToken(findKeyValue(section, 'Component Library') ?? '') || 'none';
    let pageCount = 0;
    for (const content of section.content) {
        if (content.type === 'pages') {
            pageCount += content.entries.length;
        }
    }

    return { componentLibrary, pageCount };
}

function getRouteMetrics(planData: ScaffoldPlanData): { count: number; methods: string; authenticated: number } {
    const section = findSection(planData, 'Route Definitions');
    const table = section && findTable(section, ['Method', 'Path']);
    if (!table) {
        return { count: 0, methods: '', authenticated: 0 };
    }

    const methodIdx = findColumnIndex(table.headers, 'Method');
    const authIdx = findColumnIndex(table.headers, 'Auth');
    const methods = new Set<string>();
    let authenticated = 0;
    for (const row of table.rows) {
        addToken(methods, cell(row, methodIdx));
        const auth = normalizeToken(cell(row, authIdx));
        if (auth && auth !== 'none') {
            authenticated++;
        }
    }

    return { count: table.rows.length, methods: joinSet(methods), authenticated };
}

/**
 * Detects whether the plan involves a database (and therefore may need migrations) by scanning the
 * required Azure service types for a database-like token.
 */
function hasDatabaseDependency(azureServiceTypes: string): boolean {
    return /postgres|mysql|mariadb|sqlite|mssql|sql server|\bsql\b|mongo|cosmos|oracle|dynamo|database/.test(azureServiceTypes.toLowerCase());
}

//#endregion

//#region Parsing helpers

/** Reads a vertical Component/Technology table into a `component → technology` map with lowercased keys. */
function readComponentTable(table: { headers: string[]; rows: string[][] }): Map<string, string> {
    const map = new Map<string, string>();
    for (const row of table.rows) {
        const key = cell(row, 0).toLowerCase().trim();
        if (key) {
            map.set(key, cell(row, 1));
        }
    }
    return map;
}

function cell(row: string[], index: number): string {
    return index >= 0 && index < row.length ? row[index] : '';
}

function addToken(set: Set<string>, value: string | undefined): void {
    const token = normalizeToken(value ?? '');
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

//#endregion

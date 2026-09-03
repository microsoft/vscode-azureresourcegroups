/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Contract for `.azure/vscode-debug-plan.md` — the artifact the local development
 * phase produces and the generation phase then treats as its single source of truth.
 *
 * Parsing goes through the shipped `parseLocalDebugPlanMarkdown`, so a plan this
 * validator accepts is by construction a plan the product webview can render. The
 * rules encoded here come from `resources/agents/azure-debug-plan/references/plan-template.md`
 * and the generation contract in `resources/agents/azure-debug-generate/`.
 */

import type { LocalPlanContent, LocalPlanData, LocalPlanSection, LocalPlanTableContent } from '../../../src/webviews/copilotOnRails/views/utils/parseLocalDebugPlanMarkdown.ts';
import {
    LocalDebugPlanStatus,
    findColumnIndex,
    findSection,
    firstTable,
    flattenContent,
    isChecked,
    parseLocalDebugPlanMarkdown,
} from '../../../src/webviews/copilotOnRails/views/utils/parseLocalDebugPlanMarkdown.ts';
import type { ArtifactValidationIssue, ArtifactValidationResult } from './validationTypes.ts';
import { createValidationResult } from './validationTypes.ts';

/** Marks the compound row in the Debug Configurations table. */
export const COMPOUND_PROJECT_TYPE = '*Compound Config*';

/**
 * The container **engine** the debug plan selects for running emulator containers. This is the
 * engine that actually runs the containers — Podman's Docker-compatibility mode is still the
 * `podman` engine (it just accepts `docker compose` commands via a Docker-compatible socket),
 * so it is `'podman'` here with the separate `dockerCompatible` flag set.
 */
export type ContainerRuntime = 'docker' | 'podman';

const requiredSections = [
    'prerequisites',
    'debug configurations',
    'orchestrator',
    'emulators',
    'architecture diagram',
] as const;

const executionModes = ['auto', 'guided'] as const;

export interface LocalDebugPlanExpectations {
    /** Status the plan must record, e.g. `Planning` at the approval gate. */
    expectedStatus?: string;
    /** Number of generated, non-compound services the scan should have found. */
    expectedServiceCount?: number;
    /** Substrings that must each match an Emulators row (e.g. `Azurite`, `PostgreSQL`). */
    expectedEmulators?: string[];
    /** The scenario has no Azure dependencies, so no emulator may be planned. */
    expectNoEmulators?: boolean;
    /** Require the Debug Configuration Checklist to be present and free of stubs. */
    requireChecklist?: boolean;
    /** Container runtime the Orchestrator table must record (e.g. `podman` when the scenario asked for Podman). */
    expectedRuntime?: ContainerRuntime;
    /** When set, the plan must (true) or must not (false) record Podman Docker-compatibility mode. */
    expectedDockerCompatible?: boolean;
}

export interface DebugConfigRow {
    generate: boolean;
    name: string;
    serviceRoot: string;
    projectType: string;
    runtime: string;
    isCompound: boolean;
}

export interface ParsedDebugPlan {
    data: LocalPlanData;
    debugConfigs: DebugConfigRow[];
    emulators: string[][];
    migrations: PlanChecklistRow[];
    apiTestCollections: PlanChecklistRow[];
    convenienceScripts: ConvenienceScriptRow[];
    /** Container **engine** recorded in the Orchestrator table, or undefined for an old plan that omits it. */
    containerRuntime?: ContainerRuntime;
    /**
     * True when the plan runs the Podman engine through its **Docker-compatibility** socket, so the
     * engine is `podman` but the Compose command is `docker compose`. When set, the generated tasks
     * legitimately use `docker compose` even though the engine is Podman.
     */
    dockerCompatible?: boolean;
    /** Normalized Compose command (`docker compose` / `podman compose`) the generation phase should emit. */
    composeCommand?: string;
}

export interface PlanChecklistRow {
    generate: boolean;
    service: string;
}

export interface ConvenienceScriptRow {
    generate: boolean;
    script: string;
    registeredIn: string;
}

export function validateLocalDebugPlanArtifact(
    content: string,
    expectations: LocalDebugPlanExpectations = {},
): ArtifactValidationResult {
    const issues: ArtifactValidationIssue[] = [];
    const data = parseLocalDebugPlanMarkdown(content);
    if (data.parseError) {
        issues.push(issue('productionParserFailure', '$', data.parseError.message));
    }

    validateHeader(data, expectations, issues);
    validateTableIntegrity(data, issues);
    validatePlaceholders(data, issues);

    for (const sectionName of requiredSections) {
        if (!findSection(data, sectionName)) {
            issues.push(issue('missingSection', '$', `Missing required "${sectionName}" section.`));
        }
    }

    validatePrerequisites(data, issues);
    const debugConfigs = validateDebugConfigurations(data, expectations, issues);
    validateEmulators(data, expectations, issues);
    validateOrchestrator(data, expectations, issues);
    validateArchitectureDiagram(data, issues);
    validateChecklist(data, debugConfigs, expectations, issues);

    return createValidationResult(issues);
}

/**
 * Pull the plan's structured tables out once so both this validator and the
 * artifact-conformance validator read the plan the same way.
 */
export function parseDebugPlan(content: string): ParsedDebugPlan {
    const data = parseLocalDebugPlanMarkdown(content);
    const orchestrator = readOrchestratorInfo(data);
    return {
        data,
        debugConfigs: readDebugConfigRows(data),
        emulators: findTable(data, 'emulators')?.rows ?? [],
        migrations: readChecklistRows(data, 'migrations'),
        apiTestCollections: readChecklistRows(data, 'api test collections'),
        convenienceScripts: readConvenienceScriptRows(data),
        containerRuntime: orchestrator.engine,
        dockerCompatible: orchestrator.dockerCompatible,
        composeCommand: orchestrator.composeCommand,
    };
}

function validateHeader(
    data: LocalPlanData,
    expectations: LocalDebugPlanExpectations,
    issues: ArtifactValidationIssue[],
): void {
    // plan-template.md mandates `# Azure Debug Plan`. Nothing in the product reads the
    // title, so this is a drift signal rather than a functional break — but the plan is
    // the generation phase's only input, and a renamed document means the agent has
    // stopped following the template it is supposed to fill in.
    if (data.title.trim() !== 'Azure Debug Plan') {
        issues.push(issue('invalidTitle', '$.title', `Plan title must be "Azure Debug Plan", found "${data.title.trim()}".`));
    }

    const status = data.status.trim();
    if (!status || status === 'Unknown') {
        issues.push(issue('missingStatus', '$.Status', 'Plan header must record a **Status**.'));
    } else if (!Object.values(LocalDebugPlanStatus).includes(status.toLowerCase() as LocalDebugPlanStatus)) {
        issues.push(issue('unknownStatus', '$.Status', `Status "${status}" is not one of ${Object.values(LocalDebugPlanStatus).join(', ')}.`));
    }

    if (expectations.expectedStatus && status.toLowerCase() !== expectations.expectedStatus.toLowerCase()) {
        issues.push(issue('unexpectedStatus', '$.Status', `Expected status "${expectations.expectedStatus}", found "${status || 'missing'}".`));
    }

    const mode = data.executionMode.trim();
    if (!mode || mode === 'Unknown') {
        issues.push(issue('missingExecutionMode', '$.ExecutionMode', 'Plan header must record an **Execution Mode**.'));
    } else if (!executionModes.includes(mode.toLowerCase() as typeof executionModes[number])) {
        issues.push(issue('unknownExecutionMode', '$.ExecutionMode', `Execution Mode "${mode}" is not one of Auto, Guided.`));
    }
}

/**
 * `plan-template.md` calls out concatenated table rows as the failure that "breaks
 * parsing completely" — a row merged onto the separator line loses its cells, so the
 * generation phase silently reads the wrong plan. A row whose cell count disagrees
 * with the header, or that still carries separator dashes, is that failure.
 */
function validateTableIntegrity(data: LocalPlanData, issues: ArtifactValidationIssue[]): void {
    for (const { section, content } of walkContent(data)) {
        if (content.type !== 'table') {
            continue;
        }
        for (const [index, row] of content.rows.entries()) {
            if (row.some(cell => /^:?-{3,}:?$/.test(cell.trim()))) {
                issues.push(issue(
                    'tableRowConcatenated',
                    `$.${section}`,
                    `Row ${index + 1} still contains separator dashes — a table row was merged onto the "|---|" line.`,
                ));
                continue;
            }
            // Trailing empty cells are cosmetic (the shipped compound row writes `||||`),
            // so only extra cells that actually carry content indicate merged rows.
            const overflow = row.slice(content.headers.length).filter(cell => cell.trim().length > 0);
            if (overflow.length > 0) {
                issues.push(issue(
                    'tableRowConcatenated',
                    `$.${section}`,
                    `Row ${index + 1} has ${overflow.length} cell(s) beyond the ${content.headers.length} the header declares: ${overflow.join(', ')}.`,
                ));
            }
        }
    }
}

/**
 * A `{placeholder}` left in means the agent copied the template without filling it.
 *
 * Route parameters (`/api/photos/{id}`) and inline JSON payloads are legitimate plan
 * content, so a brace only counts when it names a template field — either a known
 * single-word token or a multi-word prompt like `{ISO-8601 datetime}`.
 */
const templateTokens = new Set([
    'name', 'path', 'type', 'runtime', 'version', 'label', 'service', 'services',
    'status', 'description', 'tool', 'emulator', 'orchestrator', 'category',
]);

function validatePlaceholders(data: LocalPlanData, issues: ArtifactValidationIssue[]): void {
    for (const { section, content } of walkContent(data)) {
        const text = contentText(content);
        for (const match of text.matchAll(/(.?)\{([^}\n]+)\}/g)) {
            const [, preceding, body] = match;
            // `/api/pairs/{id}` — a route parameter, not an unfilled field.
            if (preceding === '/' || preceding === '"') {
                continue;
            }
            const inner = body.trim();
            const isTemplatePrompt = /[\s|/]/.test(inner) || templateTokens.has(inner.toLowerCase());
            if (isTemplatePrompt && !/^["\d]/.test(inner)) {
                issues.push(issue('unfilledPlaceholder', `$.${section}`, `Template placeholder "{${inner}}" was never filled in.`));
                break;
            }
        }
    }
}

function validatePrerequisites(data: LocalPlanData, issues: ArtifactValidationIssue[]): void {
    const table = findTable(data, 'prerequisites');
    if (!table) {
        return;
    }
    const installed = findColumnIndex(table.headers, 'installed');
    if (installed === -1) {
        issues.push(issue('missingPrerequisiteColumn', '$.prerequisites', 'Prerequisites table must have an "Installed" column.'));
        return;
    }
    let hasUnconfirmed = false;
    for (const row of table.rows) {
        const marker = row[installed]?.trim() ?? '';
        if (marker === '❓') {
            hasUnconfirmed = true;
        } else if (marker !== '✅') {
            issues.push(issue('invalidInstalledMarker', '$.prerequisites', `Installed must be ✅ or ❓, found "${marker || 'empty'}".`));
        }
    }
    // The template pairs any ❓ with an explicit call to action, because that marker is
    // the user's only cue to check a tool before approving.
    if (hasUnconfirmed && !hasActionRequiredCallout(data)) {
        issues.push(issue('missingActionRequiredCallout', '$.prerequisites', 'A ❓ prerequisite requires the "Action required" callout.'));
    }
}

function validateDebugConfigurations(
    data: LocalPlanData,
    expectations: LocalDebugPlanExpectations,
    issues: ArtifactValidationIssue[],
): DebugConfigRow[] {
    const table = findTable(data, 'debug configurations');
    if (!table) {
        return [];
    }
    for (const column of ['generate', 'debug config name']) {
        if (findColumnIndex(table.headers, column) === -1) {
            issues.push(issue('missingDebugConfigColumn', '$.debugConfigurations', `Debug Configurations table must have a "${column}" column.`));
        }
    }

    const rows = readDebugConfigRows(data);
    if (rows.length === 0) {
        issues.push(issue('noDebugConfigRows', '$.debugConfigurations', 'Debug Configurations table has no rows.'));
        return rows;
    }

    const generateColumn = findColumnIndex(table.headers, 'generate');
    if (generateColumn !== -1) {
        for (const row of table.rows) {
            const marker = row[generateColumn]?.trim() ?? '';
            if (!/^\[[ xX]\]$/.test(marker)) {
                issues.push(issue('invalidGenerateMarker', '$.debugConfigurations', `Generate must be [x] or [ ], found "${marker || 'empty'}".`));
            }
        }
    }

    const generated = rows.filter(row => row.generate);
    const services = generated.filter(row => !row.isCompound);
    if (generated.length === 0) {
        issues.push(issue('noGeneratedConfigs', '$.debugConfigurations', 'No Debug Configurations row is marked [x], so generation would produce nothing.'));
    }

    for (const row of services) {
        if (!row.name) {
            issues.push(issue('incompleteDebugConfigRow', '$.debugConfigurations', 'A generated row has no Debug Config Name.'));
        }
        for (const [label, value] of [['Service Root', row.serviceRoot], ['Project Type', row.projectType], ['Runtime', row.runtime]] as const) {
            if (!value || value === '—') {
                issues.push(issue('incompleteDebugConfigRow', '$.debugConfigurations', `Generated config "${row.name || '(unnamed)'}" is missing ${label}.`));
            }
        }
    }

    const duplicates = findDuplicates(services.map(row => row.name.toLowerCase()));
    for (const duplicate of duplicates) {
        issues.push(issue('duplicateDebugConfigName', '$.debugConfigurations', `Debug Config Name "${duplicate}" is used more than once.`));
    }

    // A workspace with two or more debuggable services needs a single entry point,
    // otherwise the user has to start each service by hand.
    const hasCompound = generated.some(row => row.isCompound);
    if (services.length > 1 && !hasCompound) {
        issues.push(issue('missingCompoundConfig', '$.debugConfigurations', `${services.length} services are generated but no "${COMPOUND_PROJECT_TYPE}" row is present.`));
    }
    if (services.length <= 1 && hasCompound) {
        issues.push(issue('unexpectedCompoundConfig', '$.debugConfigurations', 'A compound config row is present but there is fewer than two services to compose.'));
    }

    if (expectations.expectedServiceCount !== undefined && services.length !== expectations.expectedServiceCount) {
        issues.push(issue('unexpectedServiceCount', '$.debugConfigurations', `Expected ${expectations.expectedServiceCount} generated services, found ${services.length}.`));
    }

    return rows;
}

function validateEmulators(
    data: LocalPlanData,
    expectations: LocalDebugPlanExpectations,
    issues: ArtifactValidationIssue[],
): void {
    const rows = findTable(data, 'emulators')?.rows ?? [];
    const text = rows.map(row => row.join(' ')).join('\n');

    if (expectations.expectNoEmulators && rows.length > 0) {
        issues.push(issue('unexpectedEmulator', '$.emulators', `Expected no emulators, found ${rows.length}.`));
    }
    for (const expected of expectations.expectedEmulators ?? []) {
        if (!text.toLowerCase().includes(expected.toLowerCase())) {
            issues.push(issue('missingEmulator', '$.emulators', `Expected an emulator matching "${expected}", found: ${rows.length ? text.replace(/\n/g, '; ') : '(none)'}.`));
        }
    }
}

function validateOrchestrator(
    data: LocalPlanData,
    expectations: LocalDebugPlanExpectations,
    issues: ArtifactValidationIssue[],
): void {
    const info = readOrchestratorInfo(data);

    // Internal consistency: the Compose command must drive the engine the plan will actually use.
    // Normally that means the runtime column and the command name the same engine — but Podman's
    // **Docker-compatibility** mode intentionally pairs the `podman` engine with `docker compose`
    // (via a Docker-compatible socket), so in that case the command is expected to be `docker`.
    // Only enforced when both the runtime column and the command identify an engine, so old
    // single-column plans pass.
    if (info.engine && info.commandEngine) {
        const expectedCommandEngine: ContainerRuntime = info.dockerCompatible ? 'docker' : info.engine;
        if (info.commandEngine !== expectedCommandEngine) {
            issues.push(issue(
                'orchestratorRuntimeMismatch',
                '$.orchestrator',
                info.dockerCompatible
                    ? `Orchestrator records Podman in Docker-compatibility mode, so its Compose command must be "docker compose", but it names "${info.commandEngine} compose".`
                    : `Orchestrator records container runtime "${info.engine}" but its Compose command names "${info.commandEngine}". They must name the same engine.`,
            ));
        }
    }

    if (expectations.expectedRuntime && info.engine !== expectations.expectedRuntime) {
        issues.push(issue(
            'unexpectedRuntime',
            '$.orchestrator',
            `Expected the Orchestrator to record container runtime "${expectations.expectedRuntime}", found "${info.engine ?? 'none'}".`,
        ));
    }

    if (expectations.expectedDockerCompatible !== undefined && !!info.dockerCompatible !== expectations.expectedDockerCompatible) {
        issues.push(issue(
            'unexpectedDockerCompatible',
            '$.orchestrator',
            `Expected the Orchestrator to ${expectations.expectedDockerCompatible ? 'record' : 'not record'} Podman Docker-compatibility mode, found: ${info.dockerCompatible ? 'recorded' : 'not recorded'}.`,
        ));
    }
}

/** The raw Orchestrator cells for the first populated row. */
function readOrchestratorCells(
    data: LocalPlanData,
): { runtimeCell: string; commandCell: string; orchestratorCell: string } | undefined {
    const table = findTable(data, 'orchestrator');
    if (!table || table.rows.length === 0) {
        return undefined;
    }
    const commandIdx = findColumnIndex(table.headers, 'compose command');
    const runtimeIdx = findColumnIndex(table.headers, 'container runtime');
    const orchestratorIdx = findColumnIndex(table.headers, 'orchestrator');
    const row = table.rows.find(candidate => candidate.some(value => value.trim().length > 0)) ?? table.rows[0];
    return {
        runtimeCell: cell(row, runtimeIdx),
        commandCell: cell(row, commandIdx).replace(/`/g, '').replace(/\s+/g, ' ').trim(),
        orchestratorCell: cell(row, orchestratorIdx),
    };
}

interface OrchestratorInfo {
    /** The actual container engine, or undefined for a plan that predates the field. */
    engine?: ContainerRuntime;
    /** True when the plan runs Podman via its Docker-compatibility socket (engine `podman`, command `docker compose`). */
    dockerCompatible: boolean;
    /** The engine named by the Compose command cell, if any. */
    commandEngine?: ContainerRuntime;
    /** Normalized Compose command the generation phase should emit. */
    composeCommand?: string;
}

/**
 * Resolves the container engine, Docker-compatibility flag, and Compose command from the plan's
 * Orchestrator table.
 *
 * Understands the current shape (Orchestrator | Container Runtime | Compose Command | Description),
 * the older single-column (Orchestrator | Description) shape, and Podman's Docker-compatibility
 * mode (a `Podman (Docker-compatible)` runtime paired with a `docker compose` command). Returns an
 * empty engine when none can be identified, so callers skip runtime checks on plans that predate
 * the field rather than failing them.
 */
function readOrchestratorInfo(data: LocalPlanData): OrchestratorInfo {
    const cells = readOrchestratorCells(data);
    if (!cells) {
        return { dockerCompatible: false };
    }

    const dockerCompatible = isDockerCompatible(cells.runtimeCell) || isDockerCompatible(cells.orchestratorCell);
    const engine: ContainerRuntime | undefined = dockerCompatible
        ? 'podman'
        : detectRuntime(cells.runtimeCell) ?? detectRuntime(cells.commandCell) ?? detectRuntime(cells.orchestratorCell);
    const commandEngine = detectRuntime(cells.commandCell);

    if (!engine) {
        return { dockerCompatible: false };
    }

    // The command the engine actually drives: `docker compose` under Docker-compat, else the engine's own.
    const expectedCommandEngine: ContainerRuntime = dockerCompatible ? 'docker' : engine;
    const composeCommand = /\bcompose\b/.test(cells.commandCell.toLowerCase())
        ? cells.commandCell.toLowerCase()
        : `${expectedCommandEngine} compose`;

    return { engine, dockerCompatible, commandEngine, composeCommand };
}

/** True when a cell names Podman running in Docker-compatibility mode (engine podman, command docker). */
function isDockerCompatible(text: string): boolean {
    const value = text.toLowerCase();
    return /\bpodman\b/.test(value) && /docker[- ]?compat/.test(value);
}

/** Identifies the container engine named in a cell, if any. */
function detectRuntime(text: string): ContainerRuntime | undefined {
    const value = text.toLowerCase();
    if (/\bpodman\b/.test(value)) {
        return 'podman';
    }
    if (/\bdocker\b/.test(value)) {
        return 'docker';
    }
    return undefined;
}

function validateArchitectureDiagram(data: LocalPlanData, issues: ArtifactValidationIssue[]): void {
    const section = findSection(data, 'architecture diagram');
    if (!section) {
        return;
    }
    const mermaid = flattenContent(section.content).find(
        content => content.type === 'codeBlock' && content.language.toLowerCase() === 'mermaid',
    );
    if (!mermaid) {
        issues.push(issue('missingMermaidDiagram', '$.architectureDiagram', 'Architecture Diagram section must contain a ```mermaid code block.'));
        return;
    }
    if (mermaid.type === 'codeBlock' && mermaid.code.trim().length === 0) {
        issues.push(issue('emptyMermaidDiagram', '$.architectureDiagram', 'The mermaid diagram is empty.'));
    }
}

/**
 * The checklist is the generation phase's evidence that it really validated each
 * configuration. `validation.md` names a stubbed or missing checklist the single most
 * common failure mode, so an `Implemented` plan must carry a real result per config.
 */
function validateChecklist(
    data: LocalPlanData,
    debugConfigs: DebugConfigRow[],
    expectations: LocalDebugPlanExpectations,
    issues: ArtifactValidationIssue[],
): void {
    const implemented = data.status.trim().toLowerCase() === LocalDebugPlanStatus.Implemented;
    if (!expectations.requireChecklist && !implemented) {
        return;
    }

    const section = findSection(data, 'debug configuration checklist');
    if (!section) {
        issues.push(issue('missingChecklist', '$.debugConfigurationChecklist', 'A plan reporting validation results must include a "Debug Configuration Checklist" section.'));
        return;
    }

    const entries = checklistEntries(section);
    if (entries.length === 0) {
        issues.push(issue('missingChecklist', '$.debugConfigurationChecklist', 'The Debug Configuration Checklist has no entries.'));
        return;
    }

    for (const entry of entries) {
        if (!/^[✅❌]/.test(entry)) {
            issues.push(issue('checklistStub', '$.debugConfigurationChecklist', `Checklist entry "${truncate(entry)}" has no ✅ or ❌ result.`));
            continue;
        }
        // An entry reads `✅ <Config Name> — <evidence>`; only the evidence half tells
        // us whether validation actually happened, so isolate it before judging.
        const body = entry.slice(1).trim();
        const separator = /\s+(?:—|–|-{1,2}|:)\s+/.exec(body);
        const detail = separator ? body.slice(separator.index + separator[0].length).trim() : '';
        // A stub is the *absence* of evidence: no evidence half at all, or the
        // template's own `<ready signal + curl result>` placeholder. Real entries
        // legitimately quote JSON payloads and words like "pending", so never match
        // on those.
        if (!detail || /^<[^>]*>$/.test(detail) || /^(TBD|TODO|pending|N\/A)\.?$/i.test(detail)) {
            issues.push(issue('checklistStub', '$.debugConfigurationChecklist', `Checklist entry "${truncate(entry)}" is still a stub.`));
        }
    }

    const joined = entries.join('\n').toLowerCase();
    for (const row of debugConfigs.filter(config => config.generate && config.name)) {
        if (!joined.includes(row.name.toLowerCase())) {
            issues.push(issue('checklistMissingEntry', '$.debugConfigurationChecklist', `No checklist entry for generated config "${row.name}".`));
        }
    }
}

function checklistEntries(section: LocalPlanSection): string[] {
    const entries: string[] = [];
    for (const content of flattenContent(section.content)) {
        if (content.type === 'bulletList') {
            entries.push(...content.items.map(item => item.trim()));
            continue;
        }
        const text = contentText(content);
        for (const line of text.split('\n').map(value => value.trim())) {
            // Skip the section's own lead-in line ("Debug Configuration Checklist:").
            if (!line || /^debug configuration checklist:?$/i.test(line)) {
                continue;
            }
            entries.push(line);
        }
    }
    return entries;
}

function readDebugConfigRows(data: LocalPlanData): DebugConfigRow[] {
    const table = findTable(data, 'debug configurations');
    if (!table) {
        return [];
    }
    const generate = findColumnIndex(table.headers, 'generate');
    const name = findColumnIndex(table.headers, 'debug config name');
    const serviceRoot = findColumnIndex(table.headers, 'service root');
    const projectType = findColumnIndex(table.headers, 'project type');
    const runtime = findColumnIndex(table.headers, 'runtime');

    return table.rows
        .filter(row => row.some(cell => cell.trim().length > 0))
        .map(row => {
            const type = cell(row, projectType);
            return {
                generate: isChecked(cell(row, generate)),
                name: cell(row, name),
                serviceRoot: cell(row, serviceRoot),
                projectType: type,
                runtime: cell(row, runtime),
                isCompound: type.toLowerCase().includes('compound'),
            };
        });
}

function readChecklistRows(data: LocalPlanData, sectionName: string): PlanChecklistRow[] {
    const table = findTable(data, sectionName);
    if (!table) {
        return [];
    }
    const generate = findColumnIndex(table.headers, 'generate');
    const service = findColumnIndex(table.headers, 'service');
    return table.rows
        .filter(row => row.some(value => value.trim().length > 0))
        .map(row => ({
            generate: isChecked(cell(row, generate)),
            service: cell(row, service),
        }));
}

function readConvenienceScriptRows(data: LocalPlanData): ConvenienceScriptRow[] {
    const table = findTable(data, 'convenience scripts');
    if (!table) {
        return [];
    }
    const generate = findColumnIndex(table.headers, 'generate');
    const script = findColumnIndex(table.headers, 'script');
    const registeredIn = findColumnIndex(table.headers, 'registered in');
    return table.rows
        .filter(row => row.some(value => value.trim().length > 0))
        .map(row => ({
            generate: isChecked(cell(row, generate)),
            script: cell(row, script).replace(/`/g, ''),
            registeredIn: cell(row, registeredIn).replace(/`/g, ''),
        }));
}

/** The first table inside the section whose title contains `sectionTitle`. */
function findTable(data: LocalPlanData, sectionTitle: string): LocalPlanTableContent | undefined {
    const section = findSection(data, sectionTitle);
    return section && firstTable(section);
}

/** Section titles carry emoji and punctuation; key on letters and digits only. */
function sectionKey(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function cell(row: string[], index: number): string {
    return index === -1 ? '' : (row[index] ?? '').trim();
}

function walkContent(data: LocalPlanData): Array<{ section: string; content: LocalPlanContent }> {
    return data.sections.flatMap(section =>
        flattenContent(section.content).map(content => ({ section: sectionKey(section.title), content })),
    );
}

function contentText(content: LocalPlanContent): string {
    switch (content.type) {
        case 'table':
            return [content.headers.join(' '), ...content.rows.map(row => row.join(' '))].join('\n');
        case 'blockquote':
        case 'paragraph':
            return content.text;
        case 'bulletList':
            return content.items.join('\n');
        case 'codeBlock':
        case 'subsection':
            // Diagram bodies legitimately use braces, and subsection children are
            // visited separately by `flatten`.
            return '';
    }
}

function hasActionRequiredCallout(data: LocalPlanData): boolean {
    return walkContent(data).some(({ content }) =>
        content.type === 'blockquote' && /action required/i.test(content.text),
    );
}

function findDuplicates(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const value of values) {
        if (!value) {
            continue;
        }
        if (seen.has(value)) {
            duplicates.add(value);
        }
        seen.add(value);
    }
    return [...duplicates];
}

function truncate(value: string): string {
    return value.length > 60 ? `${value.slice(0, 57)}...` : value;
}

function issue(code: string, path: string, message: string): ArtifactValidationIssue {
    return { code, path, message };
}

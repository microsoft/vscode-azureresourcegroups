/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { RequirementsAnswer } from '../../src/webviews/copilotOnRails/views/utils/parseRequirements.ts';

export interface CorEvaluationScenario {
    schemaVersion: '1';
    id: string;
    prompt: string;
    baselinePrompt: string;
    model?: string;
    tags: Record<string, string>;
    requirementsAnswers?: Record<string, RequirementsAnswer>;
    validation: {
        profile: 'minimal' | 'standard' | 'advanced';
        build: boolean;
        test: boolean;
        lint: 'required' | 'if-present' | 'skip';
        timeoutMinutes: number;
        maxAgentRetries?: number;
    };
    acceptance?: {
        local?: {
            startupTimeoutSeconds?: number;
            compound?: boolean;
            probes: LocalAcceptanceProbe[];
            storageEvents?: StorageEventContract[];
            debugParity?: DebugParityContract;
        };
    };
}

export interface DebugParityContract {
    target: LocalAcceptanceProbe['target'];
    sourceGlob: string;
    lineIncludes: string;
    triggerUrl: string;
    timeoutSeconds?: number;
}

export interface LocalAcceptanceProbe {
    name: string;
    target: 'backend' | 'frontend' | 'worker';
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url?: string;
    headers?: Record<string, string>;
    body?: JsonValue;
    expectedStatus?: number;
    processPattern?: string;
    bodyIncludes?: string;
    debugPort?: number;
    debugProtocol?: 'tcp' | 'cdp';
    browser?: {
        expectedText?: string;
        requireInteractiveElements?: boolean;
        maxSeriousAccessibilityViolations?: number;
        viewport?: {
            width: number;
            height: number;
        };
        actions?: BrowserAction[];
        assertions?: BrowserAssertion[];
        persistence?: BrowserPersistenceContract;
    };
}

export interface BrowserPersistenceContract {
    restartTargets: Array<'backend' | 'frontend'>;
    reload: 'current-url' | string;
    assertions: BrowserAssertion[];
}

export interface StorageQueueEventContract {
    name: string;
    kind: 'queue';
    inputQueue: string;
    outputQueue: string;
    message: Record<string, JsonValue>;
    expectedMessageIncludes: Record<string, JsonValue>;
    timeoutSeconds?: number;
}

export interface StorageBlobEventContract {
    name: string;
    kind: 'blob';
    sourceContainer: string;
    destinationContainer: string;
    blobName: string;
    content: string;
    metadata: Record<string, string>;
    sourceMustBeDeleted?: boolean;
    timeoutSeconds?: number;
}

export type StorageEventContract = StorageQueueEventContract | StorageBlobEventContract;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface BrowserAction {
    kind: 'click' | 'fill' | 'select';
    selector: string;
    selectorType?: 'css' | 'label' | 'role';
    role?: BrowserRole;
    value?: string;
}

export interface BrowserAssertion {
    kind: 'visible' | 'hidden' | 'text' | 'value';
    selector: string;
    selectorType?: 'css' | 'label' | 'role';
    role?: BrowserRole;
    value?: string;
}

type BrowserRole = 'button' | 'link' | 'tab' | 'textbox' | 'combobox' | 'checkbox' | 'radio';

export async function loadScenarios(directory: string): Promise<CorEvaluationScenario[]> {
    const names = (await fs.readdir(directory))
        .filter(name => name.endsWith('.json'))
        .sort();
    const scenarios: CorEvaluationScenario[] = [];
    for (const name of names) {
        const filePath = path.join(directory, name);
        const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
        scenarios.push(validateScenario(parsed, filePath));
    }
    return scenarios;
}

export function validateScenario(value: unknown, filePath: string): CorEvaluationScenario {
    if (!value || typeof value !== 'object') {
        throw new Error(`Scenario must be an object: ${filePath}`);
    }
    const raw = value as Record<string, unknown>;
    if (raw.schemaVersion !== '1') {
        throw new Error(`Scenario schemaVersion must be "1": ${filePath}`);
    }
    if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9-]+$/.test(raw.id)) {
        throw new Error(`Scenario id must be kebab-case: ${filePath}`);
    }
    if (typeof raw.prompt !== 'string' || raw.prompt.trim().length === 0) {
        throw new Error(`Scenario prompt must be non-empty: ${filePath}`);
    }
    if (typeof raw.baselinePrompt !== 'string' || raw.baselinePrompt.trim().length < 100) {
        throw new Error(`Scenario baselinePrompt must be a standalone prompt of at least 100 characters: ${filePath}`);
    }
    if (!raw.tags || typeof raw.tags !== 'object' || Array.isArray(raw.tags)) {
        throw new Error(`Scenario tags must be an object: ${filePath}`);
    }
    const tags = raw.tags as Record<string, unknown>;
    if (Object.values(tags).some(value => typeof value !== 'string' || value.length === 0)) {
        throw new Error(`Scenario tag values must be non-empty strings: ${filePath}`);
    }
    if (raw.model !== undefined && typeof raw.model !== 'string') {
        throw new Error(`Scenario model must be a string: ${filePath}`);
    }
    if (raw.requirementsAnswers !== undefined) {
        if (!raw.requirementsAnswers || typeof raw.requirementsAnswers !== 'object' || Array.isArray(raw.requirementsAnswers)) {
            throw new Error(`Scenario requirementsAnswers must be an object: ${filePath}`);
        }
        for (const [id, answer] of Object.entries(raw.requirementsAnswers)) {
            if (!id || !isRequirementsAnswer(answer)) {
                throw new Error(`Scenario requirement answer "${id}" is invalid: ${filePath}`);
            }
        }
    }
    validateDataStoreAlignment(
        raw.id,
        tags.database,
        (raw.requirementsAnswers as Record<string, unknown> | undefined)?.dataStores,
        filePath,
    );
    validateScenarioValidation(raw.validation, filePath);
    validateAcceptance(raw.acceptance, filePath);
    return raw as unknown as CorEvaluationScenario;
}

function validateDataStoreAlignment(
    scenarioId: unknown,
    databaseTag: unknown,
    dataStores: unknown,
    filePath: string,
): void {
    const expectedByTag: Record<string, string[]> = {
        'azure-sql': ['Azure SQL'],
        blob: ['Blob Storage'],
        cosmos: ['CosmosDB'],
        'cosmos-queue': ['CosmosDB', 'Queue Storage'],
        none: ['No datastore required'],
        postgres: ['PostgreSQL'],
        'postgres-queue': ['PostgreSQL', 'Queue Storage'],
        queue: ['Queue Storage'],
        redis: ['Redis'],
    };
    const expected = typeof databaseTag === 'string' ? expectedByTag[databaseTag] : undefined;
    if (!expected) {
        return;
    }
    const actual = Array.isArray(dataStores) && dataStores.every(value => typeof value === 'string')
        ? [...dataStores].sort()
        : [];
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
        throw new Error(
            `Scenario "${String(scenarioId)}" dataStores must match database tag "${databaseTag}": ${filePath}`,
        );
    }
}

function validateScenarioValidation(value: unknown, filePath: string): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Scenario validation must be an object: ${filePath}`);
    }
    const validation = value as Record<string, unknown>;
    if (!['minimal', 'standard', 'advanced'].includes(validation.profile as string)) {
        throw new Error(`Scenario validation profile is invalid: ${filePath}`);
    }
    if (typeof validation.build !== 'boolean' || typeof validation.test !== 'boolean') {
        throw new Error(`Scenario validation build and test flags must be booleans: ${filePath}`);
    }
    if (!['required', 'if-present', 'skip'].includes(validation.lint as string)) {
        throw new Error(`Scenario validation lint mode is invalid: ${filePath}`);
    }
    if (!Number.isInteger(validation.timeoutMinutes) || (validation.timeoutMinutes as number) < 1 || (validation.timeoutMinutes as number) > 30) {
        throw new Error(`Scenario validation timeoutMinutes must be an integer from 1 to 30: ${filePath}`);
    }
    if (validation.maxAgentRetries !== undefined
        && (!Number.isInteger(validation.maxAgentRetries)
            || (validation.maxAgentRetries as number) < 0
            || (validation.maxAgentRetries as number) > 2)) {
        throw new Error(`Scenario validation maxAgentRetries must be an integer from 0 to 2: ${filePath}`);
    }
}

function validateAcceptance(value: unknown, filePath: string): void {
    if (value === undefined) {
        return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Scenario acceptance must be an object: ${filePath}`);
    }
    const local = (value as Record<string, unknown>).local;
    if (local === undefined) {
        return;
    }
    if (!local || typeof local !== 'object' || Array.isArray(local)) {
        throw new Error(`Scenario acceptance.local must be an object: ${filePath}`);
    }
    const contract = local as Record<string, unknown>;
    if (contract.compound !== undefined && typeof contract.compound !== 'boolean') {
        throw new Error(`Scenario acceptance.local.compound must be boolean: ${filePath}`);
    }
    if (contract.startupTimeoutSeconds !== undefined
        && (!Number.isInteger(contract.startupTimeoutSeconds)
            || (contract.startupTimeoutSeconds as number) < 10
            || (contract.startupTimeoutSeconds as number) > 180)) {
        throw new Error(`Scenario acceptance.local.startupTimeoutSeconds must be an integer from 10 to 180: ${filePath}`);
    }
    if (!Array.isArray(contract.probes) || contract.probes.length === 0) {
        throw new Error(`Scenario acceptance.local.probes must be a non-empty array: ${filePath}`);
    }
    validateDebugParity(contract.debugParity, filePath);
    validateStorageEvents(contract.storageEvents, filePath);
    for (const [index, probe] of contract.probes.entries()) {
        if (!probe || typeof probe !== 'object' || Array.isArray(probe)) {
            throw new Error(`Scenario local probe ${index} must be an object: ${filePath}`);
        }

        const item = probe as Record<string, unknown>;
        if (typeof item.name !== 'string' || !item.name.trim()) {
            throw new Error(`Scenario local probe ${index} requires a name: ${filePath}`);
        }
        if (!['backend', 'frontend', 'worker'].includes(item.target as string)) {
            throw new Error(`Scenario local probe ${index} target is invalid: ${filePath}`);
        }
        if (item.method !== undefined && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(item.method as string)) {
            throw new Error(`Scenario local probe ${index} method is invalid: ${filePath}`);
        }
        if (item.url !== undefined
            && (typeof item.url !== 'string' || !isLocalhostUrl(item.url))) {
            throw new Error(`Scenario local probe ${index} URL must target localhost: ${filePath}`);
        }
        if (item.expectedStatus !== undefined
            && (!Number.isInteger(item.expectedStatus)
                || (item.expectedStatus as number) < 100
                || (item.expectedStatus as number) > 599)) {
            throw new Error(`Scenario local probe ${index} expectedStatus is invalid: ${filePath}`);
        }
        const hasHttpProbe = item.url !== undefined || item.method !== undefined || item.expectedStatus !== undefined;
        if (hasHttpProbe && (item.url === undefined || item.method === undefined || item.expectedStatus === undefined)) {
            throw new Error(`Scenario local probe ${index} HTTP fields must be provided together: ${filePath}`);
        }
        if (item.processPattern !== undefined && (typeof item.processPattern !== 'string' || !item.processPattern.trim())) {
            throw new Error(`Scenario local probe ${index} processPattern must be non-empty: ${filePath}`);
        }
        if (!hasHttpProbe && item.processPattern === undefined) {
            throw new Error(`Scenario local probe ${index} requires HTTP fields or processPattern: ${filePath}`);
        }
        if (item.bodyIncludes !== undefined && typeof item.bodyIncludes !== 'string') {
            throw new Error(`Scenario local probe ${index} bodyIncludes must be a string: ${filePath}`);
        }
        validateHttpRequestFields(item, hasHttpProbe, filePath, index);
        if (item.debugPort !== undefined
            && (!Number.isInteger(item.debugPort) || (item.debugPort as number) < 1 || (item.debugPort as number) > 65535)) {
            throw new Error(`Scenario local probe ${index} debugPort is invalid: ${filePath}`);
        }
        if (item.debugProtocol !== undefined && !['tcp', 'cdp'].includes(item.debugProtocol as string)) {
            throw new Error(`Scenario local probe ${index} debugProtocol is invalid: ${filePath}`);
        }
        if (item.debugProtocol !== undefined && item.debugPort === undefined) {
            throw new Error(`Scenario local probe ${index} debugProtocol requires debugPort: ${filePath}`);
        }
        if (item.browser !== undefined) {
            if (!item.browser || typeof item.browser !== 'object' || Array.isArray(item.browser)) {
                throw new Error(`Scenario local probe ${index} browser contract is invalid: ${filePath}`);
            }
            const browser = item.browser as Record<string, unknown>;
            if (browser.expectedText !== undefined && (typeof browser.expectedText !== 'string' || !browser.expectedText.trim())) {
                throw new Error(`Scenario local probe ${index} browser.expectedText must be non-empty: ${filePath}`);
            }
            if (browser.requireInteractiveElements !== undefined && typeof browser.requireInteractiveElements !== 'boolean') {
                throw new Error(`Scenario local probe ${index} browser.requireInteractiveElements must be boolean: ${filePath}`);
            }
            if (browser.maxSeriousAccessibilityViolations !== undefined
                && (!Number.isInteger(browser.maxSeriousAccessibilityViolations)
                    || (browser.maxSeriousAccessibilityViolations as number) < 0)) {
                throw new Error(`Scenario local probe ${index} browser.maxSeriousAccessibilityViolations must be a non-negative integer: ${filePath}`);
            }
            if (item.url === undefined) {
                throw new Error(`Scenario local probe ${index} browser contract requires an HTTP URL: ${filePath}`);
            }
            validateBrowserViewport(browser.viewport, filePath, index);
            validateBrowserSteps(browser.actions, 'actions', ['click', 'fill', 'select'], filePath, index);
            validateBrowserSteps(browser.assertions, 'assertions', ['visible', 'hidden', 'text', 'value'], filePath, index);
            validateBrowserPersistence(browser.persistence, contract.compound, filePath, index);
        }
    }
    const probes = contract.probes as Array<Record<string, unknown>>;
    for (const [index, probe] of probes.entries()) {
        const persistence = (probe.browser as Record<string, unknown> | undefined)?.persistence as Record<string, unknown> | undefined;
        for (const target of (persistence?.restartTargets as string[] | undefined) ?? []) {
            if (!probes.some(candidate => candidate.target === target)) {
                throw new Error(`Scenario local probe ${index} persistence target "${target}" has no readiness probe: ${filePath}`);
            }
        }
    }
    if (contract.storageEvents !== undefined && !probes.some(probe => probe.target === 'worker')) {
        throw new Error(`Scenario storage events require a worker probe: ${filePath}`);
    }
}

function validateHttpRequestFields(
    probe: Record<string, unknown>,
    hasHttpProbe: boolean,
    filePath: string,
    index: number,
): void {
    if ((probe.headers !== undefined || probe.body !== undefined) && !hasHttpProbe) {
        throw new Error(`Scenario local probe ${index} headers and body require an HTTP probe: ${filePath}`);
    }
    if (probe.headers !== undefined) {
        if (!probe.headers || typeof probe.headers !== 'object' || Array.isArray(probe.headers)) {
            throw new Error(`Scenario local probe ${index} headers must be an object: ${filePath}`);
        }
        const entries = Object.entries(probe.headers as Record<string, unknown>);
        if (entries.length > 32 || entries.some(([name, value]) =>
            !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)
            || typeof value !== 'string'
            || value.length > 8_192
            || /[\r\n\0]/.test(value))) {
            throw new Error(`Scenario local probe ${index} headers contain an invalid name or value: ${filePath}`);
        }
    }
    if (probe.body !== undefined) {
        if (!isJsonValue(probe.body) || JSON.stringify(probe.body).length > 65_536) {
            throw new Error(`Scenario local probe ${index} body must be JSON-compatible and at most 65536 bytes: ${filePath}`);
        }
        if (probe.method === 'GET') {
            throw new Error(`Scenario local probe ${index} GET requests cannot declare a body: ${filePath}`);
        }
    }
}

function validateBrowserPersistence(
    value: unknown,
    compound: unknown,
    filePath: string,
    probeIndex: number,
): void {
    if (value === undefined) {
        return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Scenario local probe ${probeIndex} browser.persistence must be an object: ${filePath}`);
    }
    const contract = value as Record<string, unknown>;
    if (!Array.isArray(contract.restartTargets)
        || contract.restartTargets.length === 0
        || new Set(contract.restartTargets).size !== contract.restartTargets.length
        || contract.restartTargets.some(target => !['backend', 'frontend'].includes(target as string))) {
        throw new Error(`Scenario local probe ${probeIndex} browser.persistence.restartTargets is invalid: ${filePath}`);
    }
    if (contract.restartTargets.length > 1 && compound !== true) {
        throw new Error(`Scenario local probe ${probeIndex} multi-service persistence requires local.compound: ${filePath}`);
    }
    if (typeof contract.reload !== 'string'
        || (contract.reload !== 'current-url'
            && !isLocalhostUrl(contract.reload))) {
        throw new Error(`Scenario local probe ${probeIndex} browser.persistence.reload must be "current-url" or a localhost URL: ${filePath}`);
    }
    if (!Array.isArray(contract.assertions) || contract.assertions.length === 0) {
        throw new Error(`Scenario local probe ${probeIndex} browser.persistence.assertions must be non-empty: ${filePath}`);
    }
    validateBrowserSteps(contract.assertions, 'persistence.assertions', ['visible', 'hidden', 'text', 'value'], filePath, probeIndex);
}

function validateStorageEvents(value: unknown, filePath: string): void {
    if (value === undefined) {
        return;
    }
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`Scenario acceptance.local.storageEvents must be a non-empty array: ${filePath}`);
    }
    for (const [index, raw] of value.entries()) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error(`Scenario storage event ${index} must be an object: ${filePath}`);
        }
        const event = raw as Record<string, unknown>;
        if (typeof event.name !== 'string' || !event.name.trim() || !['queue', 'blob'].includes(event.kind as string)) {
            throw new Error(`Scenario storage event ${index} name or kind is invalid: ${filePath}`);
        }
        if (event.kind === 'blob') {
            validateBlobStorageEvent(event, filePath, index);
            validateStorageEventTimeout(event, filePath, index);
            continue;
        }
        for (const property of ['inputQueue', 'outputQueue'] as const) {
            if (typeof event[property] !== 'string'
                || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(event[property] as string)
                || (event[property] as string).includes('--')) {
                throw new Error(`Scenario storage event ${index} ${property} is not a valid queue name: ${filePath}`);
            }
        }
        if (event.inputQueue === event.outputQueue) {
            throw new Error(`Scenario storage event ${index} input and output queues must differ: ${filePath}`);
        }
        for (const property of ['message', 'expectedMessageIncludes'] as const) {
            if (!event[property] || typeof event[property] !== 'object' || Array.isArray(event[property])
                || Object.keys(event[property] as object).length === 0 || !isJsonValue(event[property])) {
                throw new Error(`Scenario storage event ${index} ${property} must be a non-empty JSON object: ${filePath}`);
            }
        }
        validateStorageEventTimeout(event, filePath, index);
    }
}

function validateBlobStorageEvent(event: Record<string, unknown>, filePath: string, index: number): void {
    for (const property of ['sourceContainer', 'destinationContainer'] as const) {
        if (typeof event[property] !== 'string'
            || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(event[property] as string)
            || (event[property] as string).includes('--')) {
            throw new Error(`Scenario storage event ${index} ${property} is not a valid container name: ${filePath}`);
        }
    }
    if (event.sourceContainer === event.destinationContainer) {
        throw new Error(`Scenario storage event ${index} source and destination containers must differ: ${filePath}`);
    }
    if (typeof event.blobName !== 'string'
        || !event.blobName.trim()
        || event.blobName.length > 1_024
        || /[\0\\]/.test(event.blobName)) {
        throw new Error(`Scenario storage event ${index} blobName is invalid: ${filePath}`);
    }
    if (typeof event.content !== 'string' || !event.content || Buffer.byteLength(event.content) > 65_536) {
        throw new Error(`Scenario storage event ${index} content must be a non-empty string at most 65536 bytes: ${filePath}`);
    }
    if (!event.metadata || typeof event.metadata !== 'object' || Array.isArray(event.metadata)
        || Object.keys(event.metadata).length === 0
        || Object.entries(event.metadata as Record<string, unknown>).some(([name, value]) =>
            !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
            || typeof value !== 'string'
            || !value
            || /[\r\n\0]/.test(value))) {
        throw new Error(`Scenario storage event ${index} metadata must be a non-empty string map with valid names: ${filePath}`);
    }
    if (event.sourceMustBeDeleted !== undefined && typeof event.sourceMustBeDeleted !== 'boolean') {
        throw new Error(`Scenario storage event ${index} sourceMustBeDeleted must be boolean: ${filePath}`);
    }
}

function validateStorageEventTimeout(event: Record<string, unknown>, filePath: string, index: number): void {
    if (event.timeoutSeconds !== undefined
        && (!Number.isInteger(event.timeoutSeconds)
            || (event.timeoutSeconds as number) < 10
            || (event.timeoutSeconds as number) > 180)) {
        throw new Error(`Scenario storage event ${index} timeoutSeconds must be an integer from 10 to 180: ${filePath}`);
    }
}

function isJsonValue(value: unknown): value is JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }
    return !!value
        && typeof value === 'object'
        && Object.entries(value).every(([key, item]) => !!key && isJsonValue(item));
}

function validateDebugParity(value: unknown, filePath: string): void {
    if (value === undefined) {
        return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Scenario acceptance.local.debugParity must be an object: ${filePath}`);
    }
    const contract = value as Record<string, unknown>;
    if (!['backend', 'frontend', 'worker'].includes(contract.target as string)) {
        throw new Error(`Scenario debugParity target is invalid: ${filePath}`);
    }
    for (const property of ['sourceGlob', 'lineIncludes', 'triggerUrl'] as const) {
        if (typeof contract[property] !== 'string' || !(contract[property] as string).trim()) {
            throw new Error(`Scenario debugParity.${property} must be a non-empty string: ${filePath}`);
        }
    }
    if (!isLocalhostUrl(contract.triggerUrl as string)) {
        throw new Error(`Scenario debugParity.triggerUrl must target localhost: ${filePath}`);
    }
    if (contract.timeoutSeconds !== undefined
        && (!Number.isInteger(contract.timeoutSeconds)
            || (contract.timeoutSeconds as number) < 30
            || (contract.timeoutSeconds as number) > 300)) {
        throw new Error(`Scenario debugParity.timeoutSeconds must be an integer from 30 to 300: ${filePath}`);
    }
}

function validateBrowserViewport(value: unknown, filePath: string, index: number): void {
    if (value === undefined) {
        return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Scenario local probe ${index} browser.viewport is invalid: ${filePath}`);
    }
    const viewport = value as Record<string, unknown>;
    if (!Number.isInteger(viewport.width) || !Number.isInteger(viewport.height)
        || (viewport.width as number) < 320 || (viewport.width as number) > 3840
        || (viewport.height as number) < 320 || (viewport.height as number) > 2160) {
        throw new Error(`Scenario local probe ${index} browser.viewport dimensions are invalid: ${filePath}`);
    }
}

function validateBrowserSteps(
    value: unknown,
    property: string,
    kinds: string[],
    filePath: string,
    probeIndex: number,
): void {
    if (value === undefined) {
        return;
    }
    if (!Array.isArray(value)) {
        throw new Error(`Scenario local probe ${probeIndex} browser.${property} must be an array: ${filePath}`);
    }
    for (const [index, step] of value.entries()) {
        if (!step || typeof step !== 'object' || Array.isArray(step)) {
            throw new Error(`Scenario local probe ${probeIndex} browser.${property}[${index}] is invalid: ${filePath}`);
        }
        const item = step as Record<string, unknown>;
        if (!kinds.includes(item.kind as string) || typeof item.selector !== 'string' || !item.selector.trim()) {
            throw new Error(`Scenario local probe ${probeIndex} browser.${property}[${index}] is invalid: ${filePath}`);
        }
        if (item.selectorType !== undefined && !['css', 'label', 'role'].includes(item.selectorType as string)) {
            throw new Error(`Scenario local probe ${probeIndex} browser.${property}[${index}].selectorType is invalid: ${filePath}`);
        }
        if (
            item.selectorType === 'role'
            && !['button', 'link', 'tab', 'textbox', 'combobox', 'checkbox', 'radio'].includes(item.role as string)
        ) {
            throw new Error(`Scenario local probe ${probeIndex} browser.${property}[${index}].role is invalid: ${filePath}`);
        }
        const needsValue = ['fill', 'select', 'text', 'value'].includes(item.kind as string);
        if (needsValue && typeof item.value !== 'string') {
            throw new Error(`Scenario local probe ${probeIndex} browser.${property}[${index}] requires value: ${filePath}`);
        }
    }
}

function isRequirementsAnswer(value: unknown): value is RequirementsAnswer {
    return value === null
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
        || (Array.isArray(value) && value.every(item => typeof item === 'string'));
}

function isLocalhostUrl(value: string): boolean {
    if ([...value].some(character => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
    })) {
        return false;
    }
    try {
        const parsed = new URL(value);
        return ['http:', 'https:'].includes(parsed.protocol)
            && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
            && !parsed.username
            && !parsed.password;
    } catch {
        return false;
    }
}

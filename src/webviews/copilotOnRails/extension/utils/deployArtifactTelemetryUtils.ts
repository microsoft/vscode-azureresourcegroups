/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CopilotOnRailsContext } from '../../../../utils/copilotOnRails/CopilotOnRailsContext';
import { aggregateArmResourceTypes } from '../../../../utils/copilotOnRails/deploymentInventory';
import { setCorProp } from '../../../../utils/copilotOnRails/telemetryUtils';
import { isJsonObject } from '../../shared/jsonUtils';
import { parseDeployResultJson } from '../../views/utils/parseDeployResultJson';

type ArtifactFile = 'prereq-output.json' | 'prepare-plan.json' | 'scaffold-manifest.json' | 'deploy-result.json';
type Telemetry = Record<string, string | number | boolean>;
type JsonObject = Record<string, unknown>;

/** Artifact telemetry excludes identities, paths, URLs, commands, costs and free text. */
export interface DeployArtifactTelemetry {
    parsedOk: boolean;
    componentCount?: number;
    componentArchitecture?: string;
    buildPassedCount?: number;
    buildFailedCount?: number;
    deployabilityPassedCount?: number;
    deployabilityFailedCount?: number;
    overallHealth?: string;
    fastTrackEligible?: boolean;
    warningCount?: number;
    buildWarningCount?: number;
    completenessWarningCount?: number;
    deployabilityWarningCount?: number;
    hasNativeModules?: boolean;
    hasDockerfile?: boolean;
    f1Viable?: boolean;
    serviceCount?: number;
    serviceTypes?: string;
    serviceArchitecture?: string;
    iacFormat?: string;
    quotaStatus?: string;
    quotaVerified?: boolean;
    insufficientQuotaCount?: number;
    healingAttemptCount?: number;
    targetScope?: string;
    fileCount?: number;
    validationStatus?: string;
    validationPassedCount?: number;
    validationFailedCount?: number;
    validationWarningCount?: number;
    validationErrorCount?: number;
    conformancePassed?: boolean;
    conformanceStatus?: string;
    flaggedFindingCount?: number;
    status?: string;
    healthStatus?: string;
    partial?: boolean;
    durationSeconds?: number;
    endpointCount?: number;
    healthyEndpointCount?: number;
    failedResourceCount?: number;
    createdResourceCount?: number;
    orphanedResourceCount?: number;
    unverifiedResourceCount?: number;
    inventoryUnverified?: boolean;
    createdResourceTypeCounts?: string;
    failedResourceTypeCounts?: string;
    reusedResourceTypeCountsAvailable?: boolean;
}

const serviceTypes: Record<string, string> = {
    'functions': 'functions',
    'azure-functions': 'functions',
    'functionapp': 'functionapp',
    'appservice': 'appservice',
    'staticwebapp': 'staticwebapp',
    'static-web-apps': 'staticwebapp',
    'containerapp': 'containerapp',
    'containerapps': 'containerapps',
    'containerregistry': 'containerregistry',
    'storageaccount': 'storageaccount',
    'storage-account': 'storageaccount',
    'postgresflexibleserver': 'postgresflexibleserver',
    'postgres-flexible-server': 'postgresflexibleserver',
    'mysqlflexibleserver': 'mysqlflexibleserver',
    'sqldatabase': 'sqldatabase',
    'cosmosdb': 'cosmosdb',
    'rediscache': 'rediscache',
    'servicebus': 'servicebus',
    'azureopenai': 'azureopenai',
    'keyvault': 'keyvault',
    'applicationinsights': 'applicationinsights',
    'application-insights': 'applicationinsights',
    'loganalyticsworkspace': 'loganalyticsworkspace',
    'log-analytics': 'loganalyticsworkspace',
    'userassignedidentity': 'userassignedidentity',
    'user-assigned-identity': 'userassignedidentity',
};

/** Called only at the final deployment handoff, not when a view is opened or refreshed. */
export async function recordDeployArtifactsTelemetry(context: CopilotOnRailsContext, sourceFile: vscode.Uri): Promise<void> {
    const properties: Telemetry = {};
    for (const [file, prefix] of [
        ['prereq-output.json', 'prereqOutput'],
        ['prepare-plan.json', 'preparePlan'],
        ['scaffold-manifest.json', 'scaffoldManifest'],
        ['deploy-result.json', 'deployResult'],
    ] as const) {
        const uri = vscode.Uri.joinPath(sourceFile, '..', file);
        let content: string;
        try {
            content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        } catch (error) {
            if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
                properties[`${prefix}.readFailed`] = true;
            }
            continue;
        }
        const metrics = getDeployArtifactTelemetry(file, content);
        for (const [key, value] of Object.entries(metrics)) {
            properties[`${prefix}.${key}`] = value;
        }
    }
    if (properties['deployResult.status'] !== 'succeeded' && properties['deployResult.status'] !== 'failed') {
        return;
    }
    for (const [key, value] of Object.entries(properties)) {
        setCorProp(context, key, value);
    }
}

/** Select fields explicitly; never include artifact text or JSON parser errors in either sink. */
export function getDeployArtifactTelemetry(file: ArtifactFile, content: string): DeployArtifactTelemetry {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return { parsedOk: false };
    }
    if (!isJsonObject(parsed)) {
        return { parsedOk: false };
    }
    const data = parsed;

    let metrics: Omit<DeployArtifactTelemetry, 'parsedOk'>;
    switch (file) {
        case 'prereq-output.json': {
            const warnings = records(data.warnings);
            const build = object(data.buildRequirements);
            const components = records(data.components);
            metrics = {
                overallHealth: category(data.overallHealth, ['ready', 'readyWithCaveats', 'blocked']),
                fastTrackEligible: boolean(data.fastTrackEligible),
                componentCount: components?.length,
                componentArchitecture: serviceArchitecture(components),
                buildPassedCount: verdictCount(components, 'build', 'PASS'),
                buildFailedCount: verdictCount(components, 'build', 'FAIL'),
                deployabilityPassedCount: verdictCount(components, 'deployability', 'PASS'),
                deployabilityFailedCount: verdictCount(components, 'deployability', 'FAIL'),
                warningCount: warnings?.length,
                buildWarningCount: count(warnings, 'axis', 'build'),
                completenessWarningCount: count(warnings, 'axis', 'completeness'),
                deployabilityWarningCount: count(warnings, 'axis', 'deployability'),
                hasNativeModules: boolean(build?.hasNativeModules),
                hasDockerfile: boolean(build?.hasDockerfile),
                f1Viable: boolean(build?.f1Viable ?? data.f1Viable),
            };
            break;
        }
        case 'prepare-plan.json': {
            const services = records(data.services);
            const quotaValidation = object(data.quotaValidation);
            metrics = {
                serviceCount: services?.length,
                serviceTypes: serviceCategories(services?.map(service => service.kind ?? service.name)),
                serviceArchitecture: serviceArchitecture(services),
                iacFormat: category(data.iacFormat, ['bicep', 'terraform']),
                quotaStatus: category(quotaValidation?.status, ['verified', 'skipped', 'failed', 'unverified']),
                quotaVerified: boolean(quotaValidation?.verified),
                insufficientQuotaCount: count(records(data.quotas), 'sufficient', false),
                healingAttemptCount: records(data.healingAttempts)?.length,
            };
            break;
        }
        case 'scaffold-manifest.json': {
            const validation = object(data.validationResult);
            const checks = records(validation?.checks);
            const review = object(data.selfReview);
            const conformance = object(data.conformance);
            metrics = {
                iacFormat: category(data.iacFormat, ['bicep', 'terraform']),
                targetScope: category(data.targetScope, ['subscription', 'resourceGroup']),
                fileCount: records(data.files)?.length,
                validationStatus: category(validation?.status ?? validation?.bicepBuild, ['Validated', 'Partial', 'Failed', 'PASS', 'FAIL']),
                validationPassedCount: count(checks, 'passed', true),
                validationFailedCount: count(checks, 'passed', false),
                validationWarningCount: records(validation?.warnings)?.length,
                validationErrorCount: records(validation?.errors)?.length,
                conformancePassed: boolean(conformance?.passed),
                conformanceStatus: category(conformance?.status, ['PASS', 'PASS-INFERRED', 'FAIL']),
                flaggedFindingCount: count(records(review?.findings), 'rating', 'FLAGGED'),
                healingAttemptCount: records(review?.healingAttempts)?.length,
            };
            break;
        }
        case 'deploy-result.json': {
            const result = parseDeployResultJson(content);
            const endpoints = records(data.endpoints) || object(data.endpoints) ? result.endpoints : undefined;
            const created = records(data.createdResources);
            const resourceResults = records(data.resourceResults);
            const failedResources = mergeResourcesById(
                created?.filter(resource => category(resource.classification, ['failed']) === 'failed'),
                resourceResults?.filter(resource => category(resource.status, ['failed']) === 'failed'),
            );
            metrics = {
                status: data.status === undefined ? undefined : result.status,
                healthStatus: data.healthStatus === undefined ? undefined : result.healthStatus,
                partial: boolean(data.partial),
                durationSeconds: result.status === 'succeeded' || result.status === 'failed'
                    ? durationSeconds(result.startedUtc, result.completedUtc) : undefined,
                endpointCount: endpoints?.length,
                healthyEndpointCount: endpoints?.every(endpoint => endpoint.healthStatus !== undefined)
                    ? endpoints.filter(endpoint => endpoint.healthStatus === 'healthy').length : undefined,
                failedResourceCount: count(records(data.resourceResults), 'status', 'failed'),
                createdResourceCount: created?.length,
                orphanedResourceCount: count(created, 'classification', 'orphaned'),
                unverifiedResourceCount: count(created, 'classification', 'unverified'),
                inventoryUnverified: boolean(data.inventoryUnverified),
                healingAttemptCount: records(data.healingAttempts)?.length,
                createdResourceTypeCounts: aggregateArmResourceTypes(toInventoryResources(created)),
                failedResourceTypeCounts: aggregateArmResourceTypes(toInventoryResources(failedResources)),
                reusedResourceTypeCountsAvailable: false,
            };
            break;
        }
    }
    return { parsedOk: true, ...Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== undefined)) };
}

function mergeResourcesById(...groups: (JsonObject[] | undefined)[]): JsonObject[] {
    const mergedById = new Map<string, JsonObject>();
    const withoutIds: JsonObject[] = [];
    for (const resource of groups.flatMap(group => group ?? [])) {
        const id = token(resource.id ?? resource.resourceId);
        if (!id) {
            withoutIds.push(resource);
            continue;
        }
        const existing = mergedById.get(id);
        mergedById.set(id, existing ? mergeResourceFields(existing, resource) : resource);
    }
    return [...mergedById.values(), ...withoutIds];
}

function mergeResourceFields(first: JsonObject, second: JsonObject): JsonObject {
    return {
        ...first,
        ...second,
        ...(typeof first.id === 'string' ? { id: first.id } : {}),
        ...(typeof first.resourceId === 'string' ? { resourceId: first.resourceId } : {}),
        ...(typeof first.type === 'string' ? { type: first.type } : {}),
    };
}

function object(value: unknown): JsonObject | undefined {
    return isJsonObject(value) ? value : undefined;
}

function records(value: unknown): JsonObject[] | undefined {
    return Array.isArray(value) && value.every(item => object(item) !== undefined) ? value as JsonObject[] : undefined;
}

function count(items: JsonObject[] | undefined, field: string, value: string | boolean): number | undefined {
    return items?.filter(item => item[field] === value).length;
}

function boolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function nonnegativeNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function category(value: unknown, allowed: readonly string[]): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    return typeof value === 'string' ? allowed.find(item => item.toLowerCase() === value.toLowerCase()) ?? 'unknown' : 'unknown';
}

function serviceCategories(value: unknown): string | undefined {
    return Array.isArray(value) && value.every(item => typeof item === 'string')
        ? [...new Set(value.map(item => serviceTypes[item.toLowerCase()] ?? 'unknown'))].sort().join(',')
        : undefined;
}

function serviceArchitecture(services: JsonObject[] | undefined): string | undefined {
    if (!services) {
        return undefined;
    }
    const architecture = services.slice(0, 20).map((service) => {
        const type = architectureType(service.kind ?? service.type ?? service.azureService ?? service.name);
        return {
            role: architectureRole(service.role, type),
            type,
            runtime: architectureRuntime(service.runtime ?? service.language),
            framework: architectureFramework(service.framework),
        };
    });
    return JSON.stringify(architecture);
}

function architectureRole(value: unknown, type: string): string {
    const role = token(value);
    if (['frontend', 'backend', 'worker', 'api', 'database', 'shared'].includes(role)) {
        return role;
    }
    if (['spa', 'staticwebapp', 'web'].includes(type)) {
        return 'frontend';
    }
    if (['functions', 'functionapp', 'api', 'appservice', 'containerapp'].includes(type)) {
        return 'backend';
    }
    if (['postgresflexibleserver', 'mysqlflexibleserver', 'sqldatabase', 'cosmosdb', 'rediscache'].includes(type)) {
        return 'database';
    }
    if (type === 'library') {
        return 'shared';
    }
    return 'unknown';
}

function architectureType(value: unknown): string {
    const normalized = token(value).replace(/[\s_-]+/g, '');
    const known = serviceTypes[normalized] ?? serviceTypes[token(value)];
    if (known) {
        return known;
    }
    if (normalized === 'spa' || normalized === 'web' || normalized === 'api' || normalized === 'worker' || normalized === 'library') {
        return normalized;
    }
    return 'unknown';
}

function architectureRuntime(value: unknown): string {
    const runtime = token(value);
    if (/\bnode(?:\.js|js)?\b|typescript|javascript/.test(runtime)) {
        return 'node';
    }
    if (/python/.test(runtime)) {
        return 'python';
    }
    if (/\.net|dotnet|c#/.test(runtime)) {
        return 'dotnet';
    }
    if (/\bjava\b/.test(runtime)) {
        return 'java';
    }
    if (/\bgo\b|golang/.test(runtime)) {
        return 'go';
    }
    if (runtime === 'static') {
        return 'static';
    }
    return 'unknown';
}

function architectureFramework(value: unknown): string {
    const framework = token(value);
    const hasReact = /\breact\b/.test(framework);
    const hasVite = /\bvite\b/.test(framework);
    if (hasReact && hasVite) {
        return 'react-vite';
    }
    if (hasReact) {
        return 'react';
    }
    if (/\bnext(?:\.js|js)?\b/.test(framework)) {
        return 'nextjs';
    }
    if (/\bvue\b/.test(framework)) {
        return 'vue';
    }
    if (/\bsvelte\b/.test(framework)) {
        return 'svelte';
    }
    if (/angular/.test(framework)) {
        return 'angular';
    }
    if (/azure\/functions|azure functions/.test(framework)) {
        return 'azure-functions';
    }
    if (/\bexpress\b/.test(framework)) {
        return 'express';
    }
    if (/\bfastify\b/.test(framework)) {
        return 'fastify';
    }
    if (/\bfastapi\b/.test(framework)) {
        return 'fastapi';
    }
    if (/\bdjango\b/.test(framework)) {
        return 'django';
    }
    if (/\bflask\b/.test(framework)) {
        return 'flask';
    }
    if (/asp\.?net/.test(framework)) {
        return 'aspnetcore';
    }
    if (/\bspring\b/.test(framework)) {
        return 'spring';
    }
    return 'unknown';
}

function verdictCount(components: JsonObject[] | undefined, axis: string, expected: string): number | undefined {
    if (!components) {
        return undefined;
    }
    return components.filter((component) => {
        const verdicts = object(component.verdicts);
        const verdict = object(verdicts?.[axis]);
        return category(verdict?.status, ['PASS', 'WARN', 'FAIL']) === expected;
    }).length;
}

function toInventoryResources(resources: JsonObject[] | undefined): { id: string; type?: string }[] {
    return resources?.map((resource) => ({
        id: typeof resource.id === 'string'
            ? resource.id
            : typeof resource.resourceId === 'string'
                ? resource.resourceId
                : '',
        ...(typeof resource.type === 'string' ? { type: resource.type } : {}),
    })) ?? [];
}

function token(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function durationSeconds(startedUtc: string, completedUtc: string): number | undefined {
    const start = utcTimestamp(startedUtc);
    const end = utcTimestamp(completedUtc);
    return start !== undefined && end !== undefined ? nonnegativeNumber((end - start) / 1000) : undefined;
}

function utcTimestamp(value: unknown): number | undefined {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
        return undefined;
    }
    const milliseconds = Date.parse(value);
    const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
    return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === normalized ? milliseconds : undefined;
}

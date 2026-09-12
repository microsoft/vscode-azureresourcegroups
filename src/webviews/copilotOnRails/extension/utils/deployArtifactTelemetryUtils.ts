/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CopilotOnRailsContext } from '../../../../utils/copilotOnRails/CopilotOnRailsContext';
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
            metrics = {
                overallHealth: category(data.overallHealth, ['ready', 'readyWithCaveats', 'blocked']),
                fastTrackEligible: boolean(data.fastTrackEligible),
                componentCount: records(data.components)?.length,
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
            };
            break;
        }
    }
    return { parsedOk: true, ...Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== undefined)) };
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

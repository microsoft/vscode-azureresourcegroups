/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tier 2 deployment evidence: once `azd up` reports success, does the deployed application
 * actually serve traffic? A resource inventory only proves Azure created things, so the
 * deployed endpoint has to be captured and probed before a run may claim a user outcome.
 */

export type DeployedAcceptanceFailureCode =
    | 'noDeployedEndpoint'
    | 'endpointUnreachable'
    | 'endpointUnhealthy'
    | 'deployedProbeRunnerError';

export interface DeployedEndpoint {
    service: string;
    url: string;
}

export interface DeployedProbeResult {
    endpoint: DeployedEndpoint;
    attempts: number;
    status?: number;
    durationMs: number;
    healthy: boolean;
    error?: string;
}

export interface DeployedAcceptanceResult {
    outcome: 'passed' | 'failed';
    failureCode?: DeployedAcceptanceFailureCode;
    error?: string;
    endpoints: DeployedEndpoint[];
    probes: DeployedProbeResult[];
}

export type HttpProbe = (url: string, timeoutMs: number) => Promise<{ status: number }>;

export interface DeployedAcceptanceOptions {
    /** Raw stdout of `azd show -o json`. */
    azdShowOutput: string;
    probe: HttpProbe;
    /** Container apps cold-start after provisioning, so a single probe is not conclusive. */
    maxAttempts?: number;
    retryDelayMs?: number;
    probeTimeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
}

const defaultMaxAttempts = 10;
const defaultRetryDelayMs = 10_000;
const defaultProbeTimeoutMs = 30_000;

export function createAzdShowCommand(): string {
    return 'azd show -o json';
}

/**
 * `azd show` reports one or more endpoints per service. Ingress-enabled services expose an
 * https URL; jobs and workers legitimately expose none.
 */
export function parseDeployedEndpoints(azdShowOutput: string): DeployedEndpoint[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(azdShowOutput);
    } catch {
        return [];
    }
    const services = (parsed as { services?: Record<string, unknown> } | null)?.services;
    if (!services || typeof services !== 'object') {
        return [];
    }
    const endpoints: DeployedEndpoint[] = [];
    for (const [service, value] of Object.entries(services)) {
        const seen = new Set<string>();
        for (const url of collectServiceUrls(value)) {
            const normalized = url.replace(/\/+$/, '');
            if (!seen.has(normalized)) {
                seen.add(normalized);
                endpoints.push({ service, url });
            }
        }
    }
    return endpoints;
}

/**
 * azd reports the deployed URL as `ingressUrl`, and still emits the historical misspelling
 * `ingresUrl` alongside it. Older templates instead expose an `endpoints` array, so all
 * three shapes are read and de-duplicated.
 */
function collectServiceUrls(value: unknown): string[] {
    const service = value as { ingressUrl?: unknown; ingresUrl?: unknown; endpoints?: unknown } | null;
    if (!service || typeof service !== 'object') {
        return [];
    }
    const candidates: unknown[] = [
        service.ingressUrl,
        service.ingresUrl,
        ...(Array.isArray(service.endpoints) ? service.endpoints : []),
    ];
    return candidates.filter((entry): entry is string => typeof entry === 'string' && /^https?:\/\//i.test(entry));
}

export async function evaluateDeployedAcceptance(
    options: DeployedAcceptanceOptions,
): Promise<DeployedAcceptanceResult> {
    const endpoints = parseDeployedEndpoints(options.azdShowOutput);
    if (endpoints.length === 0) {
        return {
            outcome: 'failed',
            failureCode: 'noDeployedEndpoint',
            error: 'azd reported no HTTP endpoint, so the deployed application cannot be verified.',
            endpoints,
            probes: [],
        };
    }

    const probes: DeployedProbeResult[] = [];
    for (const endpoint of endpoints) {
        probes.push(await probeUntilHealthy(endpoint, options));
    }

    const unhealthy = probes.find(probe => !probe.healthy);
    if (unhealthy) {
        return {
            outcome: 'failed',
            failureCode: classifyProbeFailure(unhealthy),
            error: `${unhealthy.endpoint.service} at ${unhealthy.endpoint.url}: ${unhealthy.error ?? `status ${unhealthy.status}`}`,
            endpoints,
            probes,
        };
    }

    return { outcome: 'passed', endpoints, probes };
}

function classifyProbeFailure(probe: DeployedProbeResult): DeployedAcceptanceFailureCode {
    return probe.status === undefined ? 'endpointUnreachable' : 'endpointUnhealthy';
}

async function probeUntilHealthy(
    endpoint: DeployedEndpoint,
    options: DeployedAcceptanceOptions,
): Promise<DeployedProbeResult> {
    const maxAttempts = options.maxAttempts ?? defaultMaxAttempts;
    const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
    const probeTimeoutMs = options.probeTimeoutMs ?? defaultProbeTimeoutMs;
    const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    const started = Date.now();

    let status: number | undefined;
    let error: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await options.probe(endpoint.url, probeTimeoutMs);
            status = response.status;
            error = undefined;
            if (status >= 200 && status < 400) {
                return { endpoint, attempts: attempt, status, durationMs: Date.now() - started, healthy: true };
            }
            // A 5xx during cold start is common; a 4xx is a settled answer and not worth retrying.
            if (status < 500) {
                return {
                    endpoint,
                    attempts: attempt,
                    status,
                    durationMs: Date.now() - started,
                    healthy: false,
                    error: `endpoint returned ${status}`,
                };
            }
        } catch (probeError) {
            status = undefined;
            error = probeError instanceof Error ? probeError.message : String(probeError);
        }
        if (attempt < maxAttempts) {
            await sleep(retryDelayMs);
        }
    }

    return {
        endpoint,
        attempts: maxAttempts,
        status,
        durationMs: Date.now() - started,
        healthy: false,
        error: error ?? `endpoint returned ${status}`,
    };
}

/**
 * Azure quota, capacity, and regional failures describe the cloud's weather rather than the
 * generated project, and must be excluded from the product success rate.
 */
export function isAzureInfrastructureFailure(output: string): boolean {
    return azureInfrastructurePatterns.some(pattern => pattern.test(output));
}

/**
 * Observed in a real run: eastus2 returned `AKSCapacityHeavyUsage` while provisioning a
 * container apps managed environment. Patterns are kept explicit so each one can be traced
 * to a failure that actually occurred rather than to a guess.
 */
const azureInfrastructurePatterns: RegExp[] = [
    /QuotaExceeded|SubscriptionQuota|InsufficientQuota|OperationNotAllowed.*quota/i,
    /AllocationFailed|ZonalAllocationFailed/i,
    /SkuNotAvailable|NotAvailableForSubscription/i,
    /ServiceUnavailable|InternalServerError|TooManyRequests|RequestTimeout/i,
    /CapacityHeavyUsage|ManagedEnvironmentCapacity|heavy usage in region|is experiencing heavy usage/i,
    /RegionCapacity|SubscriptionNotRegistered|ResourceProvisioningTimedOut/i,
];

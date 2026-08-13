/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    Grader,
    GraderInput,
    GraderMetadata,
    GraderRegistry,
    GraderResult,
    Trajectory,
} from '@microsoft/vally';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const AUTHORITATIVE_SCHEMA = 'copilot-on-rails-authoritative-validation/v1';
export const CUSTOM_METRICS_SCHEMA = 'copilot-on-rails-authoritative-metrics/v1';

export const GATE_GROUPS = {
    product: ['planning', 'scaffold', 'build', 'test', 'integration'],
    runtime: ['local-runtime', 'browser', 'browser-journey', 'accessibility', 'persistence', 'worker', 'debugger'],
    operations: ['deployment', 'security', 'cleanup'],
    identity: ['model', 'provenance'],
} satisfies Record<string, readonly string[]>;

type GateName = typeof GATE_GROUPS[keyof typeof GATE_GROUPS][number];
type EvidenceTier = 'ordinary' | 'deployment-authorized';

interface ArtifactIdentity {
    scenarioId: string;
    model: string;
    arm: string;
    endpoint: string;
    runId: string;
}

interface ArtifactProvenance {
    scenarioId: string;
    candidateCommit: string;
    agentAssetsHash: string;
    evaluationDefinitionHash: string;
    scenarioHash: string;
    promptSource: string;
    model: string;
    arm: string;
    endpoint: string;
    runId: string;
    raw: JsonObject;
}

interface GateEvidence {
    status: 'passed' | 'failed' | 'not-applicable';
    evidence?: string[];
    reason?: string;
}

interface ArtifactDocument {
    identity: ArtifactIdentity;
    provenance: ArtifactProvenance;
    applicability: Record<GateName, boolean>;
    gates: Partial<Record<GateName, GateEvidence>>;
    diagnosticSummary?: string;
    values?: JsonObject;
}

interface GraderConfig {
    validationPath: string;
    metricsPath: string;
    requiredGates: ReadonlySet<GateName>;
    evidenceTier: EvidenceTier;
}

interface ArtifactRoot {
    root: string;
    source: string;
}

interface LoadFailure {
    ok: false;
    evidence: string;
}

interface LoadSuccess {
    ok: true;
    value: unknown;
}

type LoadResult = LoadFailure | LoadSuccess;
type JsonObject = Record<string, unknown>;

const ALL_GATES: readonly GateName[] = Object.values(GATE_GROUPS).flat();
const DEFAULT_VALIDATION_PATH = 'cor-validation.json';
const DEFAULT_METRICS_PATH = 'custom_metrics.json';

export class CorAuthoritativeGrader implements Grader {
    public readonly metadata: GraderMetadata = {
        name: 'cor-authoritative',
        description: 'Fail-closed validation of executor-owned Copilot on Rails artifact files',
        behavior: { requiresWorkspace: false },
        determinism: 'static',
        reference: 'reference-free',
        temporalScope: 'trajectory-level',
        costProfile: 'low',
    };

    public async grade(input: GraderInput): Promise<GraderResult> {
        const trajectory = input.trajectory;
        if (!trajectory) {
            return failure('Missing trajectory', []);
        }

        const config = normalizeConfig(input.config);
        const selected = await selectArtifactRoot(trajectory);
        if ('evidence' in selected) {
            return failure(selected.evidence, gateDetails(config.requiredGates, selected.evidence));
        }

        const [validationLoad, metricsLoad] = await Promise.all([
            loadJson(selected.root, config.validationPath),
            loadJson(selected.root, config.metricsPath),
        ]);
        if (!validationLoad.ok || !metricsLoad.ok) {
            const evidence = [validationLoad, metricsLoad]
                .filter((result): result is LoadFailure => !result.ok)
                .map(result => result.evidence)
                .join('; ');
            return failure(`${evidence} (${selected.source})`, gateDetails(config.requiredGates, evidence));
        }

        const validation = parseDocument(validationLoad.value, AUTHORITATIVE_SCHEMA, 'validation', false);
        const metrics = parseDocument(metricsLoad.value, CUSTOM_METRICS_SCHEMA, 'custom metrics', true);
        if ('errors' in validation || 'errors' in metrics) {
            const errors: string[] = [];
            if ('errors' in validation) {
                errors.push(...validation.errors);
            }
            if ('errors' in metrics) {
                errors.push(...metrics.errors);
            }
            const evidence = errors.join('; ');
            return failure(evidence, gateDetails(config.requiredGates, evidence));
        }

        const identityErrors = validateIdentity(validation.value.identity, metrics.value.identity, trajectory);
        const provenanceErrors = validateProvenance(
            validation.value.provenance,
            metrics.value.provenance,
            validation.value.identity,
            trajectory,
        );
        const applicabilityErrors = validateApplicability(
            validation.value.applicability,
            metrics.value.applicability,
            config,
            validation.value.identity.endpoint,
        );
        const identityDetail = detail(
            'model',
            identityErrors.filter(error => error.startsWith('model:')),
            'Requested and observed model identity matches the artifact and trajectory.',
        );
        const provenanceDetail = detail(
            'provenance',
            [
                ...identityErrors.filter(error => !error.startsWith('model:')),
                ...provenanceErrors,
                ...applicabilityErrors,
            ],
            'Artifact and trajectory identity, provenance, and applicability match exactly.',
        );

        const details: GraderResult[] = [];
        for (const [groupName, groupGates] of Object.entries(GATE_GROUPS)) {
            const children = groupGates.map(gate => {
                if (gate === 'model') {
                    return identityDetail;
                }
                if (gate === 'provenance') {
                    return provenanceDetail;
                }
                return validateGate(
                    gate,
                    config.requiredGates.has(gate),
                    validation.value.gates[gate],
                    metrics.value,
                );
            });
            details.push(groupDetail(groupName, children));
        }

        const metricsHardGate = metrics.value.values?.authoritative_hard_gates_passed;
        if (metricsHardGate !== true) {
            details.push(detail(
                'authoritative-hard-gates',
                ['custom metrics authoritative_hard_gates_passed must be true'],
                '',
            ));
        }
        const passed = details.every(result => result.passed) && metricsHardGate === true;
        const failedGate = details
            .flatMap(result => result.details ?? [])
            .find(result => !result.passed);
        return {
            name: this.metadata.name,
            kind: 'code',
            passed,
            score: passed ? 1 : 0,
            label: passed ? 'correct' : 'incorrect',
            evidence: passed
                ? `All applicable Copilot on Rails authoritative gates passed (${selected.source})`
                : `${validation.value.diagnosticSummary ?? (
                    `${failedGate?.name ?? 'authoritative evidence'}: `
                    + `${failedGate?.evidence ?? 'authoritative hard-gate evidence failed closed'}.`
                )} `
                    + `Full diagnosis: ${path.resolve(selected.root, 'reports', 'run-diagnostics.md')}`,
            details,
            metadata: {
                hardGate: true,
                hardGateNormalized: true,
                artifactSource: selected.source,
                evidenceTier: config.evidenceTier,
                schema: AUTHORITATIVE_SCHEMA,
            },
        };
    }
}

export function registerGraders(registry: GraderRegistry): void {
    registry.register(new CorAuthoritativeGrader());
}

function normalizeConfig(raw: Record<string, unknown> | undefined): GraderConfig {
    const config: JsonObject = raw ?? {};
    const validationPath = confinedRelativePath(config.validationPath, DEFAULT_VALIDATION_PATH);
    const metricsPath = confinedRelativePath(config.metricsPath, DEFAULT_METRICS_PATH);
    const required = config.requiredGates;
    if (!Array.isArray(required) || required.length === 0
        || required.some(gate => !isGateName(gate))) {
        throw new Error(`cor-authoritative config.requiredGates must be a non-empty subset of: ${ALL_GATES.join(', ')}`);
    }
    const evidenceTier = config.evidenceTier === 'deployment-authorized'
        ? 'deployment-authorized'
        : 'ordinary';
    if (required.includes('deployment') && evidenceTier !== 'deployment-authorized') {
        throw new Error('The deployment gate requires evidenceTier: deployment-authorized.');
    }
    return {
        validationPath,
        metricsPath,
        requiredGates: new Set<GateName>([...required, 'model', 'provenance']),
        evidenceTier,
    };
}

function isGateName(value: unknown): value is GateName {
    return typeof value === 'string' && ALL_GATES.some(gate => gate === value);
}

async function selectArtifactRoot(
    trajectory: Trajectory,
): Promise<ArtifactRoot | LoadFailure> {
    if (!trajectory.artifactDir) {
        return { ok: false, evidence: 'trajectory.artifactDir is required for executor-owned evidence' };
    }

    return {
        root: trajectory.artifactDir,
        source: trajectory.artifactDirStrict === true ? 'strict artifact dir' : 'executor artifact dir',
    };
}

async function loadJson(root: string, relativePath: string): Promise<LoadResult> {
    let raw: string;
    try {
        raw = await readFile(path.join(root, relativePath), 'utf8');
    } catch (error: unknown) {
        const code = errorCode(error);
        return {
            ok: false,
            evidence: `${relativePath} could not be read${code ? ` (${code})` : ''}`,
        };
    }
    try {
        const value: unknown = JSON.parse(raw);
        return { ok: true, value };
    } catch {
        return { ok: false, evidence: `${relativePath} is malformed JSON` };
    }
}

function errorCode(error: unknown): string | undefined {
    return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

type ParsedDocument =
    | { ok: true; value: ArtifactDocument }
    | { ok: false; errors: string[] };

function parseDocument(
    value: unknown,
    schema: string,
    label: string,
    requireValues: boolean,
): ParsedDocument {
    const errors: string[] = [];
    if (!isRecord(value)) {
        return { ok: false, errors: [`${label} artifact must be a JSON object`] };
    }
    if (value.schema !== schema) {
        errors.push(`${label} artifact schema must be ${schema}`);
    }
    if (value.schemaVersion !== 1) {
        errors.push(`${label} artifact schemaVersion must be 1`);
    }
    const identity = parseIdentity(value.identity, label, errors);
    const provenance = parseProvenance(value.provenance, label, errors);
    const applicability = parseApplicability(value.applicability, label, errors);
    const gates = parseGates(value.gates, label, errors);
    const diagnosticSummary = value.diagnosticSummary;
    if (diagnosticSummary !== undefined && typeof diagnosticSummary !== 'string') {
        errors.push(`${label} artifact diagnosticSummary must be a string`);
    }
    const values = value.values;
    if (requireValues && !isRecord(values)) {
        errors.push(`${label} artifact values must be an object`);
    }
    if (errors.length > 0 || !identity || !provenance || !applicability || !gates) {
        return { ok: false, errors };
    }
    return {
        ok: true,
        value: {
            identity,
            provenance,
            applicability,
            gates,
            ...(typeof diagnosticSummary === 'string' ? { diagnosticSummary } : {}),
            ...(isRecord(values) ? { values } : {}),
        },
    };
}

function parseIdentity(
    value: unknown,
    label: string,
    errors: string[],
): ArtifactIdentity | undefined {
    if (!isRecord(value)) {
        errors.push(`${label} artifact identity must be an object`);
        return undefined;
    }
    if (!requireStrings(
        value,
        ['scenarioId', 'model', 'arm', 'endpoint', 'runId'],
        `${label} identity`,
        errors,
    )) {
        return undefined;
    }
    return {
        scenarioId: value.scenarioId,
        model: value.model,
        arm: value.arm,
        endpoint: value.endpoint,
        runId: value.runId,
    };
}

function parseProvenance(
    value: unknown,
    label: string,
    errors: string[],
): ArtifactProvenance | undefined {
    if (!isRecord(value)) {
        errors.push(`${label} artifact provenance must be an object`);
        return undefined;
    }
    if (!requireStrings(
        value,
        [
            'scenarioId',
            'candidateCommit',
            'agentAssetsHash',
            'evaluationDefinitionHash',
            'scenarioHash',
            'promptSource',
            'model',
            'arm',
            'endpoint',
            'runId',
        ],
        `${label} provenance`,
        errors,
    )) {
        return undefined;
    }
    return {
        scenarioId: value.scenarioId,
        candidateCommit: value.candidateCommit,
        agentAssetsHash: value.agentAssetsHash,
        evaluationDefinitionHash: value.evaluationDefinitionHash,
        scenarioHash: value.scenarioHash,
        promptSource: value.promptSource,
        model: value.model,
        arm: value.arm,
        endpoint: value.endpoint,
        runId: value.runId,
        raw: value,
    };
}

function requireStrings<const Keys extends readonly string[]>(
    value: JsonObject,
    fields: Keys,
    label: string,
    errors: string[],
): value is JsonObject & { [Key in Keys[number]]: string } {
    let valid = true;
    for (const field of fields) {
        const candidate = value[field];
        if (typeof candidate !== 'string' || candidate.length === 0) {
            errors.push(`${label} ${field} must be a non-empty string`);
            valid = false;
        }
    }
    return valid;
}

function parseApplicability(
    value: unknown,
    label: string,
    errors: string[],
): Record<GateName, boolean> | undefined {
    if (!isRecord(value)) {
        errors.push(`${label} artifact applicability must be an object`);
        return undefined;
    }
    const parsed: Partial<Record<GateName, boolean>> = {};
    for (const gate of ALL_GATES) {
        if (typeof value[gate] !== 'boolean') {
            errors.push(`${label} applicability ${gate} must be boolean`);
        } else {
            parsed[gate] = value[gate];
        }
    }
    if (errors.some(error => error.startsWith(`${label} applicability`))) {
        return undefined;
    }
    return completeApplicability(parsed);
}

function completeApplicability(
    value: Partial<Record<GateName, boolean>>,
): Record<GateName, boolean> {
    return {
        planning: value.planning === true,
        scaffold: value.scaffold === true,
        build: value.build === true,
        test: value.test === true,
        integration: value.integration === true,
        'local-runtime': value['local-runtime'] === true,
        browser: value.browser === true,
        'browser-journey': value['browser-journey'] === true,
        accessibility: value.accessibility === true,
        persistence: value.persistence === true,
        worker: value.worker === true,
        debugger: value.debugger === true,
        deployment: value.deployment === true,
        security: value.security === true,
        cleanup: value.cleanup === true,
        model: value.model === true,
        provenance: value.provenance === true,
    };
}

function parseGates(
    value: unknown,
    label: string,
    errors: string[],
): Partial<Record<GateName, GateEvidence>> | undefined {
    if (!isRecord(value)) {
        errors.push(`${label} artifact gates must be an object`);
        return undefined;
    }
    const parsed: Partial<Record<GateName, GateEvidence>> = {};
    for (const gate of ALL_GATES) {
        const candidate = value[gate];
        if (!isRecord(candidate)) {
            errors.push(`${label} gate ${gate} must be an object`);
            continue;
        }
        const status = candidate.status;
        if (status !== 'passed' && status !== 'failed' && status !== 'not-applicable') {
            errors.push(`${label} gate ${gate} has an invalid status`);
            continue;
        }
        const evidence = candidate.evidence;
        if (evidence !== undefined
            && (!Array.isArray(evidence) || evidence.some(item => typeof item !== 'string'))) {
            errors.push(`${label} gate ${gate} evidence must be a string array`);
            continue;
        }
        const reason = candidate.reason;
        if (reason !== undefined && typeof reason !== 'string') {
            errors.push(`${label} gate ${gate} reason must be a string`);
            continue;
        }
        parsed[gate] = {
            status,
            ...(Array.isArray(evidence) ? { evidence: evidence.filter(isString) } : {}),
            ...(typeof reason === 'string' ? { reason } : {}),
        };
    }
    return parsed;
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

function validateIdentity(
    validationIdentity: ArtifactIdentity,
    metricsIdentity: ArtifactIdentity,
    trajectory: Trajectory,
): string[] {
    const errors: string[] = [];
    const expected = trajectoryIdentity(trajectory, errors);
    if (!expected) {
        return errors;
    }
    for (const key of identityKeys()) {
        if (validationIdentity[key] !== expected[key]) {
            errors.push(`${key === 'model' ? 'model: ' : ''}validation identity ${key} does not match trajectory`);
        }
        if (metricsIdentity[key] !== expected[key]) {
            errors.push(`${key === 'model' ? 'model: ' : ''}custom metrics identity ${key} does not match trajectory`);
        }
    }
    return errors;
}

function trajectoryIdentity(
    trajectory: Trajectory,
    errors: string[],
): ArtifactIdentity | undefined {
    const env = trajectory.stimulus.environment?.env ?? {};
    const tags = trajectory.stimulus.tags ?? {};
    const metadata: unknown = trajectory.metadata;
    const metadataRecord = isRecord(metadata) ? metadata : {};
    const sources = {
        scenarioId: env.COR_EVAL_SCENARIO_ID,
        model: env.COR_EVAL_MODEL,
        arm: env.COR_EVAL_ARM,
        endpoint: env.COR_EVAL_ENDPOINT,
        runId: trajectory.metadata.sessionID,
    };
    let valid = true;
    for (const key of identityKeys()) {
        if (typeof sources[key] !== 'string' || sources[key].length === 0) {
            errors.push(`${key === 'model' ? 'model: ' : ''}trajectory canonical ${key} is missing`);
            valid = false;
        }
    }
    if (!valid) {
        return undefined;
    }
    const expected: ArtifactIdentity = {
        scenarioId: sources.scenarioId,
        model: sources.model,
        arm: sources.arm,
        endpoint: sources.endpoint,
        runId: sources.runId,
    };
    validateOptionalIdentitySource(tags, expected, errors, 'stimulus tags');
    validateOptionalIdentitySource({
        scenarioId: metadataRecord.scenarioId,
        model: metadataRecord.model,
        arm: metadataRecord.evaluationArm,
        endpoint: metadataRecord.endpoint,
        runId: metadataRecord.runId ?? metadataRecord.sessionID,
    }, expected, errors, 'trajectory metadata');

    if (metadataRecord.requestedModel !== expected.model) {
        errors.push('model: trajectory requestedModel must match COR_EVAL_MODEL');
    }
    const observedModels = metadataRecord.observedModels;
    if (!Array.isArray(observedModels) || observedModels.length === 0
        || observedModels.some(model => model !== expected.model)) {
        errors.push('model: every observed trajectory model must match COR_EVAL_MODEL');
    }
    return expected;
}

function identityKeys(): readonly (keyof ArtifactIdentity)[] {
    return ['scenarioId', 'model', 'arm', 'endpoint', 'runId'];
}

function validateOptionalIdentitySource(
    source: JsonObject,
    expected: ArtifactIdentity,
    errors: string[],
    label: string,
): void {
    for (const key of identityKeys()) {
        const value = source[key];
        if (value !== undefined && value !== expected[key]) {
            errors.push(`${key === 'model' ? 'model: ' : ''}${label} ${key} does not match canonical identity`);
        }
    }
}

function validateProvenance(
    validationProvenance: ArtifactProvenance,
    metricsProvenance: ArtifactProvenance,
    identity: ArtifactIdentity,
    trajectory: Trajectory,
): string[] {
    const errors: string[] = [];
    if (stableJson(validationProvenance.raw) !== stableJson(metricsProvenance.raw)) {
        errors.push('validation and custom metrics provenance must match exactly');
    }
    for (const key of identityKeys()) {
        if (validationProvenance[key] !== identity[key]) {
            errors.push(`provenance ${key} does not match run identity`);
        }
    }

    const metadata: unknown = trajectory.metadata;
    const metadataRecord = isRecord(metadata) ? metadata : {};
    const evaluationDefinition = isRecord(metadataRecord.evaluationDefinition)
        ? metadataRecord.evaluationDefinition
        : {};
    const sourceProvenance = isRecord(metadataRecord.sourceProvenance)
        ? metadataRecord.sourceProvenance
        : {};
    const trajectoryProvenance: JsonObject = {
        candidateCommit: metadataRecord.candidateCommit,
        agentAssetsHash: metadataRecord.agentAssetsHash,
        evaluationDefinitionHash:
            metadataRecord.evaluationDefinitionHash ?? evaluationDefinition.combinedHash,
        scenarioHash: metadataRecord.scenarioHash ?? evaluationDefinition.scenarioCorpusHash,
        promptSource: metadataRecord.promptSource ?? sourceProvenance.promptSource,
    };
    for (const field of [
        'candidateCommit',
        'agentAssetsHash',
        'evaluationDefinitionHash',
        'scenarioHash',
        'promptSource',
    ] as const) {
        if (trajectoryProvenance[field] !== validationProvenance[field]) {
            errors.push(`trajectory provenance ${field} does not match artifact provenance`);
        }
    }
    return errors;
}

function validateApplicability(
    validationApplicability: Record<GateName, boolean>,
    metricsApplicability: Record<GateName, boolean>,
    config: GraderConfig,
    endpoint: string,
): string[] {
    const errors: string[] = [];
    if (endpoint === 'local'
        && config.requiredGates.has('deployment')
        && config.evidenceTier !== 'deployment-authorized') {
        errors.push('ordinary local trials cannot require deployment evidence');
    }
    if (config.evidenceTier === 'deployment-authorized' && !config.requiredGates.has('deployment')) {
        errors.push('deployment-authorized evidence tier must require the deployment gate');
    }
    for (const gate of ALL_GATES) {
        const expected = config.requiredGates.has(gate);
        if (validationApplicability[gate] !== expected) {
            errors.push(`validation applicability for ${gate} must be ${expected}`);
        }
        if (metricsApplicability[gate] !== expected) {
            errors.push(`custom metrics applicability for ${gate} must be ${expected}`);
        }
    }
    return errors;
}

function validateGate(
    name: GateName,
    required: boolean,
    gateEvidence: GateEvidence | undefined,
    metrics: ArtifactDocument,
): GraderResult {
    if (!required) {
        const errors: string[] = [];
        if (!gateEvidence || gateEvidence.status !== 'not-applicable') {
            errors.push(`${name} must be explicitly not-applicable`);
        }
        const metricPrefix = metricName(name);
        if (metrics.values?.[`${metricPrefix}_applicable`] !== false
            || metrics.values?.[`${metricPrefix}_status`] !== 'not-applicable'
            || metrics.values?.[`${metricPrefix}_success`] !== null) {
            errors.push(`${name} custom metrics must explicitly encode non-applicability`);
        }
        return detail(name, errors, `${name} is explicitly not applicable.`);
    }

    const errors: string[] = [];
    if (!gateEvidence) {
        errors.push(`${name} evidence is missing`);
    } else {
        if (gateEvidence.status !== 'passed') {
            errors.push(
                gateEvidence.status === 'failed'
                    ? (
                        gateEvidence.reason
                        ?? gateEvidence.evidence?.[0]
                        ?? `${name} required evidence status must be passed`
                    )
                    : `${name} required evidence status must be passed`,
            );
        }
        if (!gateEvidence.evidence || gateEvidence.evidence.length === 0
            || gateEvidence.evidence.some(item => item.length === 0)) {
            errors.push(`${name} required evidence must contain at least one non-empty artifact reference`);
        }
    }
    const metricPrefix = metricName(name);
    if (metrics.values?.[`${metricPrefix}_applicable`] !== true
        || metrics.values?.[`${metricPrefix}_status`] !== 'passed'
        || metrics.values?.[`${metricPrefix}_success`] !== true) {
        errors.push(`${name} custom metrics must confirm applicable, passed, and success`);
    }
    return detail(name, errors, `${name} authoritative evidence passed.`);
}

function metricName(gate: GateName): string {
    return gate.replaceAll('-', '_');
}

function groupDetail(name: string, children: GraderResult[]): GraderResult {
    const passed = children.every(child => child.passed);
    return {
        name,
        kind: 'code',
        passed,
        score: passed ? 1 : 0,
        label: passed ? 'correct' : 'incorrect',
        evidence: passed ? `${name} gates passed` : `${name} contains a hard-gate failure`,
        details: children,
    };
}

function detail(name: string, errors: string[], passedEvidence: string): GraderResult {
    const passed = errors.length === 0;
    return {
        name,
        kind: 'code',
        passed,
        score: passed ? 1 : 0,
        label: passed ? 'correct' : 'incorrect',
        evidence: passed ? passedEvidence : errors.join('; '),
    };
}

function gateDetails(requiredGates: ReadonlySet<GateName>, evidence: string): GraderResult[] {
    return Object.entries(GATE_GROUPS).map(([name, gates]) => groupDetail(
        name,
        gates.map(gate => detail(
            gate,
            requiredGates.has(gate) ? [evidence] : [],
            `${gate} is not applicable.`,
        )),
    ));
}

function failure(evidence: string, details: GraderResult[]): GraderResult {
    return {
        name: 'cor-authoritative',
        kind: 'code',
        passed: false,
        score: 0,
        label: 'incorrect',
        evidence,
        details,
        metadata: {
            hardGate: true,
            hardGateNormalized: true,
        },
    };
}

function confinedRelativePath(value: unknown, fallback: string): string {
    const candidate = value === undefined ? fallback : value;
    if (typeof candidate !== 'string' || candidate.trim().length === 0
        || path.isAbsolute(candidate) || candidate.split(/[\\/]/u).includes('..')) {
        throw new Error('cor-authoritative artifact paths must be non-empty relative paths without parent traversal');
    }
    return candidate.trim();
}

function isRecord(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(',')}]`;
    }
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
}

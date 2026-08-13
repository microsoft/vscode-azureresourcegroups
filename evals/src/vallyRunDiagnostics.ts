/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import type { AttemptEvidence } from './vally';

export const VALLY_RUN_DIAGNOSTICS_SCHEMA = 'copilot-on-rails-run-diagnostics/v1';

type AuthoritativeStatus = 'passed' | 'failed' | 'not-applicable';
type DiagnosticStatus = AuthoritativeStatus | 'not-attempted';

export interface DiagnosticGateInput {
    status: AuthoritativeStatus;
    evidence?: string[];
    reason?: string;
}

export interface DiagnosticCommand {
    name?: string;
    command?: string;
    workingDirectory?: string;
    exitCode?: number;
    stdoutExcerpt?: string;
    stderrExcerpt?: string;
}

export interface VallyRunDiagnosticGate {
    gate: string;
    authoritativeStatus: AuthoritativeStatus;
    diagnosticStatus: DiagnosticStatus;
    explanation: string;
}

export interface VallyRunDiagnostics {
    schema: typeof VALLY_RUN_DIAGNOSTICS_SCHEMA;
    schemaVersion: 1;
    runId: string;
    scenarioId: string;
    outcome: AttemptEvidence['outcome'];
    summary: string;
    primaryFailure?: {
        stage: string;
        code: string;
        category?: string;
        error: string;
        observedIssue: string;
    };
    failedCommand?: DiagnosticCommand;
    repairs: {
        used: number;
        maximum: number;
        exhausted: boolean;
    };
    gates: VallyRunDiagnosticGate[];
    recommendedActions: string[];
    evidenceFiles: string[];
}

interface CommandEvidence {
    name?: string;
    command?: string;
    ecosystem?: string;
    relativeDirectory?: string;
    cwd?: string;
    success?: boolean;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
}

export function createVallyRunDiagnostics(
    attempt: AttemptEvidence,
    gates: Record<string, DiagnosticGateInput>,
    maximumRepairs = 2,
): VallyRunDiagnostics {
    const failedCommand = findFailedCommand(attempt);
    const primaryFailure = attempt.outcome === 'failed'
        ? {
            stage: attempt.failedStage ?? 'unknown',
            code: attempt.failureCode ?? 'unknown',
            category: attempt.failureCategory,
            error: attempt.error ?? 'No top-level error was recorded.',
            observedIssue: describeObservedIssue(attempt, failedCommand),
        }
        : undefined;
    const usedRepairs = attempt.agentRetries ?? 0;
    const diagnosticGates = Object.entries(gates).map(([gate, evidence]) => {
        const diagnosticStatus = diagnosticGateStatus(evidence);
        return {
            gate,
            authoritativeStatus: evidence.status,
            diagnosticStatus,
            explanation: explainGate(gate, evidence, diagnosticStatus, primaryFailure),
        };
    });
    const result: VallyRunDiagnostics = {
        schema: VALLY_RUN_DIAGNOSTICS_SCHEMA,
        schemaVersion: 1,
        runId: attempt.runId,
        scenarioId: attempt.scenarioId,
        outcome: attempt.outcome,
        summary: '',
        ...(primaryFailure ? { primaryFailure } : {}),
        ...(failedCommand ? {
            failedCommand: {
                name: failedCommand.name,
                command: failedCommand.command,
                workingDirectory: commandWorkingDirectory(failedCommand),
                exitCode: commandExitCode(failedCommand),
                stdoutExcerpt: excerpt(failedCommand.stdout),
                stderrExcerpt: excerpt(failedCommand.stderr),
            },
        } : {}),
        repairs: {
            used: usedRepairs,
            maximum: maximumRepairs,
            exhausted: usedRepairs >= maximumRepairs,
        },
        gates: diagnosticGates,
        recommendedActions: recommendedActions(attempt, failedCommand, usedRepairs >= maximumRepairs),
        evidenceFiles: [
            'run-result.json',
            'cor-validation.json',
            'custom_metrics.json',
            'native-summary.json',
            'reports/run-diagnostics.json',
            'reports/run-diagnostics.md',
        ],
    };
    result.summary = summarizeDiagnostics(result);
    return result;
}

export async function writeVallyRunDiagnostics(
    artifactDirectory: string,
    diagnostics: VallyRunDiagnostics,
): Promise<void> {
    const reportsDirectory = path.join(artifactDirectory, 'reports');
    await fs.mkdir(reportsDirectory, { recursive: true });
    await Promise.all([
        fs.writeFile(
            path.join(reportsDirectory, 'run-diagnostics.json'),
            `${JSON.stringify(diagnostics, null, 2)}\n`,
        ),
        fs.writeFile(
            path.join(reportsDirectory, 'run-diagnostics.md'),
            renderVallyRunDiagnostics(diagnostics),
        ),
    ]);
}

export function renderVallyRunDiagnostics(diagnostics: VallyRunDiagnostics): string {
    const failure = diagnostics.primaryFailure;
    const command = diagnostics.failedCommand;
    return [
        '# Copilot on Rails run diagnosis',
        '',
        `- **Scenario:** \`${diagnostics.scenarioId}\``,
        `- **Run:** \`${diagnostics.runId}\``,
        `- **Outcome:** \`${diagnostics.outcome}\``,
        `- **Summary:** ${diagnostics.summary}`,
        ...(failure ? [
            `- **Primary failure:** \`${failure.stage} / ${failure.code}\``,
            `- **Classification:** \`${failure.category ?? 'unknown'}\``,
            `- **Error:** ${oneLine(failure.error)}`,
            `- **Observed issue:** ${oneLine(failure.observedIssue)}`,
        ] : []),
        `- **Repairs:** ${diagnostics.repairs.used}/${diagnostics.repairs.maximum}`
            + (diagnostics.repairs.exhausted ? ' (budget exhausted)' : ''),
        '',
        '## Gate results',
        '',
        '| Gate | Result | Explanation |',
        '|---|---|---|',
        ...diagnostics.gates.map(gate =>
            `| ${escapeTable(gate.gate)} | ${gate.diagnosticStatus} | ${escapeTable(gate.explanation)} |`),
        '',
        ...(command ? [
            '## Failing command',
            '',
            `- **Task:** ${command.name ? `\`${command.name}\`` : 'not recorded'}`,
            `- **Command:** ${command.command ? `\`${abbreviateCommand(command.command, 400)}\`` : 'not recorded'}`,
            `- **Working directory:** ${command.workingDirectory ? `\`${command.workingDirectory}\`` : 'not recorded'}`,
            `- **Exit code:** ${command.exitCode ?? 'not recorded'}`,
            '',
            ...(command.stderrExcerpt ? [
                '**stderr**',
                '',
                '```text',
                command.stderrExcerpt,
                '```',
                '',
            ] : []),
            ...(command.stdoutExcerpt ? [
                '**stdout**',
                '',
                '```text',
                command.stdoutExcerpt,
                '```',
                '',
            ] : []),
        ] : []),
        '## Recommended actions',
        '',
        ...diagnostics.recommendedActions.map(action => `- ${action}`),
        '',
        '## Full evidence',
        '',
        ...diagnostics.evidenceFiles.map(file => `- \`${file}\``),
        '',
    ].join('\n');
}

export function summarizeDiagnostics(diagnostics: VallyRunDiagnostics): string {
    if (diagnostics.gates.every(gate =>
        gate.diagnosticStatus === 'passed' || gate.diagnosticStatus === 'not-applicable')) {
        return 'All applicable authoritative gates passed.';
    }
    const passedJourneyGates = ['build', 'test', 'integration']
        .filter(name => diagnostics.gates.some(gate =>
            gate.gate === name && gate.diagnosticStatus === 'passed'));
    const notAttempted = diagnostics.gates
        .filter(gate => gate.diagnosticStatus === 'not-attempted')
        .map(gate => gate.gate);
    const failure = diagnostics.primaryFailure;
    return [
        ...(passedJourneyGates.length ? [
            `${sentenceList(passedJourneyGates.map(displayGate))} passed`
                + `${diagnostics.repairs.used ? ` after ${diagnostics.repairs.used} repairs` : ''}.`,
        ] : []),
        failure
            ? `${displayGate(failure.stage)} failed (${failure.code}): `
                + `${abbreviateCommand(failure.error, 240)} ${failure.observedIssue}`
            : 'The attempt failed without a recorded primary failure.',
        ...(notAttempted.length ? [
            `${sentenceList(notAttempted.map(displayGate))} `
                + `${notAttempted.length === 1 ? 'was' : 'were'} not attempted.`,
        ] : []),
    ].join(' ');
}

function findFailedCommand(attempt: AttemptEvidence): CommandEvidence | undefined {
    const matchingStages = attempt.stages.filter(stage => stage.name === attempt.failedStage);
    const candidates = matchingStages.length ? matchingStages : attempt.stages;
    for (const stage of [...candidates].reverse()) {
        const commands = [
            ...(stage.localRuntimeValidation?.commands ?? []),
            ...(stage.buildValidation?.commands ?? []),
        ];
        const failed = commands.find(command => command.success === false);
        if (failed) {
            return failed;
        }
    }
    return undefined;
}

function diagnosticGateStatus(gate: DiagnosticGateInput): DiagnosticStatus {
    if (gate.status !== 'failed') {
        return gate.status;
    }
    return gate.evidence?.some(value => value.startsWith('missing applicable ')) === true
        ? 'not-attempted'
        : 'failed';
}

function explainGate(
    gateName: string,
    gate: DiagnosticGateInput,
    status: DiagnosticStatus,
    primaryFailure: VallyRunDiagnostics['primaryFailure'],
): string {
    if (status === 'passed') {
        return 'Authoritative evidence passed.';
    }
    if (status === 'not-applicable') {
        return gate.reason ?? 'The scenario contract marks this gate as not applicable.';
    }
    if (status === 'not-attempted') {
        return primaryFailure
            ? `Not attempted because ${primaryFailure.stage}/${primaryFailure.code} stopped dependent validation.`
            : gate.evidence?.[0] ?? 'Required evidence was not produced, so the gate failed closed.';
    }
    if (primaryFailure?.stage === gateName) {
        return `${primaryFailure.stage}/${primaryFailure.code}: ${primaryFailure.error} ${primaryFailure.observedIssue}`;
    }
    return gate.reason
        ?? gate.evidence?.find(value => !value.endsWith('.json'))
        ?? `The ${gateName} gate did not satisfy its authoritative contract.`;
}

function describeObservedIssue(
    attempt: AttemptEvidence,
    command: CommandEvidence | undefined,
): string {
    const output = `${command?.stderr ?? ''}\n${command?.stdout ?? ''}`;
    const missingExecutable = output.match(/(?:^|\n)(?:sh:\s*\d+:\s*)?([A-Za-z0-9_.-]+): not found(?:\n|$)/u);
    if (missingExecutable) {
        const location = commandWorkingDirectory(command);
        return `Required executable \`${missingExecutable[1]}\` was unavailable`
            + `${location ? ` in \`${location}\`` : ''}.`;
    }
    if (/No test files found/u.test(output)) {
        return 'The generated test command found no test files.';
    }
    const locatorFailure = describeBrowserLocatorFailure(output);
    if (locatorFailure) {
        return locatorFailure;
    }
    const formFailure = describeBrowserFormFailure(output);
    if (formFailure) {
        return formFailure;
    }
    if (command?.command) {
        return `The generated command \`${abbreviateCommand(command.command)}\` failed.`;
    }
    return attempt.error ?? 'The failed stage did not record a command-level explanation.';
}

/**
 * Separates "the app is broken" from "the probe expected a control the app did not have to build".
 * Both surface as a Playwright timeout, but only the first is a product failure.
 */
function describeBrowserLocatorFailure(output: string): string | undefined {
    const action = output.match(/locator\.(fill|selectOption|click): Timeout \d+ms exceeded/u);
    if (!action) {
        return undefined;
    }
    const target = output.match(/waiting for (getBy\w+\((?:'[^']*'|"[^"]*")[^)]*\))/u);
    const label = target ? `\`${target[1]}\`` : 'the target control';
    if (/element is not enabled|not editable/u.test(output)) {
        const readOnly = /\bdisabled\b/u.test(output);
        return `The probe tried to ${action[1] === 'fill' ? 'fill' : 'operate'} ${label}, but the rendered `
            + `control was ${readOnly ? 'disabled' : 'not editable'}. When the prompt does not require the `
            + 'field to be user-editable, this is a probe expectation the implementation was free to meet '
            + 'differently rather than an application defect — mark the action `optional` in the scenario '
            + 'if a read-only control is a valid design.';
    }
    if (/waiting for/u.test(output)) {
        return `The probe never found ${label} on the rendered page, so the expected control was `
            + 'either not built or is labelled differently.';
    }
    return undefined;
}

/**
 * The adaptive prober records which controls it could not complete and which the browser itself
 * rejected. Naming them turns a generic assertion timeout into an actionable statement.
 */
function describeBrowserFormFailure(output: string): string | undefined {
    const payload = output.match(/\{"title":.*\}/u);
    if (!payload) {
        return undefined;
    }
    let evidence: { formFieldsUnsatisfiable?: string[]; invalidFields?: string[]; assertionsCompleted?: number };
    try {
        evidence = JSON.parse(payload[0]) as typeof evidence;
    } catch {
        return undefined;
    }
    const invalid = evidence.invalidFields?.filter(field => field !== 'form') ?? [];
    if (invalid.length) {
        return `The form could not be submitted because the browser rejected ${invalid.length === 1 ? 'a field' : 'fields'}: `
            + `${invalid.slice(0, 5).join('; ')}.`;
    }
    const unsatisfiable = evidence.formFieldsUnsatisfiable ?? [];
    if (unsatisfiable.length) {
        return `The generated form has ${unsatisfiable.length === 1 ? 'a required control' : 'required controls'} `
            + `a user cannot complete: ${unsatisfiable.slice(0, 5).join('; ')}.`;
    }
    if (evidence.assertionsCompleted === 0) {
        return 'The form was filled and submitted, but the expected result never appeared on the page.';
    }
    return undefined;
}

/** Generated probes are multi-kilobyte inline scripts; the full text buries the diagnosis. */function abbreviateCommand(command: string, max = 160): string {
    const collapsed = command.replace(/\s+/gu, ' ').trim();
    if (collapsed.length <= max) {
        return collapsed;
    }
    return `${collapsed.slice(0, max)}… (${collapsed.length} chars total)`;
}

function recommendedActions(
    attempt: AttemptEvidence,
    command: CommandEvidence | undefined,
    repairBudgetExhausted: boolean,
): string[] {
    const output = `${command?.stderr ?? ''}\n${command?.stdout ?? ''}`;
    const missingExecutable = output.match(/(?:^|\n)(?:sh:\s*\d+:\s*)?([A-Za-z0-9_.-]+): not found(?:\n|$)/u);
    const actions: string[] = [];
    if (missingExecutable) {
        const location = commandWorkingDirectory(command) ?? 'the task workspace';
        actions.push(
            `Declare and install \`${missingExecutable[1]}\` in the package that owns the failing script `
                + `(\`${location}\`), or replace the script with an available command.`,
        );
    } else if (/No test files found/u.test(output)) {
        actions.push('Add meaningful tests that match the configured test runner patterns.');
    } else if (command?.command) {
        actions.push(`Fix the generated project so \`${command.command}\` succeeds in its recorded working directory.`);
    } else if (attempt.error) {
        actions.push(`Resolve the primary ${attempt.failedStage ?? 'unknown'} failure before rerunning the scenario.`);
    }

    if (repairBudgetExhausted) {
        actions.push(
            'The shared repair budget was exhausted before this failure; rerun after fixing the generation guidance '
                + 'rather than increasing retries to hide the defect.',
        );
    }
    if (!actions.length) {
        actions.push('Inspect `run-result.json` and the generated workspace for the first failed stage.');
    }
    return actions;
}

function commandWorkingDirectory(command: CommandEvidence | undefined): string | undefined {
    if (!command) {
        return undefined;
    }
    return command.relativeDirectory
        ?? command.cwd
        ?? command.stderr?.match(/^npm error (?:location|path) (.+)$/mu)?.[1]?.trim();
}

function commandExitCode(command: CommandEvidence): number | undefined {
    if (Number.isInteger(command.exitCode)) {
        return command.exitCode;
    }
    const value = command.stderr?.match(/^npm error code (\d+)$/mu)?.[1];
    return value ? Number.parseInt(value, 10) : undefined;
}

function excerpt(value: string | undefined): string | undefined {
    if (!value?.trim()) {
        return undefined;
    }
    const trimmed = dropProgressNoise(value.trim());
    return trimmed.length <= 4_000 ? trimmed : `${trimmed.slice(0, 4_000)}\n[truncated]`;
}

/**
 * Container pulls and package installers emit hundreds of progress lines that bury the one line
 * explaining the failure. Dropping them keeps the real error visible in the report.
 */
function dropProgressNoise(value: string): string {
    const lines = value.split('\n');
    const kept = lines.filter(line => !/^\s*[0-9a-f]{8,}\s+(?:Pulling fs layer|Waiting|Downloading|Download complete|Verifying Checksum|Extracting|Pull complete|Already exists)\b/u.test(line)
        && !/^\s*Image \S+ (?:Pulling|Pulled)\s*$/u.test(line));
    const removed = lines.length - kept.length;
    if (removed <= 0) {
        return value;
    }
    return [...kept, `[${removed} container image progress lines removed]`]
        .filter(line => line.trim().length)
        .join('\n');
}

function oneLine(value: string): string {
    return value.replace(/\s+/gu, ' ').trim();
}

function escapeTable(value: string): string {
    return oneLine(value).replaceAll('|', '\\|');
}

function displayGate(value: string): string {
    const labels: Record<string, string> = {
        'local-runtime': 'Local runtime',
        accessibility: 'Accessibility',
        browser: 'Browser',
        build: 'Build',
        debugger: 'Debugger',
        integration: 'Integration',
        persistence: 'Persistence',
        test: 'Tests',
    };
    return labels[value] ?? value.replaceAll('-', ' ');
}

function sentenceList(values: string[]): string {
    if (values.length < 2) {
        return values[0] ?? '';
    }
    if (values.length === 2) {
        return `${values[0]} and ${values[1]}`;
    }
    return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

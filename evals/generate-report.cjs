#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

// Reads results.jsonl from a vally eval run and writes a human-readable diagnostic report
// (run-diagnostics.md) plus a machine-readable counterpart (run-diagnostics.json).
// Usage: node evals/generate-report.cjs <results-dir>

const fs = require('fs');
const path = require('path');

const resultsDir = process.argv[2];
if (!resultsDir) {
    console.error('Usage: node evals/generate-report.cjs <results-dir>');
    process.exit(1);
}

const jsonlPath = path.join(resultsDir, 'results.jsonl');
if (!fs.existsSync(jsonlPath)) {
    console.error(`No results.jsonl found in ${resultsDir}`);
    process.exit(1);
}

const lines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n').filter(Boolean);
const records = lines.map(l => JSON.parse(l));
// The jsonl also contains a trailing `run-summary` record — keep only per-stimulus trials
// so it isn't rendered as a phantom failing stimulus and doesn't inflate the totals.
const results = records.filter(r => r.type === 'trial-result');
const runSummary = records.find(r => r.type === 'run-summary');

const passed = results.filter(r => r.gradeResult?.passed);
const failed = results.filter(r => !r.gradeResult?.passed);

const DIAGNOSTICS_SCHEMA_VERSION = 1;

/** Reserved grader exit code meaning "the grader itself failed" — see graders/graderHarness.ts. */
const EXIT_GRADER_ERROR = 3;

/**
 * Fail loudly on an unrecognised result shape.
 *
 * Every score in this report is derived from `gradeResult`. If Vally renames or
 * nests it, silently coercing to `?? 0` would render a confident report claiming
 * the product scored zero. A completed trial must carry a grade; anything else is
 * a harness problem and must stop the report rather than fabricate a regression.
 */
function assertReadableResults() {
    const unreadable = results.filter(r =>
        r.status === 'success'
        && (!r.gradeResult || typeof r.gradeResult.passed !== 'boolean'));
    if (unreadable.length === 0) {
        return;
    }
    const names = unreadable.map(stimulusName).join(', ');
    throw new Error(
        `Unreadable results: ${unreadable.length} completed trial(s) have no boolean \`gradeResult.passed\` (${names}). `
        + 'The Vally result shape likely changed; generate-report.cjs must be updated rather than scoring these as failures.',
    );
}
assertReadableResults();

/**
 * Ordered workflow stages. With pass/fail stimuli, the useful comparison between
 * two failures is how far each got, so the report names the earliest stage that
 * failed rather than a partial-credit score.
 */
const STAGES = [
    { name: 'requirements', pattern: /requirements|no-chat-questions|no-premature-plan/i },
    { name: 'plan', pattern: /plan-exists|plan-structure|plan-webview|plan-view|webview-parseable/i },
    { name: 'approval', pattern: /approved/i },
    { name: 'handoff', pattern: /handoff|scaffolding/i },
];

/** The earliest workflow stage with a failing grader, or null when nothing failed. */
function failureStage(result) {
    const failing = graderDetails(result).filter(g => !g.passed).map(g => g.name ?? '');
    if (failing.length === 0) {
        return result.status === 'success' ? null : 'execution';
    }
    for (const stage of STAGES) {
        if (failing.some(name => stage.pattern.test(name))) {
            return stage.name;
        }
    }
    return 'unclassified';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stimulusName(result) {
    return typeof result.stimulus === 'string'
        ? result.stimulus
        : result.stimulus?.name ?? result.itemId ?? 'unknown';
}

function graderDetails(result) {
    return result.gradeResult?.details ?? [];
}

function escapeCell(text) {
    return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function truncate(text, max) {
    const value = String(text ?? '');
    return value.length > max ? `${value.slice(0, max)}…` : value;
}

function formatDuration(ms) {
    const seconds = (ms ?? 0) / 1000;
    if (seconds < 60) { return `${seconds.toFixed(1)}s`; }
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${(seconds % 60).toFixed(0)}s`;
}

function formatPercent(score) {
    return `${((score ?? 0) * 100).toFixed(0)}%`;
}

/** First meaningful line of grader output — what actually went wrong. */
function errorLine(grader) {
    const streams = [grader.metadata?.stderr, grader.metadata?.stdout];
    for (const stream of streams) {
        if (!stream) { continue; }
        const interesting = stream.split('\n').map(l => l.trim()).filter(l =>
            l.startsWith('FAIL:') || l.includes('•') || l.includes('Error:') || l.includes('expected')
        );
        if (interesting.length) { return interesting.join(' '); }
    }
    const evidence = graderEvidence(grader);
    if (evidence) { return evidence.split('\n')[0]; }
    return 'Grader failed without diagnostic output.';
}

/**
 * Read a grader's human-readable explanation.
 *
 * Vally has carried this on `evidence`, and gate-style results have used `reason`
 * elsewhere — reading only one silently blanks every explanation when the shape
 * moves. Prefer `evidence`, fall back to `reason`, and say so when neither exists.
 */
function graderEvidence(grader) {
    return grader?.evidence ?? grader?.reason ?? undefined;
}

/** What the grader observed, in the grader's own words. */
function observedIssue(grader) {
    const parts = [];
    const evidence = graderEvidence(grader);
    if (evidence) { parts.push(evidence.replace(/\n/g, ' ')); }
    // Program graders report a generic "exited with code N" evidence string — the
    // actual assertion that failed only appears on stderr.
    if (grader.metadata?.program) {
        const detail = errorLine(grader);
        if (detail && !parts.includes(detail)) { parts.push(detail); }
    }
    const missingTools = grader.metadata?.required?.filter(t => !(grader.metadata?.tools ?? []).includes(t));
    if (missingTools?.length) { parts.push(`Required tool(s) never called: ${missingTools.join(', ')}.`); }
    if (grader.metadata?.path && grader.metadata?.matches?.length === 0) {
        parts.push(`Expected artifact \`${grader.metadata.path}\` was not produced.`);
    }
    return parts.join(' ') || 'No additional detail reported.';
}

/**
 * Transient upstream faults: the trial never reached the agent, so the run says
 * nothing about the product. These are outages to wait out, not defects to fix.
 */
const INFRASTRUCTURE_ERROR = /\b(?:429|5\d{2})\b|Authentication failed|rate limit|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|service unavailable/i;

/**
 * A missing or unusable Copilot credential. This is neither a transient outage to
 * wait out nor a harness bug to debug — the run is unconfigured, and every trial
 * fails identically until a human sets the token. It gets its own classification so
 * the diagnosis names the credential instead of blaming the executor or the agent.
 */
const CONFIGURATION_ERROR = /Session was not created with authentication info or custom provider|No Copilot credential found/i;

function isConfigurationError(result) {
    return result.status === 'error' && CONFIGURATION_ERROR.test(result.error ?? '');
}

function isInfrastructureError(result) {
    return result.status === 'error' && INFRASTRUCTURE_ERROR.test(result.error ?? '');
}

/**
 * Attribute a failure to the layer that owns the fix. Harness problems (crashed
 * graders, executor errors) must not be reported as agent regressions.
 */
function classify(result, grader) {
    if (isConfigurationError(result)) {
        return { classification: 'configuration_failure', reason: 'The eval agent had no usable Copilot credential, so no trial reached the agent. This says nothing about the product. Fix: give the job `copilot-requests: write` permission and pass the built-in github.token as COPILOT_GITHUB_TOKEN.' };
    }
    if (isInfrastructureError(result)) {
        return { classification: 'infrastructure_failure', reason: 'An upstream service (auth, model endpoint, or network) rejected the request before the agent ran. Re-run when the service recovers.' };
    }
    if (result.status && result.status !== 'success') {
        return { classification: 'harness_failure', reason: `Trial status was \`${result.status}\` — the executor did not complete the run.` };
    }
    const exitCode = grader?.metadata?.exit_code;
    const stderr = grader?.metadata?.stderr ?? '';
    // Exit 3 is the graders' reserved "I could not run" code (see graders/graderHarness.ts).
    // Exit 1 is ambiguous on its own — it is both a deliberate product-failure signal and
    // what Node returns for an uncaught exception — so the graders disambiguate it for us.
    if (exitCode === EXIT_GRADER_ERROR) {
        return { classification: 'harness_failure', reason: `Grader \`${grader.name}\` reported an internal error (exit ${EXIT_GRADER_ERROR}); its result says nothing about the product.` };
    }
    if (exitCode !== undefined && exitCode !== 0 && exitCode !== 1) {
        return { classification: 'harness_failure', reason: `Grader \`${grader.name}\` exited with ${exitCode}, which indicates the grader itself crashed.` };
    }
    if (/Cannot find module|command not found|ENOENT|SyntaxError|TypeError|ReferenceError|GRADER ERROR/.test(stderr)) {
        return { classification: 'harness_failure', reason: `Grader \`${grader?.name}\` could not run in this environment.` };
    }
    if (grader?.metadata?.required?.length || grader?.metadata?.path) {
        return { classification: 'agent_failure', reason: 'The agent did not perform the contracted behaviour (missing tool call or artifact).' };
    }
    return { classification: 'product_failure', reason: 'The produced artifact violated the scenario contract.' };
}

/** Skills the agent actually invoked, with invocation counts. */
function skillsInvoked(result) {
    const counts = new Map();
    for (const event of result.trajectory?.events ?? []) {
        if (event.type !== 'tool_call' || event.data?.name !== 'skill') { continue; }
        const skill = event.data?.arguments?.skill;
        if (!skill) { continue; }
        counts.set(skill, (counts.get(skill) ?? 0) + 1);
    }
    return [...counts].map(([skill, count]) => ({ skill, count }));
}

/** Actionable next steps derived from the failing graders. */
function recommendedActions(result) {
    const actions = new Set();
    if (isConfigurationError(result)) {
        return [
            'In GitHub Actions, give the job `permissions: copilot-requests: write` and set COPILOT_GITHUB_TOKEN to the built-in github.token — no PAT or repository secret is needed.',
            'Outside Actions, export `COPILOT_GITHUB_TOKEN` with a fine-grained PAT (`github_pat_...`) that has Copilot Requests: Read. Classic PATs (`ghp_`) are rejected.',
            'Do not treat these trials as product regressions — no trial reached the agent.',
        ];
    }
    if (isInfrastructureError(result)) {
        return ['Wait for the upstream service to recover, then re-run. Check https://www.githubstatus.com before investigating the agent.'];
    }
    const loadedSkills = result.trajectory?.metadata?.skillsLoaded ?? [];
    if (!result.gradeResult?.passed && loadedSkills.length && skillsInvoked(result).length === 0) {
        actions.add(`The agent never invoked a skill (loaded: \`${loadedSkills.join('`, `')}\`) — check that the stimulus wording matches the skill's activation triggers.`);
    }
    for (const grader of graderDetails(result).filter(g => !g.passed)) {
        const { classification } = classify(result, grader);
        if (classification === 'harness_failure') {
            actions.add(`Fix the harness: grader \`${grader.name}\` did not execute cleanly. Re-run only after the grader works locally.`);
            continue;
        }
        if (classification === 'infrastructure_failure') {
            actions.add('Wait for the upstream service to recover, then re-run. Check https://www.githubstatus.com before investigating the agent.');
            continue;
        }
        const missingTools = grader.metadata?.required?.filter(t => !(grader.metadata?.tools ?? []).includes(t)) ?? [];
        if (missingTools.length) {
            actions.add(`Update the skill instructions so the agent always calls \`${missingTools.join('`, `')}\` for this scenario.`);
        }
        if (grader.metadata?.path && grader.metadata?.matches?.length === 0) {
            actions.add(`Ensure the agent writes \`${grader.metadata.path}\` before finishing; the workspace had no such file.`);
        }
        if (grader.metadata?.matches?.length && grader.label === 'incorrect') {
            actions.add(`The agent produced \`${grader.metadata.path}\` when it should not have — tighten the skill's stop conditions.`);
        }
        if (grader.metadata?.program) {
            actions.add(`Reproduce locally: \`${grader.metadata.program} ${(grader.metadata.args ?? []).join(' ')}\` in the trial workspace.`);
        }
    }
    if (result.gradeResult?.passed && !actions.size) { return []; }
    if (!actions.size && !result.gradeResult?.passed) {
        actions.add('Inspect the trial trajectory events to determine why the graders disagreed with the output.');
    }
    return [...actions];
}

/** The stimulus + grader pair that best explains the run's failure. */
function primaryFailure() {
    // Real defects outrank environment problems: a configuration or infrastructure
    // error tells us nothing about the product, so it should never headline a run
    // that also contains a genuine failure.
    for (const result of failed) {
        if (isConfigurationError(result) || isInfrastructureError(result)) { continue; }
        const grader = graderDetails(result).find(g => !g.passed);
        if (grader) { return { result, grader }; }
    }
    // Configuration outranks infrastructure: it is deterministic and actionable,
    // whereas an outage just needs waiting out. Neither produces graders, so the
    // pair is grader-less and the headline comes from the trial error.
    const config = failed.find(isConfigurationError);
    if (config) { return { result: config, grader: null }; }
    const infra = failed.find(isInfrastructureError);
    return infra ? { result: infra, grader: null } : null;
}

function aggregateMetrics() {
    const totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, toolCalls: 0, errors: 0, wallTimeMs: 0 };
    const models = new Set();
    for (const result of results) {
        const metrics = result.trajectory?.metrics ?? {};
        totals.inputTokens += metrics.tokenUsage?.inputTokens ?? 0;
        totals.outputTokens += metrics.tokenUsage?.outputTokens ?? 0;
        totals.totalTokens += metrics.tokenUsage?.totalTokens ?? 0;
        totals.toolCalls += metrics.toolCallCount ?? 0;
        totals.errors += metrics.errorCount ?? 0;
        totals.wallTimeMs += result.durationMs ?? metrics.wallTimeMs ?? 0;
        const model = result.trajectory?.metadata?.model;
        if (model && model !== 'unknown') { models.add(model); }
    }
    return { totals, models: [...models] };
}

function runOutcome() {
    if (runSummary) { return runSummary.passed ? 'passed' : 'failed'; }
    return failed.length === 0 ? 'passed' : 'failed';
}

function runSummarySentence() {
    const suite = runSummary?.evals?.[0];
    const parts = [`${passed.length}/${results.length} stimuli passed (${formatPercent(suite?.overallScore ?? (results.length ? passed.length / results.length : 0))})`];
    if (suite?.threshold !== undefined) {
        const verdict = suite.passed ? 'at or above' : 'below';
        parts.push(`${verdict} the ${formatPercent(suite.threshold)} threshold`);
    }
    const sentences = [`${parts.join(', ')}.`];
    if (failed.length) {
        sentences.push(`Failing stimuli: ${failed.map(r => `\`${stimulusName(r)}\``).join(', ')}.`);
    }
    if (runSummary?.hadExecutionErrors) {
        const infra = results.filter(isInfrastructureError);
        if (infra.length) {
            sentences.push(`${infra.length}/${results.length} trial(s) never reached the agent because an upstream service failed (${infra.length === results.length ? 'the entire run is invalid' : 'those stimuli are inconclusive'}) — re-run once the service recovers rather than investigating the agent.`);
        }
        if (infra.length < results.filter(r => r.status && r.status !== 'success').length) {
            sentences.push('The run also reported executor errors — treat those results as unreliable until the harness is fixed.');
        }
    }
    return sentences.join(' ');
}

function filesTouched(result) {
    const events = result.trajectory?.events ?? [];
    const toolCalls = events.filter(e => e.type === 'tool_call');
    const createCalls = toolCalls.filter(e => e.data?.name === 'create' || e.data?.name === 'apply_patch');
    const touched = [];
    for (const call of createCalls) {
        const args = call.data?.arguments ?? {};
        const direct = args.filePath ?? args.path;
        if (direct) {
            touched.push(direct);
            continue;
        }
        // apply_patch sends a raw patch body — pull the affected paths out of it.
        const patch = typeof args.patch === 'string' ? args.patch : '';
        for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
            touched.push(m[1].trim());
        }
    }
    return [...new Set(touched)];
}

function evidenceFiles() {
    const known = ['results.jsonl', 'eval-results.md', 'otel-spans.jsonl', 'run-diagnostics.md', 'run-diagnostics.json'];
    return known.filter(f => f === 'run-diagnostics.json' || f === 'run-diagnostics.md' || fs.existsSync(path.join(resultsDir, f)));
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const { totals, models } = aggregateMetrics();
const outcome = runOutcome();
const primary = primaryFailure();
const primaryClassification = primary ? classify(primary.result, primary.grader) : null;
const suiteName = results[0]?.evalName ?? runSummary?.evals?.[0]?.name ?? 'unknown-suite';
const runId = path.basename(path.dirname(resultsDir)) === '.'
    ? path.basename(resultsDir)
    : `${path.basename(path.dirname(resultsDir))}/${path.basename(resultsDir)}`;

const report = [];
report.push('# Copilot on Rails — Eval run diagnosis\n');
report.push(`- **Suite:** \`${suiteName}\``);
report.push(`- **Run:** \`${runId}\``);
report.push(`- **Generated:** ${new Date().toISOString()}`);
report.push(`- **Outcome:** \`${outcome}\``);
report.push(`- **Summary:** ${runSummarySentence()}`);
if (primary) {
    report.push(`- **Primary failure:** \`${stimulusName(primary.result)}${primary.grader ? ` / ${primary.grader.name}` : ''}\``);
    report.push(`- **Failed at stage:** \`${failureStage(primary.result) ?? 'unknown'}\``);
    report.push(`- **Classification:** \`${primaryClassification.classification}\` — ${primaryClassification.reason}`);
    report.push(`- **Error:** ${escapeCell(truncate(primary.grader ? errorLine(primary.grader) : (primary.result.error ?? 'unknown error'), 300))}`);
    if (primary.grader) {
        report.push(`- **Observed issue:** ${escapeCell(truncate(observedIssue(primary.grader), 300))}`);
    }
}
report.push(`- **Stimuli:** ${results.length} (${passed.length} passed, ${failed.length} failed)`);
report.push(`- **Total trial time:** ${formatDuration(totals.wallTimeMs)} (sum across stimuli)`);
report.push(`- **Models:** ${models.length ? models.map(m => `\`${m}\``).join(', ') : 'not reported'}`);
report.push(`- **Tool calls:** ${totals.toolCalls}`);
if (totals.totalTokens) {
    report.push(`- **Tokens:** ${totals.totalTokens} total (${totals.inputTokens} in / ${totals.outputTokens} out)`);
}
report.push('');

// Suite-level scoring
if (runSummary?.evals?.length) {
    report.push('## Suite results\n');
    report.push('| Suite | Variant | Result | Score | Threshold | Stimuli | Duration |');
    report.push('|---|---|---|---|---|---|---|');
    for (const suite of runSummary.evals) {
        report.push(`| ${escapeCell(suite.name)} | ${escapeCell(suite.variant ?? 'main')} | ${suite.passed ? 'passed' : 'failed'} | ${formatPercent(suite.overallScore)} | ${suite.threshold !== undefined ? formatPercent(suite.threshold) : 'n/a'} | ${suite.stimuliRun ?? results.length}/${suite.stimuliTotal ?? results.length} | ${formatDuration(suite.durationMs)} |`);
    }
    report.push('');
}

// Stimulus-level overview
report.push('## Stimulus results\n');
report.push('| Stimulus | Result | Failed at | Graders | Duration | Tool calls | Explanation |');
report.push('|---|---|---|---|---|---|---|');
for (const result of results) {
    const graders = graderDetails(result);
    const failing = graders.filter(g => !g.passed);
    const events = result.trajectory?.events ?? [];
    const toolCallCount = events.filter(e => e.type === 'tool_call').length;
    const explanation = isInfrastructureError(result)
        ? 'Inconclusive — upstream service error before the agent ran.'
        : result.status !== 'success'
            ? `Trial did not complete (status \`${result.status}\`).`
            : failing.length
                ? `${failing.map(g => g.name).join(', ')}: ${errorLine(failing[0])}`
                : 'All graders passed.';
    report.push(`| ${escapeCell(stimulusName(result))} | ${isInfrastructureError(result) ? 'inconclusive' : result.gradeResult?.passed ? 'passed' : 'failed'} | ${failureStage(result) ?? '—'} | ${graders.filter(g => g.passed).length}/${graders.length} | ${formatDuration(result.durationMs)} | ${toolCallCount} | ${escapeCell(truncate(explanation, 220))} |`);
}
report.push('');

// Gate-style grader matrix — every grader across every stimulus, with an explanation.
report.push('## Grader matrix\n');
report.push('| Stimulus | Grader | Result | Explanation |');
report.push('|---|---|---|---|');
for (const result of results) {
    for (const grader of graderDetails(result)) {
        const explanation = grader.passed
            ? escapeCell(truncate(graderEvidence(grader) ?? 'Authoritative evidence passed.', 200))
            : escapeCell(truncate(errorLine(grader), 200));
        report.push(`| ${escapeCell(stimulusName(result))} | ${escapeCell(grader.name ?? '?')} | ${grader.passed ? 'passed' : 'failed'} | ${explanation} |`);
    }
}
report.push('');

report.push('---\n');

for (const result of results) {
    const name = stimulusName(result);
    const graders = graderDetails(result);
    const failing = graders.filter(g => !g.passed);
    const status = result.gradeResult?.passed ? '✅ PASSED' : '❌ FAILED';
    const metadata = result.trajectory?.metadata ?? {};
    const metrics = result.trajectory?.metrics ?? {};
    const events = result.trajectory?.events ?? [];
    const toolCalls = events.filter(e => e.type === 'tool_call');
    const toolNames = [...new Set(toolCalls.map(e => e.data?.name).filter(Boolean))];
    const skillCalls = skillsInvoked(result);

    report.push(`## ${name} — ${status}\n`);
    report.push(`- **Trial status:** \`${result.status ?? 'unknown'}\``);
    report.push(`- **Duration:** ${formatDuration(result.durationMs)}`);
    report.push(`- **Score:** ${formatPercent(result.gradeResult?.score)} (${graders.filter(g => g.passed).length}/${graders.length} graders)`);
    report.push(`- **Tool calls:** ${toolCalls.length} (${toolNames.join(', ') || 'none'})`);
    report.push(`- **Skills invoked:** ${skillCalls.length ? skillCalls.map(s => `\`${s.skill}\`${s.count > 1 ? ` (×${s.count})` : ''}`).join(', ') : 'none'}`);
    if (metadata.skillsLoaded?.length) {
        report.push(`- **Skills loaded:** ${metadata.skillsLoaded.map(s => `\`${s}\``).join(', ')}`);
    }
    if (metadata.model) { report.push(`- **Model:** \`${metadata.model}\``); }
    if (metadata.executor) { report.push(`- **Executor:** \`${metadata.executor}\``); }
    if (metrics.tokenUsage?.totalTokens) {
        report.push(`- **Tokens:** ${metrics.tokenUsage.totalTokens} total (${metrics.tokenUsage.inputTokens} in / ${metrics.tokenUsage.outputTokens} out)`);
    }
    if (metrics.errorCount) { report.push(`- **Errors during run:** ${metrics.errorCount}`); }
    if (result.trajectory?.workDir) { report.push(`- **Workspace:** \`${result.trajectory.workDir}\``); }
    if (failing.length) {
        const { classification, reason } = classify(result, failing[0]);
        report.push(`- **Primary failure:** \`${failing[0].name}\``);
        report.push(`- **Classification:** \`${classification}\` — ${reason}`);
    }
    report.push('');

    report.push('| Grader | Result | Details |');
    report.push('|---|---|---|');
    for (const grader of graders) {
        const icon = grader.passed ? '✅' : '❌';
        let details = graderEvidence(grader) ?? '';
        if (!grader.passed) {
            details = errorLine(grader);
            if (grader.metadata?.exit_code !== undefined) {
                details = `Exit code ${grader.metadata.exit_code}. ${details}`;
            }
        }
        report.push(`| ${escapeCell(grader.name ?? '?')} | ${icon} | ${escapeCell(truncate(details, 200))} |`);
    }
    report.push('');

    if (failing.length) {
        report.push('### Failure details\n');
        for (const grader of failing) {
            report.push(`**${grader.name}**\n`);
            report.push(`- **Error:** ${escapeCell(truncate(errorLine(grader), 300))}`);
            report.push(`- **Observed issue:** ${escapeCell(truncate(observedIssue(grader), 300))}`);
            if (grader.metadata?.exit_code !== undefined) {
                report.push(`- **Exit code:** ${grader.metadata.exit_code}`);
            }
            report.push('');

            if (grader.metadata?.program) {
                report.push('**Failing command**\n');
                report.push('```text');
                report.push(`${grader.metadata.program} ${(grader.metadata.args ?? []).join(' ')}`);
                report.push('```\n');
            }
            if (grader.metadata?.stderr?.trim()) {
                report.push('**stderr**\n');
                report.push('```text');
                report.push(truncate(grader.metadata.stderr.trim(), 1500));
                report.push('```\n');
            }
            if (grader.metadata?.stdout?.trim()) {
                report.push('**stdout**\n');
                report.push('```text');
                report.push(truncate(grader.metadata.stdout.trim(), 500));
                report.push('```\n');
            }
        }

        const actions = recommendedActions(result);
        if (actions.length) {
            report.push('### Recommended actions\n');
            for (const action of actions) { report.push(`- ${action}`); }
            report.push('');
        }
    }

    const touched = filesTouched(result);
    if (touched.length) {
        report.push('### Files created\n');
        for (const filePath of touched) { report.push(`- \`${filePath}\``); }
        report.push('');
    }

    if (typeof result.trajectory?.output === 'string' && result.trajectory.output.trim()) {
        report.push('### Agent final message\n');
        report.push('```text');
        report.push(truncate(result.trajectory.output.trim(), 1200));
        report.push('```\n');
    }

    report.push('---\n');
}

// Run-wide recommendations, deduplicated across stimuli.
const allActions = [...new Set(failed.flatMap(recommendedActions))];
if (allActions.length) {
    report.push('## Recommended actions\n');
    for (const action of allActions) { report.push(`- ${action}`); }
    report.push('');
}

report.push('## Full evidence\n');
for (const file of evidenceFiles()) { report.push(`- \`${file}\``); }
if (runSummary?.sessionLogsDir) { report.push(`- \`${runSummary.sessionLogsDir}\` (session logs)`); }
report.push('');

const reportPath = path.join(resultsDir, 'run-diagnostics.md');
fs.writeFileSync(reportPath, report.join('\n'));

// Machine-readable counterpart so CI can assert on the same diagnosis.
const diagnostics = {
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    suite: suiteName,
    run: runId,
    generatedAt: new Date().toISOString(),
    outcome,
    summary: runSummarySentence(),
    primaryFailure: primary
        ? {
            stimulus: stimulusName(primary.result),
            grader: primary.grader?.name ?? null,
            stage: failureStage(primary.result),
            classification: primaryClassification.classification,
            reason: primaryClassification.reason,
            error: primary.grader ? errorLine(primary.grader) : (primary.result.error ?? null),
            observedIssue: primary.grader ? observedIssue(primary.grader) : null,
        }
        : null,
    totals: {
        stimuli: results.length,
        passed: passed.length,
        failed: failed.length,
        inconclusive: results.filter(isInfrastructureError).length,
        toolCalls: totals.toolCalls,
        wallTimeMs: totals.wallTimeMs,
        tokens: { input: totals.inputTokens, output: totals.outputTokens, total: totals.totalTokens },
        models,
    },
    suites: runSummary?.evals ?? [],
    stimuli: results.map(result => ({
        name: stimulusName(result),
        status: result.status ?? null,
        passed: Boolean(result.gradeResult?.passed),
        inconclusive: isInfrastructureError(result),
        failureStage: failureStage(result),
        score: result.gradeResult?.score ?? 0,
        durationMs: result.durationMs ?? 0,
        workDir: result.trajectory?.workDir ?? null,
        model: result.trajectory?.metadata?.model ?? null,
        skillsLoaded: result.trajectory?.metadata?.skillsLoaded ?? [],
        skillsInvoked: skillsInvoked(result),
        toolCalls: (result.trajectory?.events ?? []).filter(e => e.type === 'tool_call').length,
        filesCreated: filesTouched(result),
        recommendedActions: recommendedActions(result),
        graders: graderDetails(result).map(grader => ({
            name: grader.name ?? null,
            passed: Boolean(grader.passed),
            score: grader.score ?? 0,
            evidence: graderEvidence(grader) ?? null,
            error: grader.passed ? null : errorLine(grader),
            observedIssue: grader.passed ? null : observedIssue(grader),
            exitCode: grader.metadata?.exit_code ?? null,
            command: grader.metadata?.program
                ? [grader.metadata.program, ...(grader.metadata.args ?? [])].join(' ')
                : null,
        })),
    })),
    recommendedActions: allActions,
    evidence: evidenceFiles(),
};
const diagnosticsPath = path.join(resultsDir, 'run-diagnostics.json');
fs.writeFileSync(diagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`);

console.log(`Diagnostics written to ${reportPath}`);
console.log(`Diagnostics written to ${diagnosticsPath}`);

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DiagnosticsPhaseEntry, type DiagnosticsToolEntry, type ToolStats, type WorkflowDiagnosticsRecord } from "./workflowDiagnostics";

/**
 * Pure computation of tool-usage/efficiency metrics from a run's recorded tool
 * calls. No IO — safe to unit test.
 */

export type ToolCategory = 'read' | 'edit' | 'terminal' | 'mcp' | 'question' | 'other';

/** Buckets a tool by name into a coarse category for the report/benchmark. */
export function categorizeTool(name: string): ToolCategory {
    const n = name.toLowerCase();
    if (/ask.?question|askquestions/.test(n)) {
        return 'question';
    }
    if (/terminal|run_in_terminal|execute_command|shell|runcommand/.test(n)) {
        return 'terminal';
    }
    if (/^mcp[_-]|_mcp_|azure_mcp|azmcp|^azure-/.test(n)) {
        return 'mcp';
    }
    if (/edit|write|create_file|replace|apply_patch|insert|modify|patch/.test(n)) {
        return 'edit';
    }
    if (/read|view|search|grep|list|fetch|get_|find/.test(n)) {
        return 'read';
    }
    return 'other';
}

/** Returns the p-th percentile (0..1) of an unsorted numeric array, or 0 when empty. */
export function percentile(values: number[], p: number): number {
    const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
    if (sorted.length === 0) {
        return 0;
    }
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[idx];
}

/** Computes aggregate tool statistics for a run. */
export function computeToolStats(tools: DiagnosticsToolEntry[], phases: DiagnosticsPhaseEntry[]): ToolStats {
    const byCategory: Record<string, number> = {};
    let terminalFailures = 0;
    const editHashes: string[] = [];
    let editWithHash = 0;

    for (const tool of tools) {
        const category = categorizeTool(tool.name);
        byCategory[category] = (byCategory[category] ?? 0) + 1;
        if (category === 'terminal' && !tool.success) {
            terminalFailures++;
        }
        if (category === 'edit' && tool.targetHash) {
            editWithHash++;
            editHashes.push(tool.targetHash);
        }
    }

    // Retries: a failed call followed later, within the same phase, by another
    // call of the same tool.
    const phaseOrder = phases.map((p) => p.phase);
    let retriedCalls = 0;
    const grouped = new Map<string, DiagnosticsToolEntry[]>();
    for (const tool of tools) {
        const key = tool.phase ?? 'unknown';
        const list = grouped.get(key) ?? [];
        list.push(tool);
        grouped.set(key, list);
    }
    for (const phase of [...phaseOrder, ...[...grouped.keys()].filter((p) => !phaseOrder.includes(p))]) {
        const list = grouped.get(phase);
        if (!list) {
            continue;
        }
        for (let i = 0; i < list.length; i++) {
            if (!list[i].success && list.slice(i + 1).some((t) => t.name === list[i].name)) {
                retriedCalls++;
            }
        }
    }

    const uniqueFilesTouched = new Set(editHashes).size;
    const editChurnRatio = uniqueFilesTouched > 0 ? editWithHash / uniqueFilesTouched : 0;
    const latencies = tools.map((t) => t.latencyMs);

    return {
        total: tools.length,
        failures: tools.filter((t) => !t.success).length,
        p50LatencyMs: percentile(latencies, 0.5),
        p95LatencyMs: percentile(latencies, 0.95),
        retriedCalls,
        terminalFailures,
        uniqueFilesTouched,
        editChurnRatio: Math.round(editChurnRatio * 100) / 100,
        byCategory,
    };
}

/** A tool that failed at least once, with its attempt count. */
export interface FailingToolStat {
    name: string;
    failures: number;
    attempts: number;
}

/** Failure/attempt counts bucketed by phase or category. */
export interface BucketFailureStat {
    key: string;
    failures: number;
    calls: number;
}

/**
 * A synthesized, numbers-only assessment of how a run performed: reliability,
 * self-correction/rework, the biggest sources of failure, and the main
 * bottlenecks. Pure/derived — no IO, no prose (the report renderer turns these
 * numbers into human-readable findings). Safe to unit test.
 */
export interface PerformanceAnalysis {
    /** Total tool calls captured for the run. */
    totalCalls: number;
    /** Number of failed tool calls. */
    failures: number;
    /** Success rate as a percentage (0–100, one decimal). */
    successRatePct: number;

    // ---- Self-correction / rework ----
    /** Failed call later retried (same tool, same phase). */
    retriedCalls: number;
    /** Longest run of consecutive failed calls (in recorded order). */
    longestFailureStreak: number;
    /** Distinct files edited more than once. */
    reeditedFileCount: number;
    /** Most edits landed on a single file. */
    maxReeditsOnOneFile: number;
    /** Share of edits that were repeat edits of an already-touched file (0–100). */
    reworkRatioPct: number;
    /** Manual revision round-trips the human requested. */
    revisionRoundTrips: number;

    // ---- Issue sources ----
    /** Tools with the most failures, highest first (top 5). */
    topFailingTools: FailingToolStat[];
    /** Phases that saw failures, highest first. */
    failuresByPhase: BucketFailureStat[];
    /** Tool categories that saw failures, highest first. */
    failuresByCategory: BucketFailureStat[];

    // ---- Bottlenecks ----
    /** Phase with the longest wall-clock duration. */
    slowestPhaseByDuration?: { phase: string; durationMs: number };
    /** Phase where the most cumulative tool time was spent. */
    slowestPhaseByToolTime?: { phase: string; toolMs: number };
    /** Phase with the most tool calls. */
    busiestPhaseByCalls?: { phase: string; calls: number };
    /** Single slowest tool call. */
    longestCall?: { name: string; phase: string; latencyMs: number };
    /** Cumulative tool latency per category (ms). */
    categoryTimeMs: Record<string, number>;
    /** Wall-clock time spent waiting on manual approvals (ms). */
    approvalWaitMs: number;
    /** Hands-on agent time (ms). */
    activeMs: number;
}

/** Groups a run's tool calls by phase, preserving encounter order within each phase. */
function groupToolsByPhase(tools: DiagnosticsToolEntry[]): Map<string, DiagnosticsToolEntry[]> {
    const grouped = new Map<string, DiagnosticsToolEntry[]>();
    for (const tool of tools) {
        const key = tool.phase ?? 'unknown';
        const list = grouped.get(key) ?? [];
        list.push(tool);
        grouped.set(key, list);
    }
    return grouped;
}

/**
 * Produces a {@link PerformanceAnalysis} for a run from its recorded tool calls,
 * phase timings, and friction. Everything is derived from data already on the
 * record; nothing new is read from disk.
 */
export function analyzePerformance(record: WorkflowDiagnosticsRecord): PerformanceAnalysis {
    const tools = record.tools ?? [];
    const phases = record.phases ?? [];

    const totalCalls = tools.length;
    const failures = tools.filter((t) => !t.success).length;
    const successRatePct = totalCalls > 0
        ? Math.round(((totalCalls - failures) / totalCalls) * 1000) / 10
        : 100;

    // Longest consecutive run of failures, in recorded order.
    let longestFailureStreak = 0;
    let currentStreak = 0;
    for (const tool of tools) {
        if (!tool.success) {
            currentStreak++;
            longestFailureStreak = Math.max(longestFailureStreak, currentStreak);
        } else {
            currentStreak = 0;
        }
    }

    // Retries: a failed call followed later, within the same phase, by another
    // call of the same tool.
    const phaseOrder = phases.map((p) => p.phase);
    const grouped = groupToolsByPhase(tools);
    let retriedCalls = 0;
    for (const phase of [...phaseOrder, ...[...grouped.keys()].filter((p) => !phaseOrder.includes(p))]) {
        const list = grouped.get(phase);
        if (!list) {
            continue;
        }
        for (let i = 0; i < list.length; i++) {
            if (!list[i].success && list.slice(i + 1).some((t) => t.name === list[i].name)) {
                retriedCalls++;
            }
        }
    }

    // Rework: edits landing on the same (hashed) file more than once.
    const hashCounts = new Map<string, number>();
    let editsWithHash = 0;
    for (const tool of tools) {
        if (categorizeTool(tool.name) === 'edit' && tool.targetHash) {
            editsWithHash++;
            hashCounts.set(tool.targetHash, (hashCounts.get(tool.targetHash) ?? 0) + 1);
        }
    }
    const uniqueFiles = hashCounts.size;
    const reeditedFileCount = [...hashCounts.values()].filter((c) => c > 1).length;
    const maxReeditsOnOneFile = hashCounts.size > 0 ? Math.max(...hashCounts.values()) : 0;
    const reworkRatioPct = editsWithHash > 0
        ? Math.round(((editsWithHash - uniqueFiles) / editsWithHash) * 1000) / 10
        : 0;

    // Failure/attempt counts per tool, phase, and category.
    const attemptsByTool = new Map<string, number>();
    const failsByTool = new Map<string, number>();
    const callsByCategory = new Map<string, number>();
    const failsByCategory = new Map<string, number>();
    const categoryTimeMs: Record<string, number> = {};
    for (const tool of tools) {
        attemptsByTool.set(tool.name, (attemptsByTool.get(tool.name) ?? 0) + 1);
        const category = categorizeTool(tool.name);
        callsByCategory.set(category, (callsByCategory.get(category) ?? 0) + 1);
        if (!tool.success) {
            failsByTool.set(tool.name, (failsByTool.get(tool.name) ?? 0) + 1);
            failsByCategory.set(category, (failsByCategory.get(category) ?? 0) + 1);
        }
        if (Number.isFinite(tool.latencyMs) && tool.latencyMs > 0) {
            categoryTimeMs[category] = (categoryTimeMs[category] ?? 0) + tool.latencyMs;
        }
    }

    const topFailingTools: FailingToolStat[] = [...failsByTool.entries()]
        .map(([name, f]) => ({ name, failures: f, attempts: attemptsByTool.get(name) ?? f }))
        .sort((a, b) => b.failures - a.failures || b.attempts - a.attempts)
        .slice(0, 5);

    const failuresByPhase: BucketFailureStat[] = [...grouped.entries()]
        .map(([phase, list]) => ({ key: phase, failures: list.filter((t) => !t.success).length, calls: list.length }))
        .filter((p) => p.failures > 0)
        .sort((a, b) => b.failures - a.failures);

    const failuresByCategory: BucketFailureStat[] = [...failsByCategory.entries()]
        .map(([category, f]) => ({ key: category, failures: f, calls: callsByCategory.get(category) ?? f }))
        .sort((a, b) => b.failures - a.failures);

    // Bottlenecks.
    let slowestPhaseByDuration: { phase: string; durationMs: number } | undefined;
    for (const p of phases) {
        if (p.durationMs > 0 && (!slowestPhaseByDuration || p.durationMs > slowestPhaseByDuration.durationMs)) {
            slowestPhaseByDuration = { phase: p.phase, durationMs: p.durationMs };
        }
    }

    let slowestPhaseByToolTime: { phase: string; toolMs: number } | undefined;
    let busiestPhaseByCalls: { phase: string; calls: number } | undefined;
    for (const [phase, list] of grouped) {
        const toolMs = list.reduce((sum, t) => sum + (Number.isFinite(t.latencyMs) && t.latencyMs > 0 ? t.latencyMs : 0), 0);
        if (!slowestPhaseByToolTime || toolMs > slowestPhaseByToolTime.toolMs) {
            slowestPhaseByToolTime = { phase, toolMs };
        }
        if (!busiestPhaseByCalls || list.length > busiestPhaseByCalls.calls) {
            busiestPhaseByCalls = { phase, calls: list.length };
        }
    }

    let longestCall: { name: string; phase: string; latencyMs: number } | undefined;
    for (const tool of tools) {
        if (Number.isFinite(tool.latencyMs) && tool.latencyMs >= 0 && (!longestCall || tool.latencyMs > longestCall.latencyMs)) {
            longestCall = { name: tool.name, phase: tool.phase ?? 'unknown', latencyMs: tool.latencyMs };
        }
    }

    return {
        totalCalls,
        failures,
        successRatePct,
        retriedCalls,
        longestFailureStreak,
        reeditedFileCount,
        maxReeditsOnOneFile,
        reworkRatioPct,
        revisionRoundTrips: record.friction?.revisionCount ?? 0,
        topFailingTools,
        failuresByPhase,
        failuresByCategory,
        slowestPhaseByDuration,
        slowestPhaseByToolTime,
        busiestPhaseByCalls,
        longestCall,
        categoryTimeMs,
        approvalWaitMs: record.friction?.approvalWaitMs ?? 0,
        activeMs: record.friction?.activeMs ?? 0,
    };
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DiagnosticsPhaseEntry, type DiagnosticsToolEntry, type ToolStats } from "./workflowDiagnostics";

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

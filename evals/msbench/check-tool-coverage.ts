/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Which of the product's MCP tools can this suite actually invoke?
 *
 * Every other check here asks whether a *gate* is sound: can it fail, is its artifact reachable
 * in the phase it is wired to, does it count the right files. None of them asks the question one
 * level up — whether the run exercised the product surface a user actually triggers.
 *
 * It does not, for most of them. Measured across the 86-run local corpus:
 *
 *   invoked at least once   5 of 15    open_requirements_view (28 runs), open_frontend_preview_view
 *                                      (10), open_local_plan_view (5), open_plan_view (2),
 *                                      start_project_integrate (1)
 *   never invoked          10 of 15    including every Phase 3 deploy tool
 *
 * That is invisible in every report the suite produces, because assertions grade *artifacts* —
 * the files an agent wrote — and an agent that writes the right files without going through the
 * product's entry point passes every one of them. `scaffold-fullstack` is the clean example: 203
 * tool calls, zero MCP calls, and green artifact gates.
 *
 * ── Two different reasons a tool is never invoked, and only one is a defect ──────────────────
 *
 * **Structural.** The four `start_*` hand-off tools cannot be observed here, and this is not an
 * oversight — `chain-mechanism-probe.yaml` establishes it by reading the source. `launchAgentChat`
 * (src/commands/copilotOnRails/openChatWithAgent.ts) runs:
 *
 *     workbench.action.chat.newChat
 *     workbench.action.chat.open  { mode: agentName, query }
 *
 * "Fresh chat session per phase hand-off: agents coordinate through the `.azure/*` plan files on
 * disk, not chat history." `promptSteps` drives ONE session, so an agent that called a hand-off
 * tool would move the work into a session the harness is not watching, and the run would read as
 * an agent that stopped. The suite instead enters each phase by staging `.azure/*` state on disk —
 * which is how the product coordinates anyway. The tool call is the part that is skipped.
 *
 * **Coverage.** Everything else. A tool an under-test agent is instructed to call, in a phase the
 * suite runs, that no stimulus has ever caused to fire. That is a hole, and it is the thing this
 * check exists to make visible.
 *
 * ── What this proves, and what it does not ───────────────────────────────────────────────────
 *
 * This is a **static** check: it reads the registration list, the phase configs and the agent
 * instructions, and reports which tools any stimulus could plausibly reach. It cannot prove a tool
 * *was* invoked — only the corpus can, and `gate-health` is where that belongs.
 *
 * So a green here means "a path exists", not "the path was taken". That is deliberately the weaker
 * claim, because the stronger one needs paid runs and this needs none. The failure it catches is
 * the one that costs the most to discover late: a tool nothing can ever exercise.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const REPO = join(HERE, '..', '..');
const AGENTS = join(REPO, 'resources', 'agents');
const PHASES = join(HERE, 'config', 'phases');
const STIMULI = join(HERE, 'config', 'stimuli');
const REGISTRATION = join(REPO, 'src', 'chat', 'tools', 'copilotOnRails', 'registerCopilotOnRailsTools.ts');

/**
 * Tools whose absence from the corpus is a property of the harness rather than a gap to close.
 *
 * Keyed by the runtime tool name. Each reason has to name the mechanism, not just assert that it
 * is fine — a waiver that says "not applicable" is indistinguishable from one nobody rechecked.
 */
const STRUCTURALLY_UNREACHABLE: Record<string, string> = {
    mcp_copilot_azure_start_project_scaffold:
        'Phase hand-off. launchAgentChat opens a FRESH chat session (workbench.action.chat.newChat), ' +
        'and promptSteps drives one session, so a call here moves the work somewhere the harness is ' +
        'not watching. The scaffold phase is entered by staging .azure/project-plan.md instead — the ' +
        'same on-disk coordination the product uses. See config/stimuli/chain-mechanism-probe.yaml.',
    mcp_copilot_azure_start_local_development:
        'Phase hand-off into the local phase; same fresh-session mechanism as start_project_scaffold.',
    mcp_copilot_azure_start_azure_debug_generate:
        'Phase hand-off into debug generation; same fresh-session mechanism.',
    mcp_copilot_azure_start_deployment:
        'Phase hand-off into the deploy phase; same fresh-session mechanism.',
};

/**
 * A tool has two names and they are not interchangeable, which is worth stating because getting
 * it wrong is silent in both directions:
 *
 *   short    `open_plan_view`                     what the agent instructions tell the model to call
 *   runtime  `mcp_copilot_azure_open_plan_view`   what appears in the session's `toolCalls` table
 *
 * Searching the instructions for the runtime name finds nothing and reports full coverage loss;
 * searching `toolCalls` for the short name finds nothing and reports the same. Both failures look
 * exactly like the real finding they would be hiding.
 */
function shortName(identifier: string): string {
    return identifier.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase();
}

function runtimeName(identifier: string): string {
    return `mcp_copilot_azure_${shortName(identifier)}`;
}

/**
 * The registration file is the source of truth on purpose: adding a tool there and nowhere else is
 * exactly the change that should turn this check red.
 */
function registeredTools(): string[] {
    const source = readFileSync(REGISTRATION, 'utf8');
    const names: string[] = [];
    for (const match of source.matchAll(/registerMcpToolWithTelemetry\(\s*mcpServer\s*,\s*(\w+)\s*\)/gu)) {
        names.push(match[1].replace(/Tool$/u, ''));
    }
    return names;
}

/**
 * The agents the suite actually puts under test.
 *
 * Two sources, and both are needed. A phase's top-level `chatMode` is the default, but a stimulus
 * may override it per step — `debug-generate-artifacts` reaches `azure-debug-generate` that way,
 * from a phase whose default is `azure-debug-plan`. Reading only the phase files would report that
 * agent's tools as unreachable when a stimulus reaches them every run.
 */
function agentsUnderTest(): Map<string, string[]> {
    const byAgent = new Map<string, string[]>();
    const add = (agent: string, where: string): void => {
        const seen = byAgent.get(agent) ?? [];
        if (!seen.includes(where)) {
            byAgent.set(agent, [...seen, where]);
        }
    };

    for (const file of readdirSync(PHASES).filter(name => name.endsWith('.yaml'))) {
        const match = /^chatMode:\s*(\S+)/mu.exec(readFileSync(join(PHASES, file), 'utf8'));
        if (match) {
            add(match[1], file.replace(/\.yaml$/u, ''));
        }
    }

    for (const file of readdirSync(STIMULI).filter(name => name.endsWith('.yaml'))) {
        const text = readFileSync(join(STIMULI, file), 'utf8');
        const stimulus = file.replace(/\.yaml$/u, '');
        for (const match of text.matchAll(/^\s+chatMode:\s*(\S+)/gmu)) {
            add(match[1], `${stimulus} (step override)`);
        }
    }
    return byAgent;
}

/** Phases that at least one stimulus declares, so "under test" means something was run at it. */
function phasesWithStimuli(): Set<string> {
    const phases = new Set<string>();
    for (const file of readdirSync(STIMULI).filter(name => name.endsWith('.yaml'))) {
        const match = /^#\s*phase:\s*(\S+)/mu.exec(readFileSync(join(STIMULI, file), 'utf8'));
        phases.add(match ? match[1] : 'plan');
    }
    return phases;
}

/**
 * Does this agent's instruction set tell it to call this tool?
 *
 * An agent's instructions live in TWO places, and reading only one is the difference between a
 * true and a false report: `resources/agents/<agent>.agent.md` holds the workflow that names most
 * tool calls, and `resources/agents/<agent>/` holds the references it reads. Scanning only the
 * directory reported `open_requirements_view` as uncovered while the corpus shows it invoked in 28
 * runs — the check contradicting an observation is what caught it.
 */
function agentReferencesTool(agent: string, tool: string): boolean {
    const manifest = join(AGENTS, `${agent}.agent.md`);
    if (existsSync(manifest) && readFileSync(manifest, 'utf8').includes(tool)) {
        return true;
    }
    const dir = join(AGENTS, agent);
    if (!existsSync(dir)) {
        return false;
    }
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop()!;
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(path);
            } else if (readFileSync(path, 'utf8').includes(tool)) {
                return true;
            }
        }
    }
    return false;
}

function main(): void {
    const tools = registeredTools();
    const underTest = agentsUnderTest();
    const runnable = phasesWithStimuli();

    console.log('Tool coverage — can any stimulus reach the product\'s own entry points?\n');
    console.log(`${tools.length} registered tool(s); agents under test: ${[...underTest.keys()].join(', ')}\n`);

    const reachable: string[] = [];
    const waived: string[] = [];
    const uncovered: { tool: string; detail: string }[] = [];

    for (const identifier of tools) {
        const tool = runtimeName(identifier);
        const instructionName = shortName(identifier);
        const callers = [...underTest.entries()]
            .filter(([agent]) => agentReferencesTool(agent, instructionName))
            // A phase counts only if some stimulus declares it; a step override counts always,
            // because the override *is* a stimulus naming that agent.
            .filter(([, where]) => where.some(w => w.includes('(step override)') || runnable.has(w)));

        // Order matters: the structural waiver wins over "an agent is instructed to call it".
        // Both `start_project_scaffold` and `start_azure_debug_generate` ARE named in an
        // under-test agent's workflow, so the reachability test alone calls them covered — while
        // the corpus shows zero invocations across 86 runs. Specification is not observability,
        // and reporting the optimistic half would recreate the blind spot this check exists for.
        if (STRUCTURALLY_UNREACHABLE[tool]) {
            waived.push(tool);
            console.log(`  UNOBSERVABLE ${tool}`);
        } else if (callers.length > 0) {
            reachable.push(tool);
            console.log(`  REACHABLE   ${tool}`);
            console.log(`              via ${callers.map(([a, p]) => `${a} (${p.join(', ')})`).join(', ')}`);
        } else {
            const owner = [...underTest.keys()].find(agent => agentReferencesTool(agent, instructionName));
            uncovered.push({
                tool,
                detail: owner
                    ? `instructed in ${owner}, but no stimulus runs a phase that uses it`
                    : 'no agent under test is instructed to call it',
            });
            console.log(`  UNCOVERED   ${tool}`);
        }
    }

    console.log(`\nreachable ${reachable.length} · waived ${waived.length} · uncovered ${uncovered.length}\n`);

    if (uncovered.length === 0) {
        console.log('Every registered tool is reachable by some stimulus, or waived with a mechanism.');
        return;
    }

    console.log('UNCOVERED — a registered product surface no stimulus can exercise. A regression in');
    console.log('any of these is invisible to this suite: artifact assertions still pass, because they');
    console.log('grade the files an agent wrote and never ask how it was entered.\n');
    for (const { tool, detail } of uncovered) {
        console.log(`  * ${tool}\n      ${detail}`);
    }
    console.log('\nClose it with a stimulus that reaches the tool, or add a STRUCTURALLY_UNREACHABLE');
    console.log('entry naming the mechanism that prevents it. Do not waive one merely because it is');
    console.log('untested — that is the state this check exists to report.');
    process.exitCode = 1;
}

main();

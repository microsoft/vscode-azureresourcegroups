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
 * This list is deliberately EMPTY, and the reason is worth recording because the obvious entry
 * was wrong.
 *
 * The four `start_*` hand-off tools look unobservable: `launchAgentChat` opens a FRESH chat
 * session (`workbench.action.chat.newChat`) because agents coordinate through `.azure/*` files
 * rather than chat history, and `promptSteps` drives one session — so the work moves somewhere the
 * harness is not watching. All true, and all about the hand-off's *destination*.
 *
 * The tool *call* is recorded before any of that happens. Two independent proofs:
 * `scaffold-autopilot` asserts `COUNT(*) > 0 ... LIKE '%start_project_integrate%'` and the corpus
 * shows that tool invoked; `debug-generate-artifacts` asserts the same for
 * `start_azure_debug_generate`. A suite would not assert on a tool it could not see.
 *
 * "The harness cannot follow where this leads" and "the harness cannot see this happen" are
 * different claims, and only the first one is true. Waiving on the second would have excused
 * exactly the coverage this check exists to demand.
 */
const STRUCTURALLY_UNREACHABLE: Record<string, string> = {};

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
        // A step override is a LIST ITEM — `- chatMode: azure-debug-generate` — so the `- ` has to
        // be optional here. Requiring `chatMode:` immediately after whitespace matched none of
        // them, which silently reported azure-debug-generate as never under test while
        // debug-generate-artifacts drives it every run.
        for (const match of text.matchAll(/^\s*-?\s*chatMode:\s*(\S+)/gmu)) {
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

/**
 * Which stimuli assert that this tool was (or was not) called?
 *
 * This is the question that decides coverage. An agent being *instructed* to call a tool means a
 * path exists; a stimulus *asserting* on `toolCalls` is the only thing that turns a missing call
 * into a red. The suite already does this for six tools, in both directions — `scaffold-fullstack`
 * requires `start_project_integrate` NOT to fire while `scaffold-autopilot` requires that it does,
 * which is a falsifiable pair rather than a one-sided check.
 */
function assertingStimuli(shortToolName: string): string[] {
    const owners: string[] = [];
    for (const file of readdirSync(STIMULI).filter(name => name.endsWith('.yaml'))) {
        const text = readFileSync(join(STIMULI, file), 'utf8');
        for (const line of text.split(/\r?\n/u)) {
            if (line.includes('FROM toolCalls') && line.includes(shortToolName)) {
                owners.push(file.replace(/\.yaml$/u, ''));
                break;
            }
        }
    }
    return owners;
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

        // Order matters, and the ordering encodes what "covered" means here. An assertion on
        // `toolCalls` is the only thing that makes a missing call fail a run; being named in an
        // agent's workflow merely means a path exists. Reporting the second as coverage is how a
        // suite ends up green while never touching the surface it claims to test.
        const asserted = assertingStimuli(instructionName);
        if (asserted.length > 0) {
            reachable.push(tool);
            console.log(`  ASSERTED    ${tool}`);
            console.log(`              by ${asserted.slice(0, 4).join(', ')}${asserted.length > 4 ? ` (+${asserted.length - 4} more)` : ''}`);
        } else if (STRUCTURALLY_UNREACHABLE[tool]) {
            waived.push(tool);
            console.log(`  WAIVED      ${tool}`);
        } else {
            const owner = [...underTest.keys()].find(agent => agentReferencesTool(agent, instructionName));
            uncovered.push({
                tool,
                detail: callers.length > 0
                    ? `reachable via ${callers.map(([a]) => a).join(', ')}, but NO stimulus asserts it is called`
                    : owner
                        ? `instructed in ${owner}, but no stimulus runs a phase that uses it, and none asserts it`
                        : 'no agent under test is instructed to call it, and no stimulus asserts it',
            });
            console.log(`  UNASSERTED  ${tool}`);
        }
    }

    console.log(`\nasserted ${reachable.length} · waived ${waived.length} · unasserted ${uncovered.length}\n`);

    if (uncovered.length === 0) {
        console.log('Every registered tool has a stimulus asserting on its invocation.');
        return;
    }

    console.log('UNASSERTED — a registered product surface no stimulus checks the invocation of.');
    console.log('A regression in any of these is invisible: artifact assertions still pass, because');
    console.log('they grade the files an agent wrote and never ask how it was entered.\n');
    for (const { tool, detail } of uncovered) {
        console.log(`  * ${tool}\n      ${detail}`);
    }
    console.log('\nClose it by asserting on the call — `SELECT COUNT(*) > 0 FROM toolCalls WHERE tool');
    console.log("LIKE '%<tool>%'` — in a stimulus that reaches the agent. Six tools already do this,");
    console.log('and four of them in both directions, which is the pattern worth copying: a positive');
    console.log('in one stimulus and a negative in its pair proves the assertion discriminates.');
    process.exitCode = 1;
}

main();

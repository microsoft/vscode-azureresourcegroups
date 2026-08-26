/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Custom Vally executor that uses the Copilot SDK directly with skillDirectories.
 * The built-in copilot-sdk executor's skill loading doesn't work for our setup,
 * so we replicate the partner team's pattern of constructing CopilotClient and
 * passing skillDirectories to createSession() ourselves.
 */

import { approveAll, CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { computeMetrics } from "@microsoft/vally";
import type { Executor, ExecutorOptions, ExecutorRegistry, Stimulus, Trajectory, TrajectoryEvent } from "@microsoft/vally";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildEvalSkill, prepareAgentWorkspace, resolveEvalModel } from "./agent-assets.ts";
import { workflowToolDefinitions } from "../mcp/workflow-tools.ts";

const scriptDir = import.meta.dirname;
const repoRoot = path.resolve(scriptDir, "../..");
const AGENT_NAME = "azure-project-plan";

function getBundledCliPath() {
    const pkgDir = path.resolve(scriptDir, "../node_modules/@github/copilot");
    const candidates = [];
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
        const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.copilot;
        if (bin) {candidates.push(bin);}
    } catch { /* fall through */ }
    candidates.push("npm-loader.js", "index.js");
    for (const c of candidates) {
        const p = path.resolve(pkgDir, c);
        if (fs.existsSync(p)) {return p;}
    }
    return path.resolve(pkgDir, "npm-loader.js");
}

/**
 * The trajectory events this executor actually emits.
 *
 * Deliberately *not* `TrajectoryEvent`: three fields diverge from what vally
 * models, and the divergences change grading, so they are recorded here rather
 * than silently "fixed" during a mechanical TypeScript conversion.
 *
 * 1. `tool_call.data.name` — vally's `ToolCallEvent` calls this `toolName`, and
 *    both `tool-call-grader` and `metrics-collector` read `data.toolName`. As a
 *    result every tool call is currently counted as `"unknown"` in
 *    `toolCallBreakdown`, and `tool-calls` graders cannot match on `tool_call`
 *    events (they match on `tool_result`, which does carry `toolName`).
 * 2. `tool_result.data.success` — required by vally's `ToolResultEvent` and
 *    supplied by the SDK's `tool.execution_complete`, but dropped here, so a
 *    grader reading it sees `undefined` (falsy) for every call.
 * 3. `skill_loaded` — not a vally event kind at all; no vally grader or reporter
 *    matches it, so these events are inert. vally models skills as
 *    `skill_activation` with `data.name`.
 *
 * Fixing these flips eval outcomes, so it needs a full suite run to validate and
 * is tracked separately from this conversion.
 */
type ExecutorEvent =
    | { type: "assistant_message"; timestamp: Date; data: { content: string } }
    | { type: "tool_call"; timestamp: Date; data: { toolCallId: string; name: string; arguments: Record<string, unknown> } }
    | { type: "tool_result"; timestamp: Date; data: { toolCallId: string; toolName: string; result: unknown } }
    | { type: "skill_loaded"; timestamp: Date; data: { skills: unknown[] } };

function parseArgs(args: unknown): Record<string, unknown> {
    if (!args) {return {};}
    if (typeof args === "object") {return args as Record<string, unknown>;}
    try {
        const parsed = JSON.parse(args as string);
        return parsed && typeof parsed === "object" ? parsed : { value: parsed };
    } catch {
        // Non-JSON string payloads (e.g. apply_patch patch text). Wrap it so downstream
        // serialization doesn't spread the string into a char-indexed object.
        return { patch: args };
    }
}

/**
 * The subset of the SDK's event shape this converter reads. `rawEvents` is
 * collected as `unknown[]` off the session bus, so rather than asserting at
 * every property access the shape is narrowed once, at the boundary below.
 */
type SdkEvent = {
    type: string;
    timestamp: string | number;
    data?: {
        content?: string;
        toolRequests?: { toolCallId: string; name?: string; arguments?: unknown }[];
        toolCallId?: string;
        toolName?: string;
        name?: string;
        arguments?: unknown;
        result?: { content?: unknown };
        skills?: unknown[];
    };
};

function convertSdkEvent(raw: unknown): ExecutorEvent | ExecutorEvent[] | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const event = raw as SdkEvent;
    switch (event.type) {
        case "assistant.message": {
            const results: ExecutorEvent[] = [];
            if (event.data?.content) {
                results.push({
                    type: "assistant_message",
                    timestamp: new Date(event.timestamp),
                    data: { content: event.data.content },
                });
            }
            if (event.data?.toolRequests) {
                for (const req of event.data.toolRequests) {
                    results.push({
                        type: "tool_call",
                        timestamp: new Date(event.timestamp),
                        data: {
                            toolCallId: req.toolCallId,
                            name: req.name ?? "unknown",
                            arguments: parseArgs(req.arguments),
                        },
                    });
                }
            }
            return results.length === 1 ? results[0] : results.length > 1 ? results : null;
        }
        case "tool.execution_start":
            return {
                type: "tool_call",
                timestamp: new Date(event.timestamp),
                data: {
                    // `?? ""` only satisfies the optional chain; downstream the id is
                    // read behind a truthiness check, so "" and undefined behave alike.
                    toolCallId: event.data?.toolCallId ?? "",
                    name: event.data?.toolName ?? event.data?.name ?? "unknown",
                    arguments: parseArgs(event.data?.arguments),
                },
            };
        case "tool.execution_complete":
            // toolName is NOT present on MCP tool completions — store the toolCallId
            // so the grader can match it to the corresponding tool_call event.
            return {
                type: "tool_result",
                timestamp: new Date(event.timestamp),
                data: {
                    toolCallId: event.data?.toolCallId ?? "",
                    toolName: event.data?.toolName ?? "_pending_lookup_",
                    result: event.data?.result?.content ?? event.data?.result ?? "",
                },
            };
        case "session.skills_loaded":
            return {
                type: "skill_loaded",
                timestamp: new Date(event.timestamp),
                data: { skills: event.data?.skills ?? [] },
            };
        default:
            return null;
    }
}

class AzureAgentExecutor implements Executor {
    name = "azure-agent-executor";
    supportsMultiTurn = true;
    supportsTurnCompletion = false;
    supportsSimulation = false;
    supportsAttachments = false;
    supportsEnvVars = true;

    async execute(stimulus: Stimulus, options: ExecutorOptions): Promise<Trajectory> {
        const startedAt = new Date();
        let skillsLoaded: string[] = [];
        let assistantOutput = "";
        const rawEvents: unknown[] = [];

        const skillDir = buildEvalSkill(repoRoot, AGENT_NAME, path.resolve(scriptDir, "../.generated/skills"));
        const skillDirs = [skillDir];

        // Put the shipped instruction folder (including references/) in the workspace,
        // exactly as the extension writes it to a user's .github/agents.
        const copiedFolders = prepareAgentWorkspace(repoRoot, options.workDir, AGENT_NAME);
        const { model, supported } = resolveEvalModel(repoRoot, AGENT_NAME, options.model);

        process.stderr.write(`[azure-agent-executor] workDir: ${options.workDir}\n`);
        process.stderr.write(`[azure-agent-executor] skillDirs: ${JSON.stringify(skillDirs)}\n`);
        process.stderr.write(`[azure-agent-executor] agent assets: ${copiedFolders.join(", ") || "none"}\n`);
        process.stderr.write(`[azure-agent-executor] model: ${model} (agent supports: ${supported.join(", ")})\n`);

        const client = new CopilotClient({
            workingDirectory: options.workDir,
            connection: RuntimeConnection.forStdio({
                path: getBundledCliPath(),
            }),
            env: {
                ...process.env,
                ...(options.env ?? {}),
            },
        });

        try {
            const session = await client.createSession({
                model,
                onPermissionRequest: approveAll,
                skillDirectories: skillDirs,
                // Registered in-process rather than over MCP: MCP servers are subject to
                // a registry policy the CI token cannot read, which silently blocks them.
                tools: workflowToolDefinitions(),
                streaming: false,
                workingDirectory: options.workDir,
            });

            session.on((event) => {
                rawEvents.push(event);
                if (event.type === "session.skills_loaded") {
                    skillsLoaded = (event.data?.skills ?? []).map(s => s.name);
                }
                options.onRawEvent?.(event);
            });

            const prompts = stimulus.turns ?? [stimulus.prompt];
            for (const prompt of prompts) {
                const result = await session.sendAndWait(prompt, options.timeout);
                if (result?.data?.content) {
                    assistantOutput += result.data.content + "\n";
                }
            }

            await session.disconnect();
        } finally {
            // Shutdown failures are irrelevant once the trial has produced its result.
            await client.stop().catch(() => { /* ignore */ });
        }

        const completedAt = new Date();

        // Build trajectory from events collected via session.on()
        const events: ExecutorEvent[] = [];
        for (const event of rawEvents) {
            const converted = convertSdkEvent(event);
            if (Array.isArray(converted)) {
                events.push(...converted);
            } else if (converted) {
                events.push(converted);
            }
        }

        // Fill in missing toolName on tool_result events by matching toolCallId to tool_call
        const callIdToName = new Map<string, string>();
        for (const e of events) {
            if (e.type === "tool_call" && e.data.toolCallId && e.data.name) {
                callIdToName.set(e.data.toolCallId, e.data.name);
            }
        }
        for (const e of events) {
            if (e.type === "tool_result" && e.data.toolName === "_pending_lookup_") {
                e.data.toolName = callIdToName.get(e.data.toolCallId) ?? "unknown";
            }
        }

        // If no events were captured, create minimal trajectory from sendAndWait output
        if (events.length === 0 && assistantOutput) {
            events.push({
                type: "assistant_message",
                timestamp: completedAt,
                data: { content: assistantOutput.trim() },
            });
        }

        // Single cast at the vally boundary. `ExecutorEvent` documents exactly how
        // these events diverge from `TrajectoryEvent` (see its doc comment); vally
        // tolerates the extra/renamed fields at runtime, it just cannot grade on them.
        const trajectoryEvents = events as unknown as TrajectoryEvent[];
        const metrics = computeMetrics(trajectoryEvents);

        return {
            id: crypto.randomUUID(),
            stimulus,
            events: trajectoryEvents,
            output: assistantOutput.trim() || events.filter(e => e.type === "assistant_message").map(e => e.data.content).join("\n"),
            workDir: options.workDir,
            metadata: {
                startedAt,
                completedAt,
                model,
                executor: this.name,
                skillsLoaded,
                sessionID: "unknown",
            },
            metrics: {
                ...metrics,
                wallTimeMs: completedAt.getTime() - startedAt.getTime(),
            },
        };
    }

    /** Required by the Vally executor interface; each trial already stops its own client. */
    async shutdown(): Promise<void> { /* no-op */ }
}

export function registerExecutors(registry: ExecutorRegistry): void {
    registry.register(new AzureAgentExecutor());
}

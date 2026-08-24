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
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvalSkill, prepareAgentWorkspace, resolveEvalModel } from "./agent-assets.mjs";
import { MCP_SERVER_NAME, mcpServerConfig, waitForMcpServer } from "../mcp/workflow-tools.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const AGENT_NAME = "azure-project-plan";

function getBundledCliPath() {
    const pkgDir = path.resolve(__dirname, "../node_modules/@github/copilot");
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

function parseArgs(args) {
    if (!args) {return {};}
    if (typeof args === "object") {return args;}
    try {
        const parsed = JSON.parse(args);
        return parsed && typeof parsed === "object" ? parsed : { value: parsed };
    } catch {
        // Non-JSON string payloads (e.g. apply_patch patch text). Wrap it so downstream
        // serialization doesn't spread the string into a char-indexed object.
        return { patch: args };
    }
}

function convertSdkEvent(event) {
    switch (event.type) {
        case "assistant.message": {
            const results = [];
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
                    toolCallId: event.data?.toolCallId,
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
                    toolCallId: event.data?.toolCallId,
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

class AzureAgentExecutor {
    name = "azure-agent-executor";
    supportsMultiTurn = true;
    supportsTurnCompletion = false;
    supportsSimulation = false;
    supportsAttachments = false;
    supportsEnvVars = true;

    async execute(stimulus, options) {
        const startedAt = new Date();
        let skillsLoaded = [];
        let assistantOutput = "";
        const rawEvents = [];

        const skillDir = buildEvalSkill(repoRoot, AGENT_NAME, path.resolve(__dirname, "../.generated/skills"));
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
                mcpServers: mcpServerConfig(),
                streaming: false,
                workingDirectory: options.workDir,
            });

            // Must happen before the first prompt: a turn started while the server is
            // still connecting gets a tool list with no gate tools, and never recovers.
            const mcpReady = await waitForMcpServer(session);
            if (!mcpReady.ok) {
                throw new Error(
                    `MCP server '${MCP_SERVER_NAME}' unavailable (${mcpReady.reason}). `
                    + "Gate-tool graders cannot pass without it. Host state: "
                    + JSON.stringify(mcpReady.listing ?? {}),
                );
            }

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
        const events = [];
        for (const event of rawEvents) {
            const converted = convertSdkEvent(event);
            if (Array.isArray(converted)) {
                events.push(...converted);
            } else if (converted) {
                events.push(converted);
            }
        }

        // Fill in missing toolName on tool_result events by matching toolCallId to tool_call
        const callIdToName = new Map();
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

        const metrics = computeMetrics(events);

        return {
            id: crypto.randomUUID(),
            stimulus,
            events,
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
    async shutdown() { /* no-op */ }
}

export function registerExecutors(registry) {
    registry.register(new AzureAgentExecutor());
}

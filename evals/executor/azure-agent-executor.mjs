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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getBundledCliPath() {
    const pkgDir = path.resolve(__dirname, "../node_modules/@github/copilot");
    const candidates = [];
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
        const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.copilot;
        if (bin) candidates.push(bin);
    } catch { /* fall through */ }
    candidates.push("npm-loader.js", "index.js");
    for (const c of candidates) {
        const p = path.resolve(pkgDir, c);
        if (fs.existsSync(p)) return p;
    }
    return path.resolve(pkgDir, "npm-loader.js");
}

function parseArgs(args) {
    if (!args) return {};
    if (typeof args === "object") return args;
    try { return JSON.parse(args); } catch { return {}; }
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
                    arguments: event.data?.arguments ?? {},
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

        const skillDir = path.resolve(__dirname, "../skills/azure-project-plan");
        const skillDirs = fs.existsSync(path.join(skillDir, "SKILL.md")) ? [skillDir] : [];

        // Copy agent instruction files into the workspace so the agent can read them
        const repoRoot = path.resolve(__dirname, "../..");
        const filesToCopy = [
            { src: "resources/agents/azure-project-plan/instructions.md", dest: ".github/agents/azure-project-plan/instructions.md" },
            { src: "resources/agents/azure-project-plan/requirements.md", dest: ".github/agents/azure-project-plan/requirements.md" },
            { src: "resources/agents/azure-project-plan/plan.md", dest: ".github/agents/azure-project-plan/plan.md" },
        ];
        for (const { src, dest } of filesToCopy) {
            const srcPath = path.join(repoRoot, src);
            const destPath = path.join(options.workDir, dest);
            if (fs.existsSync(srcPath)) {
                fs.mkdirSync(path.dirname(destPath), { recursive: true });
                fs.cpSync(srcPath, destPath, { recursive: true });
            }
        }
        // Copy shared-references directory
        const sharedSrc = path.join(repoRoot, "resources/agents/shared-references");
        const sharedDest = path.join(options.workDir, ".github/agents/shared-references");
        if (fs.existsSync(sharedSrc)) {
            fs.cpSync(sharedSrc, sharedDest, { recursive: true });
        }

        process.stderr.write(`[azure-agent-executor] workDir: ${options.workDir}\n`);
        process.stderr.write(`[azure-agent-executor] skillDirs: ${JSON.stringify(skillDirs)}\n`);

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
                model: options.model,
                onPermissionRequest: approveAll,
                skillDirectories: skillDirs,
                mcpServers: {
                    "workflow-tools": {
                        type: "http",
                        url: "http://localhost:" + (process.env.MCP_PORT || "3100") + "/mcp",
                        tools: ["*"],
                    },
                },
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
            await client.stop().catch(() => { });
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
                model: options.model ?? "unknown",
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

    async shutdown() { }
}

export function registerExecutors(registry) {
    registry.register(new AzureAgentExecutor());
}

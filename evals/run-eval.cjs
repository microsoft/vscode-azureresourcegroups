#!/usr/bin/env node
"use strict";

// Run Vally evals locally. Starts the MCP server, runs the eval, shuts down.
// Usage (from repo root):
//   npm run eval
//   npm run eval -- --runs 3
//   npm run eval -- --suite project-plan --runs 5 --model claude-sonnet-5

const { spawn, execSync } = require("child_process");
const path = require("path");

const args = process.argv.slice(2);
const evalsDir = __dirname;
const repoRoot = path.resolve(evalsDir, "..");

// Parse options
let suite = "project-plan";
let runs = "1";
let extraArgs = [];

for (let i = 0; i < args.length; i++) {
    if (args[i] === "--suite" && args[i + 1]) { suite = args[++i]; }
    else if (args[i] === "--runs" && args[i + 1]) { runs = args[++i]; }
    else { extraArgs.push(args[i]); }
}

const evalSpec = path.join(evalsDir, suite, "eval.yaml");
const executorPlugin = path.join(evalsDir, "executor", "azure-agent-executor.mjs");
const outputDir = path.join(repoRoot, "results", `local-${Date.now()}`);
const mcpServer = path.join(evalsDir, "mcp", "workflow-tools-http.cjs");
const port = process.env.MCP_PORT || "3100";

// Kill any existing MCP server on the port
try { execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: "ignore" }); } catch { }

// Start MCP server
console.log(`[run-eval] Starting MCP server on port ${port}...`);
const mcp = spawn("node", [mcpServer], {
    env: { ...process.env, MCP_PORT: port },
    stdio: ["ignore", "pipe", "pipe"],
});
mcp.stderr.on("data", (d) => process.stderr.write(d));

// Wait for server to be ready
let ready = false;
const deadline = Date.now() + 5000;
function waitForServer() {
    return new Promise((resolve, reject) => {
        const check = () => {
            try {
                execSync(`curl -s http://localhost:${port}/health`, { stdio: "ignore" });
                resolve();
            } catch {
                if (Date.now() > deadline) reject(new Error("MCP server failed to start"));
                else setTimeout(check, 200);
            }
        };
        check();
    });
}

async function main() {
    await waitForServer();
    console.log(`[run-eval] MCP server ready. Running eval suite: ${suite}`);
    console.log(`[run-eval] Runs: ${runs}, Output: ${outputDir}`);
    console.log("");

    const vallyArgs = [
        "-y", "@microsoft/vally-cli", "eval",
        "--eval-spec", evalSpec,
        "--executor-plugin", executorPlugin,
        "--output-dir", outputDir,
        "--runs", runs,
        "--verbose",
        ...extraArgs,
    ];

    const vally = spawn("npx", vallyArgs, {
        stdio: "inherit",
        cwd: repoRoot,
    });

    vally.on("close", (code) => {
        mcp.kill();
        console.log(`\n[run-eval] Results saved to: ${outputDir}`);
        process.exit(code || 0);
    });

    process.on("SIGINT", () => {
        vally.kill();
        mcp.kill();
        process.exit(130);
    });
}

main().catch((err) => {
    console.error(`[run-eval] ${err.message}`);
    mcp.kill();
    process.exit(1);
});

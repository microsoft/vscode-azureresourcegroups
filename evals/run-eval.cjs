#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

"use strict";

// Run Vally evals locally. Starts the MCP server, runs the eval, shuts down.
// Usage (from repo root):
//   npm run eval
//   npm run eval -- --runs 3
//   npm run eval -- --suite project-plan --runs 5 --model claude-sonnet-5

const { spawn } = require("child_process");
const path = require("path");

const args = process.argv.slice(2);
const evalsDir = __dirname;
const repoRoot = path.resolve(evalsDir, "..");

// Parse options
let suite = "project-plan";
let runs = "1";
let outputDirArg = null;
let extraArgs = [];

for (let i = 0; i < args.length; i++) {
    if (args[i] === "--suite" && args[i + 1]) { suite = args[++i]; }
    else if (args[i] === "--runs" && args[i + 1]) { runs = args[++i]; }
    else if (args[i] === "--output-dir" && args[i + 1]) { outputDirArg = args[++i]; }
    else { extraArgs.push(args[i]); }
}

const evalSpecTemplate = path.join(evalsDir, suite, "eval.yaml");
const executorPlugin = path.join(evalsDir, "executor", "azure-agent-executor.mjs");
const outputDir = outputDirArg
    ? path.resolve(repoRoot, outputDirArg)
    : path.join(repoRoot, "results", `local-${Date.now()}`);

// Resolve ${REPO_ROOT} (with or without an inline lint default) in the eval spec so
// grader paths are absolute — program graders run with cwd set to the eval workspace.
const fs = require("fs");
const os = require("os");
const evalSpecRaw = fs.readFileSync(evalSpecTemplate, "utf8");
const evalSpecResolved = evalSpecRaw.replace(/\$\{REPO_ROOT(?:=[^}]*)?\}/g, repoRoot);
const evalSpecDir = fs.mkdtempSync(path.join(os.tmpdir(), "vally-eval-spec-"));
const evalSpec = path.join(evalSpecDir, "eval.yaml");
fs.writeFileSync(evalSpec, evalSpecResolved);

// The workflow-tools MCP server is a stdio server launched per-session by the
// Copilot SDK (see evals/executor/azure-agent-executor.mjs) — nothing to start here.

// Use the vally CLI pinned by evals/package.json so local runs and CI agree on a
// version. Fall back to npx (pinned to the same version) when deps aren't installed.
const evalsPkg = JSON.parse(fs.readFileSync(path.join(evalsDir, "package.json"), "utf8"));
const vallyCliVersion = evalsPkg.devDependencies["@microsoft/vally-cli"];
const localVallyBin = path.join(evalsDir, "node_modules", ".bin", "vally");
const useLocalVally = fs.existsSync(localVallyBin);

async function main() {
    console.log(`[run-eval] Running eval suite: ${suite}`);
    console.log(`[run-eval] Runs: ${runs}, Output: ${outputDir}`);
    console.log("");

    const vallyArgs = [
        "eval",
        "--eval-spec", evalSpec,
        "--executor-plugin", executorPlugin,
        "--output-dir", outputDir,
        "--runs", runs,
        "--verbose",
        ...extraArgs,
    ];

    const command = useLocalVally ? localVallyBin : "npx";
    const commandArgs = useLocalVally
        ? vallyArgs
        : ["-y", `@microsoft/vally-cli@${vallyCliVersion}`, ...vallyArgs];

    const vally = spawn(command, commandArgs, {
        stdio: "inherit",
        cwd: repoRoot,
    });

    vally.on("close", (code) => {
        console.log(`\n[run-eval] Results saved to: ${outputDir}`);
        // Generate readable diagnostics from the latest timestamped subfolder
        try {
            const subs = require("fs").readdirSync(outputDir).filter(d => d.match(/^\d{4}-/)).sort();
            if (subs.length) {
                const latest = path.join(outputDir, subs[subs.length - 1]);
                require("child_process").execFileSync("node", [path.join(evalsDir, "generate-report.cjs"), latest], { stdio: "inherit" });
            }
        } catch { /* best-effort */ }
        process.exit(code || 0);
    });

    process.on("SIGINT", () => {
        vally.kill();
        process.exit(130);
    });
}

main().catch((err) => {
    console.error(`[run-eval] ${err.message}`);
    process.exit(1);
});

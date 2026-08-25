#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Run the eval CI job locally, in a container that matches the GitHub runner.
 *
 * The evals kept passing locally and failing in CI because a dev machine differs from
 * a runner in ways the suite is sensitive to: a personal `~/.copilot` config, a
 * different OS and CPU architecture, an already-populated `node_modules`, and a
 * different Copilot token. This runs the real workflow steps — parsed out of
 * `.github/workflows/agent-contracts.yml`, so they cannot drift from what CI does — on
 * linux/amd64 with a clean HOME and a fresh `npm ci`.
 *
 * These are the credential-free gates. Running the agent itself now happens on MSBench
 * (`.github/workflows/msbench-evals.yml`), which needs an Entra identity rather than a
 * GitHub token and so cannot be reproduced by this script; use `evals/msbench/run.sh`.
 *
 * Usage:
 *   node evals/ci-local.mjs                 # every cheap gate (seconds-to-minutes)
 *   node evals/ci-local.mjs --merge         # first merge the PR base, as CI does
 *   node evals/ci-local.mjs --job contracts
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const WORKFLOW = ".github/workflows/agent-contracts.yml";
const IMAGE_NODE = "22";

const args = process.argv.slice(2);
const hasFlag = name => args.includes(`--${name}`);
const flagValue = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const withEvals = hasFlag("with-evals");
const useMerge = hasFlag("merge");
const jobName = flagValue("job", "contracts");

// The one step that costs real model calls and ~15 minutes; opt in explicitly.
const EXPENSIVE_STEP = /Run .*evals$/;

function run(cmd, cmdArgs, opts = {}) {
    return spawnSync(cmd, cmdArgs, { encoding: "utf8", ...opts });
}

function die(message, hint) {
    console.error(`\n✖ ${message}`);
    if (hint) {console.error(`\n${hint}`);}
    process.exit(1);
}

function resolveToken() {
    if (process.env.COPILOT_GITHUB_TOKEN) {
        return { token: process.env.COPILOT_GITHUB_TOKEN, source: "COPILOT_GITHUB_TOKEN" };
    }
    const gh = run("gh", ["auth", "token"]);
    if (gh.status === 0 && gh.stdout.trim()) {
        return { token: gh.stdout.trim(), source: "gh auth token" };
    }
    // No step in the contracts job needs a token, so this is not fatal. If a step ever
    // does reference one, resolveExpression throws rather than running with an empty
    // value — a missing token must never look like a passing gate.
    return { token: null, source: "none (no contracts step requires one)" };
}

/**
 * Resolve the `${{ ... }}` expressions this workflow actually uses.
 *
 * Deliberately narrow: an unrecognised expression throws instead of resolving to an
 * empty string, so a step cannot quietly run with different inputs than it gets in CI.
 */
function resolveExpression(raw, token) {
    const expr = raw.trim().replace(/^\$\{\{\s*/, "").replace(/\s*\}\}$/, "");
    if (/^secrets\.\w+\s*\|\|\s*github\.token$/.test(expr)) {return token;}
    if (expr === "github.token") {return token;}
    if (expr === "env.NODE_VERSION") {return IMAGE_NODE;}
    throw new Error(`Unsupported workflow expression: ${raw}`);
}

function loadSteps(token) {
    const file = path.join(repoRoot, WORKFLOW);
    if (!fs.existsSync(file)) {die(`Workflow not found: ${WORKFLOW}`);}
    const workflow = parseYaml(fs.readFileSync(file, "utf8"));
    const job = workflow.jobs?.[jobName];
    if (!job) {
        die(
            `Job '${jobName}' not found in ${WORKFLOW}.`,
            `  Available: ${Object.keys(workflow.jobs ?? {}).join(", ")}`,
        );
    }
    return (job.steps ?? [])
        .filter(step => typeof step.run === "string")
        .map(step => ({
            name: step.name ?? step.run.split("\n")[0],
            run: step.run,
            workingDirectory: step["working-directory"] ?? ".",
            env: Object.fromEntries(
                Object.entries(step.env ?? {}).map(([k, v]) => [
                    k,
                    typeof v === "string" && v.includes("${{") ? resolveExpression(v, token) : String(v),
                ]),
            ),
        }));
}

/** Stage the tree CI would see. Uses the working tree so unpushed edits are covered. */
function stageSource() {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "ci-local-src-"));
    const tar = run("bash", [
        "-c",
        // Exclude installed deps and results so the container does a real cold install.
        `tar -C "${repoRoot}" --exclude=node_modules --exclude=results --exclude=.git -cf - . | tar -C "${dest}" -xf -`,
    ]);
    if (tar.status !== 0) {die(`Failed to stage sources: ${tar.stderr}`);}
    return dest;
}

/**
 * Merge the PR base into the staged tree, the way CI grades a merge commit.
 *
 * A moving base branch shows up as failures in files the PR never touched, which is
 * hard to recognise from a red check alone.
 */
function applyMerge(sourceDir) {
    const base = run("bash", [
        "-c",
        `cd "${repoRoot}" && git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true`,
    ]).stdout.trim();

    const workflowBases = ["origin/feat/CoR", "origin/main"];
    const candidate = workflowBases.find(ref =>
        run("bash", ["-c", `cd "${repoRoot}" && git rev-parse --verify -q ${ref}`]).status === 0);
    if (!candidate) {
        die("Could not find a base branch to merge.", "  Tried: " + workflowBases.join(", "));
    }

    console.log(`  merging ${candidate} into the staged tree (upstream: ${base || "none"})`);
    const merged = run("bash", [
        "-c",
        `cd "${sourceDir}" && git init -q . && git add -A && `
        + `git -c user.email=ci@local -c user.name=ci commit -qm staged && `
        + `git remote add origin "${repoRoot}" && git fetch -q origin && `
        + `git -c user.email=ci@local -c user.name=ci merge --no-edit -q ${candidate.replace("origin/", "origin/")} 2>&1`,
    ]);
    if (merged.status !== 0) {
        die(
            "Merging the base branch produced conflicts.",
            `  CI would hit the same conflicts. Resolve them locally first.\n\n${merged.stdout}${merged.stderr}`,
        );
    }
    fs.rmSync(path.join(sourceDir, ".git"), { recursive: true, force: true });
}

function buildScript(steps, token) {
    const lines = [
        "set -uo pipefail",
        'export GITHUB_WORKSPACE=/work',
        'export GITHUB_PATH=/tmp/github_path',
        'export CI=true GITHUB_ACTIONS=true',
        // A clean HOME is the point: a personal ~/.copilot must not change the result.
        'export HOME=/tmp/clean-home',
        "mkdir -p \"$HOME\" && : > \"$GITHUB_PATH\"",
        'FAILED=""',
        "",
    ];

    for (const step of steps) {
        const skip = !withEvals && EXPENSIVE_STEP.test(step.name);
        const label = step.name.replace(/"/g, '\\"');
        if (skip) {
            lines.push(`echo "── SKIP  ${label} (use --with-evals)"`);
            continue;
        }
        lines.push(`echo ""`, `echo "── STEP  ${label}"`);
        lines.push(`(`);
        lines.push(`  cd "/work/${step.workingDirectory}" || exit 1`);
        for (const [key, value] of Object.entries(step.env)) {
            lines.push(`  export ${key}=${JSON.stringify(value)}`);
        }
        lines.push(`  ${step.run.trim().split("\n").join("\n  ")}`);
        lines.push(`)`);
        lines.push(`if [ $? -ne 0 ]; then echo "   ✖ FAILED: ${label}"; FAILED="$FAILED\\n   - ${label}"; fi`);
        // Emulate the runner's GITHUB_PATH so `vally` resolves in later steps.
        lines.push(`if [ -s "$GITHUB_PATH" ]; then export PATH="$(paste -sd: "$GITHUB_PATH"):$PATH"; : > "$GITHUB_PATH"; fi`);
    }

    lines.push(
        "",
        'echo ""',
        'if [ -n "$FAILED" ]; then',
        '  echo "══ FAILED STEPS ══"; printf "%b\\n" "$FAILED"; exit 1',
        "fi",
        'echo "══ all steps passed ══"',
    );
    return lines.join("\n");
}

const { token, source: tokenSource } = resolveToken();

if (run("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    die(
        "Docker is not available.",
        "  This runs the CI steps in a linux/amd64 container to match the runner.\n"
        + "  Start Docker, or run the individual checks directly:\n"
        + "    (cd evals && npm run drift && npm run typecheck && npm run certify && npm run lint)",
    );
}

const steps = loadSteps(token);
console.log(`Job:    ${jobName} (${steps.length} runnable steps from ${WORKFLOW})`);
console.log(`Token:  ${tokenSource}`);
console.log(`Evals:  ${withEvals ? "included (slow, real model calls)" : "skipped (--with-evals to include)"}`);

console.log("Source: staging working tree…");
const sourceDir = stageSource();
if (useMerge) {applyMerge(sourceDir);}

const scriptPath = path.join(sourceDir, ".ci-local-steps.sh");
fs.writeFileSync(scriptPath, buildScript(steps, token));

console.log(`Runner: node:${IMAGE_NODE} on linux/amd64, clean HOME, cold npm ci\n`);

const result = spawnSync("docker", [
    "run", "--rm",
    "--platform", "linux/amd64",
    "-e", `COPILOT_GITHUB_TOKEN=${token}`,
    "-v", `${sourceDir}:/work`,
    "-w", "/work",
    `node:${IMAGE_NODE}`,
    "bash", "/work/.ci-local-steps.sh",
], { stdio: "inherit" });

fs.rmSync(sourceDir, { recursive: true, force: true });

if (result.status !== 0) {
    console.error(
        "\nThis is what CI will do. One caveat: CI authenticates as the Actions token,\n"
        + "so Copilot policy (for example the MCP registry policy) can still differ from\n"
        + "your token here.",
    );
    process.exit(result.status ?? 1);
}

console.log(
    "\nMatches CI for everything reproducible locally. Not covered: the Actions token's\n"
    + "identity and any Copilot policy tied to it.",
);

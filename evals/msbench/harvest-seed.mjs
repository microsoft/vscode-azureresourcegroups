#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Promotes a finished `seed-plan-*` MSBench run into the scaffold suites' starting workspace.
 *
 * The scaffold agent's first action is to read `.azure/project-plan.md`, so something has to
 * put one there. Checking one in makes that document a second source of truth: edit the
 * planner's template and the stored copy still describes the old shape, so the scaffold
 * graders keep passing against a plan no agent would emit.
 *
 * This replaces the previous SDK-driven generator. Both produce a real plan, but the SDK
 * drives Copilot CLI headlessly and behaves differently from the VS Code harness the scaffold
 * suites are measured in, so the seed was produced under one runtime and consumed under
 * another. Harvesting from an MSBench run keeps producer and consumer on the same harness.
 *
 * Two properties keep the harvested seed trustworthy, and both are enforced below:
 *
 *   1. It is *validated, not trusted*. The seed suite runs the planner's own contract
 *      graders, and this script refuses to promote a run whose assertions did not all pass.
 *      A broken planner fails here instead of becoming input that bakes the break in.
 *   2. It is an *input, not an expected answer*. No scaffold grader reads the plan -- they
 *      assert against `resources/agents/**`. A wrong plan therefore makes scaffold trials
 *      fail loudly; it cannot make them pass wrongly.
 *
 * Usage:
 *   node evals/msbench/harvest-seed.mjs --run-id <id> --target fullstack
 *   node evals/msbench/harvest-seed.mjs --run-id <id> --target api-only
 *   node evals/msbench/harvest-seed.mjs --extract-dir ./run_logs --target fullstack
 *   node evals/msbench/harvest-seed.mjs --check      # report seed freshness, exit 1 if stale
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const msbenchDir = __dirname;
const evalsDir = path.resolve(msbenchDir, "..");
const repoRoot = path.resolve(evalsDir, "..");
const agentsRoot = path.join(repoRoot, "resources", "agents");
const outputRoot = path.join(evalsDir, ".generated", "scaffold-input");
const stampPath = path.join(outputRoot, "stamp.json");

/**
 * One seed run feeds more than one scaffold suite. `approved-fullstack` and
 * `unapproved-plan` deliberately come from the *same* run: the pair is only falsifiable if
 * the sole difference is the approval status, so the scaffold agent cannot pass both by
 * keying off anything else in the document.
 */
const TARGETS = {
    fullstack: [
        { name: "approved-fullstack", status: "Approved" },
        { name: "unapproved-plan", status: "Planning" },
    ],
    "api-only": [
        { name: "approved-api-only", status: "Approved" },
    ],
};

const ALL_TARGET_NAMES = Object.values(TARGETS).flat().map(t => t.name);

function die(message) {
    process.stderr.write(`ERROR: ${message}\n`);
    process.exit(1);
}

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
}

function listFiles(root) {
    const out = [];
    if (!fs.existsSync(root)) {
        return out;
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
            out.push(...listFiles(full));
        } else {
            out.push(full);
        }
    }
    return out.sort();
}

function hashAgentAssets() {
    const hash = createHash("sha256");
    for (const file of listFiles(agentsRoot)) {
        hash.update(path.relative(agentsRoot, file).split(path.sep).join("/"));
        hash.update(fs.readFileSync(file));
    }
    return hash.digest("hex");
}

/**
 * An older stamp format stored `targets` as an array of names. Normalizing here rather
 * than trusting the file matters: assigning a named key onto an array survives in memory
 * but is dropped by JSON.stringify, so a stale stamp would silently discard every record
 * it was handed and leave the seed permanently "stale" with no error.
 */
function readStamp() {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(stampPath, "utf8"));
    } catch {
        return { targets: {} };
    }
    const targets = parsed?.targets;
    const usable = typeof targets === "object" && targets !== null && !Array.isArray(targets);
    return { targets: usable ? targets : {} };
}

function copyDirectory(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dest = path.join(to, entry.name);
        if (entry.isDirectory()) {
            copyDirectory(src, dest);
        } else if (entry.isFile()) {
            fs.copyFileSync(src, dest);
        }
    }
}

/**
 * Approval is a *human* action -- the reviewer clicks Approve in the plan webview, and
 * `ScaffoldPlanViewController.approvePlan` flips the status row from extension code before
 * launching the scaffold agent. The planner itself only ever writes `Planning`. Rewriting
 * that one row simulates the reviewer, not the agent, so the scaffold suite still receives
 * genuine planner output everywhere else.
 */
function setStatus(planPath, status) {
    const original = fs.readFileSync(planPath, "utf8");
    const updated = original.replace(/^\*\*Status\*\*:.*$/m, `**Status**: ${status}`);
    if (updated === original && !new RegExp(`^\\*\\*Status\\*\\*:\\s*${status}\\s*$`, "m").test(original)) {
        throw new Error(`${planPath} has no '**Status**:' row to set to ${status}.`);
    }
    fs.writeFileSync(planPath, updated);
}

/**
 * Guards the properties the scaffold stimuli rely on but the planner's own graders do not
 * check. Without these a technically-valid plan that happens to omit the UI would make every
 * frontend grader vacuous, turning the suite green by making it test nothing.
 */
function assertUsableAsScaffoldInput(target, azureDir) {
    const plan = fs.readFileSync(path.join(azureDir, "project-plan.md"), "utf8");
    const problems = [];

    if (!/^\*\*Status\*\*:\s*\S+/m.test(plan)) {
        problems.push("plan has no '**Status**:' metadata row");
    }
    const routes = [...plan.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\b[^\n]*?\/[A-Za-z0-9{}:_\-/]*/g)];
    if (routes.length < 2) {
        problems.push(`plan lists ${routes.length} API route(s); the scaffold suite needs at least 2`);
    }

    const wantsFrontend = target.name !== "approved-api-only";
    const hasPreviewTemp = fs.existsSync(path.join(azureDir, ".preview-temp"));
    if (wantsFrontend && !hasPreviewTemp) {
        problems.push("plan produced no '.azure/.preview-temp/', so the frontend and cleanup graders would be vacuous");
    }
    if (!wantsFrontend && hasPreviewTemp) {
        problems.push("API-only plan produced '.azure/.preview-temp/', so it is not actually a no-UI plan");
    }

    if (problems.length > 0) {
        throw new Error(`${target.name}: harvested plan is unusable as scaffold input:\n  - ${problems.join("\n  - ")}`);
    }
}

function findFile(root, name) {
    for (const file of listFiles(root)) {
        if (path.basename(file) === name) {
            return file;
        }
    }
    return undefined;
}

/**
 * `eval.json` is `{ "<instance>": { resolved, details: [{comment, passed, error}] } }`.
 * Every assertion must have passed -- including the liveness sentinel, which is what stops
 * a rate-limited run (empty session database, so every negative check is vacuously true)
 * from being promoted into every scaffold suite.
 */
function assertRunPassed(evalJsonPath) {
    const parsed = JSON.parse(fs.readFileSync(evalJsonPath, "utf8"));
    const failures = [];
    for (const [instance, result] of Object.entries(parsed)) {
        for (const detail of result?.details ?? []) {
            if (!detail.passed) {
                failures.push(`${instance}: ${detail.comment ?? detail.query ?? "<unnamed>"}${detail.error ? ` -- ${detail.error}` : ""}`);
            }
        }
        if ((result?.details ?? []).length === 0) {
            failures.push(`${instance}: no assertions were recorded`);
        }
    }
    if (failures.length > 0) {
        die(`The seed run did not pass its own contract graders, so it cannot be promoted:\n  - ${failures.join("\n  - ")}\n\n`
            + `  Fix the planning agent (or re-run) rather than checking in a stored plan.`);
    }
}

/**
 * Rebuild `.azure/` from the run's `patch.diff`. The diff is written from disk, so unlike
 * the session database it survives a run that was cut short. Applying it into an empty
 * repository yields exactly the files the planner created.
 */
function extractAzureDir(patchPath) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "harvest-seed-"));
    const git = (...args) => spawnSync("git", ["-C", work, ...args], { encoding: "utf8" });

    if (git("init", "--quiet").status !== 0) {
        die(`Could not create a scratch repository in ${work}.`);
    }
    const applied = git("apply", "--include=.azure/*", "--include=.azure/**", patchPath);
    if (applied.status !== 0) {
        process.stderr.write(applied.stderr ?? "");
        die(`Could not apply '${patchPath}'. The run may have produced no .azure/ changes.`);
    }

    const azureDir = path.join(work, ".azure");
    if (!fs.existsSync(path.join(azureDir, "project-plan.md"))) {
        die(`'${patchPath}' contains no '.azure/project-plan.md'. The planner did not write a plan.`);
    }
    return azureDir;
}

function extractRun(runId) {
    const cli = process.env.MSBENCH_CLI
        ?? path.join(os.homedir(), ".msbench-venv", "bin", "msbench-cli");
    if (!fs.existsSync(cli)) {
        die(`msbench-cli not found at ${cli}. Run ./evals/msbench/run.sh once to install it, `
            + `or set MSBENCH_CLI, or pass --extract-dir for an already-extracted run.`);
    }
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "harvest-run-"));
    const result = spawnSync(cli, ["extract", "--run_id", runId, "--output", out], { stdio: "inherit" });
    if (result.status !== 0) {
        die(`'msbench-cli extract --run_id ${runId}' failed.`);
    }
    return out;
}

function reportFreshness() {
    const stamp = readStamp();
    const currentHash = hashAgentAssets();
    const stale = [];

    for (const name of ALL_TARGET_NAMES) {
        const present = fs.existsSync(path.join(outputRoot, name, ".azure", "project-plan.md"));
        const entry = stamp?.targets?.[name];
        if (!present) {
            stale.push(`${name}: missing`);
        } else if (entry?.agentAssetsHash !== currentHash) {
            stale.push(`${name}: generated against different resources/agents/`);
        }
    }

    if (stale.length === 0) {
        console.log("[harvest-seed] scaffold input is present and up to date with resources/agents/.");
        return 0;
    }
    process.stderr.write(`[harvest-seed] scaffold input is missing or stale:\n  - ${stale.join("\n  - ")}\n\n`
        + `  Run the seed suites, then harvest them (from the repo root):\n`
        + `      ./evals/msbench/run.sh --suite seed-plan-fullstack\n`
        + `      node evals/msbench/harvest-seed.mjs --run-id <id> --target fullstack\n`
        + `      ./evals/msbench/run.sh --suite seed-plan-api-only\n`
        + `      node evals/msbench/harvest-seed.mjs --run-id <id> --target api-only\n`);
    return 1;
}

/**
 * A seed harvested against different agent assets is worse than no seed: the scaffold
 * suites would silently measure the current agent against a plan the previous one wrote.
 * Exported so stage.mjs can refuse to stage a stale seed rather than only a missing one.
 */
export function assertSeedFresh(name) {
    const entry = readStamp()?.targets?.[name];
    if (entry?.agentAssetsHash !== hashAgentAssets()) {
        throw new Error(
            `The scaffold input '${name}' was harvested against a different resources/agents/.\n`
            + `  Re-run the seed suite and harvest it (from the repo root):\n\n`
            + `      ./evals/msbench/run.sh --suite seed-plan-fullstack\n`
            + `      node evals/msbench/harvest-seed.mjs --run-id <id> --target fullstack`);
    }
}

function main() {
    if (process.argv.includes("--check")) {
        process.exit(reportFreshness());
    }

    const target = arg("--target");
    if (target === undefined || !(target in TARGETS)) {
        die(`Pass --target with one of: ${Object.keys(TARGETS).join(", ")}.`);
    }

    const runId = arg("--run-id");
    const providedDir = arg("--extract-dir");
    if (runId === undefined && providedDir === undefined) {
        die("Pass --run-id <id> (extracts the run) or --extract-dir <dir> (already extracted).");
    }

    const extractDir = providedDir ?? extractRun(runId);

    const evalJson = findFile(extractDir, "eval.json");
    if (evalJson === undefined) {
        die(`No 'eval.json' under ${extractDir}. Is this a finished MSBench run?`);
    }
    assertRunPassed(evalJson);

    const patch = findFile(extractDir, "patch.diff");
    if (patch === undefined) {
        die(`No 'patch.diff' under ${extractDir}, so there is no workspace to harvest.`);
    }
    const azureDir = extractAzureDir(patch);

    const currentHash = hashAgentAssets();
    const stamp = readStamp();

    for (const entry of TARGETS[target]) {
        const destination = path.join(outputRoot, entry.name, ".azure");
        fs.rmSync(path.dirname(destination), { recursive: true, force: true });
        copyDirectory(azureDir, destination);
        setStatus(path.join(destination, "project-plan.md"), entry.status);
        assertUsableAsScaffoldInput(entry, destination);
        stamp.targets[entry.name] = {
            agentAssetsHash: currentHash,
            runId: runId ?? null,
            harvestedAt: new Date().toISOString(),
        };
        console.log(`[harvest-seed] ${entry.name} ← ${target} run (Status: ${entry.status})`);
    }

    fs.mkdirSync(outputRoot, { recursive: true });
    fs.writeFileSync(stampPath, `${JSON.stringify(stamp, undefined, 4)}\n`);
    console.log(`[harvest-seed] wrote scaffold input to ${path.relative(repoRoot, outputRoot)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}

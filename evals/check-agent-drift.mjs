#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Guards the shipped agent instructions against silent drift away from the evals.
 *
 * The evals no longer restate any workflow rule — the graders assert behaviour that
 * only `resources/agents/**` can produce. That is the right design, but it means a
 * rule deleted from the instructions shows up as a puzzling eval failure 20 minutes
 * into a run. This check fails immediately instead, naming the contract and the
 * grader that depends on it.
 *
 * Usage:
 *   node evals/check-agent-drift.mjs            # verify contracts + asset hash
 *   node evals/check-agent-drift.mjs --update   # accept current assets as the new baseline
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const agentsRoot = path.join(repoRoot, "resources", "agents");
const lockPath = path.join(__dirname, "agent-assets.lock.json");
const update = process.argv.includes("--update");

const PLAN = "azure-project-plan";

/**
 * Each contract is a rule the graders rely on. `pattern` must still match the
 * shipped file; `grader` names what breaks when it doesn't.
 */
const contracts = [
    {
        file: `${PLAN}.agent.md`,
        name: "skill-frontmatter",
        pattern: /^---\r?\n[\s\S]*?^name:\s*azure-project-plan\s*$[\s\S]*?^description:\s*\S[\s\S]*?^---/m,
        grader: "evals/executor/agent-assets.mjs generates SKILL.md from this frontmatter",
    },
    {
        file: `${PLAN}.agent.md`,
        name: "requirements-filename",
        pattern: /`\.azure\/requirements\.json`/,
        grader: "file-exists / no-dotfile-requirements",
    },
    {
        file: `${PLAN}/requirements.md`,
        name: "functions-implies-blob-storage",
        pattern: /Azure Functions[^\n]*Blob Storage|Blob Storage[^\n]*Functions requires a storage account/,
        grader: "requirements-api-only (--assert-blob-storage)",
    },
    {
        file: `${PLAN}/requirements.md`,
        name: "media-implies-blob-storage",
        pattern: /files, photos, images, uploads[^\n]*Blob Storage/,
        grader: "requirements-schema-valid (photo-app-requirements)",
    },
    {
        file: `${PLAN}.agent.md`,
        name: "frontend-only-activation",
        // The skill description is the activation gate. Without frontend-only /
        // no-backend triggers the agent hand-writes index.html instead of planning.
        pattern: /^description:[^\n]*(frontend-only|frontend only)[^\n]*$/mi,
        grader: "no-datastore-converter (file-exists, opens-requirements-view)",
    },
    {
        file: `${PLAN}.agent.md`,
        name: "no-request-too-simple",
        pattern: /no request is ["“]?too simple["”]? to plan/i,
        grader: "no-datastore-converter (file-exists, opens-requirements-view)",
    },
    {
        file: `${PLAN}/instructions.md`,
        name: "frontend-only-trigger",
        pattern: /No request is too small to plan/i,
        grader: "no-datastore-converter (file-exists, opens-requirements-view)",
    },
    {
        file: `${PLAN}/requirements.md`,
        name: "no-datastore-option",
        pattern: /`?No datastore required`?/,
        grader: "requirements-no-datastore (--assert-no-datastore)",
    },
    {
        file: `${PLAN}/requirements.md`,
        name: "frontend-language-options",
        pattern: /frontend services offer only `TypeScript` \/ `JavaScript`/,
        grader: "requirements-schema-valid (frontend language options)",
    },
    {
        file: `${PLAN}/requirements.md`,
        name: "allow-freeform-input-rules",
        pattern: /allowFreeformInput/,
        grader: "requirements-schema-valid (allowFreeformInput per question type)",
    },
    {
        file: `${PLAN}/plan.md`,
        name: "plan-metadata-rows",
        pattern: /\*\*Status\*\*[\s\S]{0,120}\*\*Created\*\*[\s\S]{0,120}\*\*Mode\*\*/,
        grader: "plan-structure-valid / plan-webview-parseable",
    },
    {
        file: `${PLAN}/plan.md`,
        name: "design-system-section",
        pattern: /Design System & UI/,
        grader: "plan-structure-valid (Section 6 title)",
    },
    {
        file: `${PLAN}/plan.md`,
        name: "component-library-row",
        pattern: /\*\*Component Library\*\*:/,
        grader: "plan-structure-valid (Component Library row)",
    },
    {
        file: `${PLAN}/plan.md`,
        name: "health-route",
        pattern: /`?\/api\/health`?/,
        grader: "plan-structure-valid (Route Definitions)",
    },
];

/**
 * Rules that must hold across every file for the agent, not just one. These catch
 * two shipped files contradicting each other — the failure mode that made the old
 * hand-written eval skill necessary in the first place.
 */
const consistencyRules = [
    {
        name: "never-instructs-vscode-askquestions",
        // Matches an instruction to USE the tool, not the (correct) prohibitions.
        pattern: /(?<!not |NOT |never |Never |no )\buse `vscode_askQuestions`/,
        message: "A shipped file instructs the agent to USE vscode_askQuestions, but the eval "
            + "(and the extension's webview flow) forbid it. Every gate must go through a webview.",
    },
];

function listFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {out.push(...listFiles(full));}
        else {out.push(full);}
    }
    return out.sort();
}

function hashFile(file) {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function agentAssetFiles() {
    const out = {};
    for (const file of listFiles(agentsRoot)) {
        out[path.relative(agentsRoot, file).split(path.sep).join("/")] = hashFile(file);
    }
    return out;
}

function hashAgentAssets() {
    // Unchanged from the original: relative path + raw bytes, so baselines
    // recorded before per-file diagnostics existed stay valid.
    const hash = createHash("sha256");
    for (const file of listFiles(agentsRoot)) {
        hash.update(path.relative(agentsRoot, file).split(path.sep).join("/"));
        hash.update(fs.readFileSync(file));
    }
    return hash.digest("hex");
}

/**
 * Name the files behind a hash mismatch.
 *
 * The aggregate hash says only that something moved, which on a pull request is
 * usually the base branch shifting under you rather than an edit you made. Listing
 * the paths turns an opaque mismatch into an actionable diff.
 */
function describeAssetChanges(baseline, current) {
    if (!baseline) {
        return [];
    }
    const names = new Set([...Object.keys(baseline), ...Object.keys(current)]);
    const changes = [];
    for (const name of [...names].sort()) {
        if (!(name in current)) {changes.push(`removed:  ${name}`);}
        else if (!(name in baseline)) {changes.push(`added:    ${name}`);}
        else if (baseline[name] !== current[name]) {changes.push(`modified: ${name}`);}
    }
    return changes;
}

const failures = [];
const checked = [];

for (const contract of contracts) {
    const filePath = path.join(agentsRoot, contract.file);
    if (!fs.existsSync(filePath)) {
        failures.push(`${contract.name}: ${contract.file} is missing (needed by ${contract.grader})`);
        continue;
    }
    const body = fs.readFileSync(filePath, "utf8");
    if (contract.pattern.test(body)) {
        checked.push(`${contract.name} (${contract.file})`);
    } else {
        failures.push(
            `${contract.name}: ${contract.file} no longer states this contract.\n`
            + `    Expected to match: ${contract.pattern}\n`
            + `    Depended on by:    ${contract.grader}`,
        );
    }
}

const agentFiles = listFiles(agentsRoot).filter(f => f.endsWith(".md") && f.includes(PLAN));
for (const rule of consistencyRules) {
    const offenders = agentFiles.filter(f => rule.pattern.test(fs.readFileSync(f, "utf8")));
    if (offenders.length) {
        failures.push(
            `${rule.name}: ${rule.message}\n`
            + offenders.map(f => `    ${path.relative(repoRoot, f)}`).join("\n"),
        );
    } else {
        checked.push(rule.name);
    }
}

const currentHash = hashAgentAssets();
const currentFiles = agentAssetFiles();
const previous = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, "utf8")) : null;

if (update) {
    fs.writeFileSync(lockPath, `${JSON.stringify({
        agentAssetsHash: currentHash,
        updatedAt: new Date().toISOString(),
        files: currentFiles,
    }, null, 4)}\n`);
    console.log(`Baseline updated: ${currentHash}`);
} else if (previous && previous.agentAssetsHash !== currentHash) {
    const changes = describeAssetChanges(previous.files, currentFiles);
    const detail = changes.length
        ? `    Changed files (${changes.length}):\n${changes.map(c => `      ${c}`).join("\n")}\n`
        : "    Baseline predates per-file tracking, so the changed files can't be named.\n"
        + "    Re-running --update will record them for next time.\n";
    failures.push(
        "agent-assets-changed: resources/agents/** changed since the evals were last verified.\n"
        + `    baseline: ${previous.agentAssetsHash}\n`
        + `    current:  ${currentHash}\n`
        + detail
        + "    On a pull request this often means the base branch moved rather than\n"
        + "    that you edited these files — check `git log` on the base before assuming.\n"
        + "    Re-run the evals against the new instructions, then run:\n"
        + "      node evals/check-agent-drift.mjs --update",
    );
}

if (failures.length) {
    console.error(`\n✖ Agent instruction drift detected (${failures.length} issue(s)):\n`);
    for (const failure of failures) {console.error(`  - ${failure}\n`);}
    process.exit(1);
}

console.log(`✔ ${checked.length} agent contracts intact; assets match the verified baseline.`);

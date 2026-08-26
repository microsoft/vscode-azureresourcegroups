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
 *   node evals/check-agent-drift.ts            # verify contracts + asset hash
 *   node evals/check-agent-drift.ts --update   # accept current assets as the new baseline
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { listEvalAssetFiles, readSupportedModels } from "./src/agent-definition.ts";

const scriptDir = import.meta.dirname;
const repoRoot = path.resolve(scriptDir, "..");
const agentsRoot = path.join(repoRoot, "resources", "agents");
const lockPath = path.join(scriptDir, "agent-assets.lock.json");
const update = process.argv.includes("--update");

const PLAN = "azure-project-plan";

/** A rule the graders rely on, asserted against one shipped file. */
interface Contract {
    /** Path under `resources/agents`. */
    file: string;
    name: string;
    /** Must still match the shipped file. */
    pattern: RegExp;
    /** What breaks when the pattern stops matching. */
    grader: string;
}

/** A rule that must hold across every shipped file for the agent. */
interface ConsistencyRule {
    name: string;
    pattern: RegExp;
    message: string;
}

/** The `agent-assets.lock.json` baseline. */
interface AssetBaseline {
    agentAssetsHash: string;
    scope?: string;
    updatedAt: string;
    files?: Record<string, string>;
}

/**
 * Each contract is a rule the graders rely on. `pattern` must still match the
 * shipped file; `grader` names what breaks when it doesn't.
 */
const contracts: Contract[] = [
    {
        file: `${PLAN}.agent.md`,
        name: "skill-frontmatter",
        pattern: /^---\r?\n[\s\S]*?^name:\s*azure-project-plan\s*$[\s\S]*?^description:\s*\S[\s\S]*?^---/m,
        grader: "evals/src/agent-definition.ts reads the agent from this frontmatter",
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
const consistencyRules: ConsistencyRule[] = [
    {
        name: "never-instructs-vscode-askquestions",
        // Matches an instruction to USE the tool, not the (correct) prohibitions.
        pattern: /(?<!not |NOT |never |Never |no )\buse `vscode_askQuestions`/,
        message: "A shipped file instructs the agent to USE vscode_askQuestions, but the eval "
            + "(and the extension's webview flow) forbid it. Every gate must go through a webview.",
    },
];

function listFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {out.push(...listFiles(full));}
        else {out.push(full);}
    }
    return out.sort();
}

function hashFile(file: string): string {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * The tracked assets, as repo-relative paths under `resources/agents`.
 *
 * Scoped to what the evals actually load (see listEvalAssetFiles) rather than the
 * whole agents tree, so a change to an agent this suite never runs can't fail it.
 */
const SCOPE = `${PLAN}.agent.md, ${PLAN}/**, shared-references/**`;

function trackedFiles(): string[] {
    return listEvalAssetFiles(repoRoot, PLAN);
}

function agentAssetFiles(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of trackedFiles()) {
        out[name] = hashFile(path.join(agentsRoot, name));
    }
    return out;
}

function hashAgentAssets(): string {
    // Relative path + raw bytes, in sorted order, so the hash is stable across platforms.
    const hash = createHash("sha256");
    for (const name of trackedFiles()) {
        hash.update(name);
        hash.update(fs.readFileSync(path.join(agentsRoot, name)));
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
function describeAssetChanges(
    baseline: Record<string, string> | undefined,
    current: Record<string, string>,
): string[] {
    if (!baseline) {
        return [];
    }
    const names = new Set([...Object.keys(baseline), ...Object.keys(current)]);
    const changes: string[] = [];
    for (const name of [...names].sort()) {
        if (!(name in current)) {changes.push(`removed:  ${name}`);}
        else if (!(name in baseline)) {changes.push(`added:    ${name}`);}
        else if (baseline[name] !== current[name]) {changes.push(`modified: ${name}`);}
    }
    return changes;
}

const failures: string[] = [];
const checked: string[] = [];

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

/**
 * The eval spec must run the agent on a model the product actually ships it on.
 * Catching a bad pin here costs a second; catching it at trial time costs a run.
 */
const evalSpecPath = path.join(scriptDir, "project-plan", "eval.yaml");
try {
    const supported = readSupportedModels(repoRoot, PLAN);
    const spec = fs.readFileSync(evalSpecPath, "utf8");
    const defaultsBlock = /^defaults:\r?\n((?:[ \t]+.*\r?\n|\r?\n)*)/m.exec(spec)?.[1] ?? "";
    const pinned = /^\s+model:\s*(\S+)\s*$/m.exec(defaultsBlock)?.[1];
    if (!pinned) {
        failures.push(
            "eval-model-unpinned: evals/project-plan/eval.yaml has no `defaults.model`.\n"
            + "    Without a pin the SDK falls back to the host CLI's default, which differs\n"
            + "    between a developer machine and CI, so the graders disagree.\n"
            + `    Supported: ${supported.join(", ")}`,
        );
    } else if (!supported.includes(pinned)) {
        failures.push(
            `eval-model-unsupported: evals/project-plan/eval.yaml pins '${pinned}', which `
            + `${PLAN}.agent.md does not list.\n`
            + `    Supported: ${supported.join(", ")}`,
        );
    } else {
        checked.push(`eval-model-pinned (${pinned})`);
    }
} catch (err) {
    failures.push(`eval-model-resolution: ${err instanceof Error ? err.message : String(err)}`);
}
const previous: AssetBaseline | null = fs.existsSync(lockPath)
    ? JSON.parse(fs.readFileSync(lockPath, "utf8")) as AssetBaseline
    : null;

if (update) {
    fs.writeFileSync(lockPath, `${JSON.stringify({
        agentAssetsHash: currentHash,
        scope: SCOPE,
        updatedAt: new Date().toISOString(),
        files: currentFiles,
    }, null, 4)}\n`);
    console.log(`Baseline updated: ${currentHash}`);
    console.log(`Tracking ${Object.keys(currentFiles).length} file(s): ${SCOPE}`);
} else if (previous && previous.scope !== SCOPE) {
    // A baseline recorded under a different scope isn't comparable — its hash covers a
    // different file set, so a mismatch would say nothing about the instructions.
    failures.push(
        "agent-assets-scope-changed: the baseline was recorded for a different file set.\n"
        + `    baseline scope: ${previous.scope ?? "resources/agents/** (whole tree)"}\n`
        + `    current scope:  ${SCOPE}\n`
        + "    Re-record it with:\n"
        + "      node evals/check-agent-drift.ts --update",
    );
} else if (previous && previous.agentAssetsHash !== currentHash) {
    const changes = describeAssetChanges(previous.files, currentFiles);
    const detail = changes.length
        ? `    Changed files (${changes.length}):\n${changes.map(c => `      ${c}`).join("\n")}\n`
        : "    Baseline predates per-file tracking, so the changed files can't be named.\n"
        + "    Re-running --update will record them for next time.\n";
    failures.push(
        `agent-assets-changed: tracked agent assets changed since the evals were last verified.\n`
        + `    scope:    ${SCOPE}\n`
        + `    baseline: ${previous.agentAssetsHash}\n`
        + `    current:  ${currentHash}\n`
        + detail
        + "    These files are loaded by this suite, so a change here can move the graders.\n"
        + "    Re-run the evals against the new instructions, then run:\n"
        + "      node evals/check-agent-drift.ts --update",
    );
}

if (failures.length) {
    console.error(`\n✖ Agent instruction drift detected (${failures.length} issue(s)):\n`);
    for (const failure of failures) {console.error(`  - ${failure}\n`);}
    process.exit(1);
}

console.log(`✔ ${checked.length} agent contracts intact; assets match the verified baseline.`);

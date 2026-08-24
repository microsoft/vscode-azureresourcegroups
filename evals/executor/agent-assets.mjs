#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared helpers for putting the *shipped* agent assets in front of the eval agent.
 *
 * The evals must exercise the exact instructions users receive, so nothing here
 * paraphrases, summarises, or restates a rule. The skill body is generated from
 * `resources/agents/<agent>.agent.md` and the instruction folder is copied whole,
 * which means a rule that is deleted from the product is also deleted from the eval.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { MCP_SERVER_NAME, TOOLS } from "../mcp/workflow-tools.mjs";

/**
 * The model CI grades against when the eval spec or CLI doesn't pick one.
 *
 * Must be one of the agent's declared models (validated below). Sonnet is the
 * cheapest of the three, which keeps a per-PR run inside the workflow timeout.
 */
const DEFAULT_EVAL_MODEL = "claude-sonnet-4.6";

/** The instruction folders every agent may reference via relative links. */
const SHARED_FOLDER = "shared-references";

/**
 * Maps the VS Code display names in the agent front-matter `model:` list to the
 * bare Copilot (CAPI) model ids the SDK accepts. Extend this when the product
 * adds a supported model; an unmapped entry fails the run rather than silently
 * narrowing what the evals consider supported.
 */
const MODEL_DISPLAY_NAME_TO_ID = new Map([
    ["Claude Opus 4.6 (copilot)", "claude-opus-4.6"],
    ["Claude Opus 4.7 (copilot)", "claude-opus-4.7"],
    ["Claude Sonnet 4.6 (copilot)", "claude-sonnet-4.6"],
]);

/**
 * Every asset the evals put in front of the agent: the `.agent.md` the skill is
 * generated from, plus the instruction folders copied into the workspace.
 *
 * The drift baseline hashes exactly this set. Hashing all of `resources/agents/**`
 * instead would fail the check whenever an unrelated agent moved on the base branch,
 * which on a pull request means unrelated commits break a suite they can't affect.
 *
 * Returns repo-relative paths (POSIX separators) sorted for a stable hash.
 */
export function listEvalAssetFiles(repoRoot, agentName) {
    const sourceRoot = path.join(repoRoot, "resources", "agents");
    const roots = [`${agentName}.agent.md`, agentName, SHARED_FOLDER];
    const out = [];

    const walk = (relative) => {
        const full = path.join(sourceRoot, relative);
        if (!fs.existsSync(full)) {return;}
        if (fs.statSync(full).isDirectory()) {
            for (const entry of fs.readdirSync(full)) {walk(path.join(relative, entry));}
        } else {
            out.push(relative.split(path.sep).join("/"));
        }
    };

    for (const root of roots) {walk(root);}
    return out.sort();
}

/**
 * Copy the agent's entire instruction folder (including `references/`) plus the
 * shared references into the workspace, mirroring what the extension writes to
 * `.github/agents` on the user's machine.
 */
export function prepareAgentWorkspace(repoRoot, workDir, agentName) {
    const sourceRoot = path.join(repoRoot, "resources", "agents");
    const destinationRoot = path.join(workDir, ".github", "agents");
    const copied = [];

    for (const folder of [agentName, SHARED_FOLDER]) {
        const src = path.join(sourceRoot, folder);
        if (!fs.existsSync(src)) {continue;}
        const dest = path.join(destinationRoot, folder);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(src, dest, { recursive: true, force: true });
        copied.push(folder);
    }

    return copied;
}

/** Split `---`-delimited YAML front-matter from a markdown body. */
function splitFrontmatter(markdown) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
    if (!match) {return { frontmatter: "", body: markdown };}
    return { frontmatter: match[1], body: markdown.slice(match[0].length) };
}

/**
 * Pull a scalar key out of front-matter. Only `name` and `description` are needed,
 * and both are single-line in the shipped agent files.
 */
function readFrontmatterValue(frontmatter, key) {
    const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(frontmatter);
    if (!match) {return undefined;}
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
    }
    return value.replace(/\\"/g, '"');
}

/** Read the front-matter of the shipped `<agent>.agent.md`, or throw if it's missing. */
function readAgentFile(repoRoot, agentName) {
    const agentFile = path.join(repoRoot, "resources", "agents", `${agentName}.agent.md`);
    if (!fs.existsSync(agentFile)) {
        throw new Error(`Cannot read agent assets: ${agentFile} does not exist`);
    }
    return { agentFile, ...splitFrontmatter(fs.readFileSync(agentFile, "utf8")) };
}

/**
 * The models the shipped agent declares support for, as SDK model ids.
 *
 * Read from the agent's own `model:` front-matter so the harness can never grade
 * a model the product doesn't ship the agent on — and so removing a model from
 * the product removes it from the evals too.
 */
export function readSupportedModels(repoRoot, agentName) {
    const { agentFile, frontmatter } = readAgentFile(repoRoot, agentName);
    const raw = readFrontmatterValue(frontmatter, "model");
    if (!raw) {
        throw new Error(`Cannot resolve eval model: ${agentFile} has no frontmatter 'model' list`);
    }

    // `model: ['A (copilot)', 'B (copilot)']` — a single-line flow sequence in every shipped agent.
    const displayNames = raw
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map(entry => entry.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);

    if (displayNames.length === 0) {
        throw new Error(`Cannot resolve eval model: ${agentFile} declares an empty 'model' list`);
    }

    return displayNames.map(displayName => {
        const id = MODEL_DISPLAY_NAME_TO_ID.get(displayName);
        if (!id) {
            throw new Error(
                `Cannot resolve eval model: ${agentFile} lists '${displayName}', which has no SDK id mapping. ` +
                `Add it to MODEL_DISPLAY_NAME_TO_ID in evals/executor/agent-assets.mjs.`,
            );
        }
        return id;
    });
}

/**
 * Resolve the model a trial runs as.
 *
 * Without this the SDK falls back to whatever the host's Copilot CLI defaults to,
 * which is a developer's `~/.copilot/settings.json` locally and a different default
 * in CI — the same eval then grades two different models and the results disagree.
 */
export function resolveEvalModel(repoRoot, agentName, requestedModel) {
    const supported = readSupportedModels(repoRoot, agentName);
    const model = requestedModel || DEFAULT_EVAL_MODEL;
    if (!supported.includes(model)) {
        throw new Error(
            `Model '${model}' is not supported by the ${agentName} agent. ` +
            `Supported: ${supported.join(", ")}.`,
        );
    }
    return { model, supported };
}

/**
 * Differences between the product host and this harness that the agent cannot
 * discover on its own. Deliberately contains no workflow rules or contracts —
 * those must come from the shipped instructions so the graders test the product.
 */
function harnessNotes(agentName) {
    const toolList = TOOLS.map(([name]) => `\`${MCP_SERVER_NAME}-${name}\``).join(", ");
    return [
        "## Evaluation environment",
        "",
        "This session runs the agent outside VS Code, in an isolated workspace:",
        "",
        `- The webview gate tools are already loaded under the \`${MCP_SERVER_NAME}-\` prefix — call them directly.`,
        `  \`open_plan_view\` is \`${MCP_SERVER_NAME}-open_plan_view\`, and so on for every gate.`,
        `  Available: ${toolList}.`,
        "- There is no `tool_search` and no `copilot-azure-resources-extension-tools` server here;",
        "  a gate tool named above is present even if an instruction describes a different lookup path.",
        "- When an instruction says to call a gate tool and stop, call it and end the turn.",
        `- The instruction files referenced above are present at \`.github/agents/${agentName}/\`, exactly as on a user's machine.`,
        "",
    ].join("\n");
}

/**
 * Generate the eval SKILL.md from the shipped `<agent>.agent.md`.
 *
 * The frontmatter `name`/`description` are carried over verbatim so skill
 * activation is tested against the real trigger phrases. VS Code-only keys
 * (`tools`, `model`) are dropped because they don't apply to the SDK harness.
 */
export function buildEvalSkill(repoRoot, agentName, outputRoot) {
    const agentFile = path.join(repoRoot, "resources", "agents", `${agentName}.agent.md`);
    if (!fs.existsSync(agentFile)) {
        throw new Error(`Cannot build eval skill: ${agentFile} does not exist`);
    }

    const { frontmatter, body } = splitFrontmatter(fs.readFileSync(agentFile, "utf8"));
    const name = readFrontmatterValue(frontmatter, "name") ?? agentName;
    const description = readFrontmatterValue(frontmatter, "description");
    if (!description) {
        throw new Error(`Cannot build eval skill: ${agentFile} has no frontmatter description`);
    }

    const skillDir = path.join(outputRoot, agentName);
    fs.mkdirSync(skillDir, { recursive: true });
    const contents = [
        "---",
        `name: ${name}`,
        `description: ${JSON.stringify(description)}`,
        "---",
        "",
        `<!-- GENERATED from resources/agents/${agentName}.agent.md — do not edit. See evals/executor/agent-assets.mjs. -->`,
        "",
        body.trim(),
        "",
        harnessNotes(agentName),
    ].join("\n");
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), contents);

    return skillDir;
}

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
import {
    SHARED_FOLDER,
    readFrontmatterValue,
    readSupportedModels,
    splitFrontmatter,
} from "../src/agent-definition.ts";

/**
 * The model CI grades against when the eval spec or CLI doesn't pick one.
 *
 * Must be one of the agent's declared models (validated below). Sonnet is the
 * cheapest of the three, which keeps a per-PR run inside the workflow timeout.
 */
const DEFAULT_EVAL_MODEL = "claude-sonnet-4.6";

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

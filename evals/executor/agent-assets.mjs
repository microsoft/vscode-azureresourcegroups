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

/** The instruction folders every agent may reference via relative links. */
const SHARED_FOLDER = "shared-references";

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

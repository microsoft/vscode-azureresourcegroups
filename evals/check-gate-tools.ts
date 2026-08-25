#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Verify the workflow gate tools actually reach the agent.
 *
 * Half the graders assert the agent called a gate tool. If the tools are missing the
 * agent cannot call one, and the suite reports a spread of "required tool not called"
 * failures fifteen minutes later that read like agent regressions — the agent even
 * improvises around the gap, which buries the cause.
 *
 * The tools used to be served over MCP, which made this environment-dependent: MCP
 * servers are checked against a registry policy fetched with the caller's token, and
 * a token that cannot read it blocks every non-default server. They are now registered
 * in-process, so this check mostly guards against the tools being renamed out from
 * under the graders.
 *
 * Usage: node evals/check-gate-tools.ts
 */

import { approveAll, CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { MCP_SERVER_NAME, workflowToolDefinitions } from "./mcp/workflow-tools.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function bundledCliPath() {
    const pkgDir = path.resolve(__dirname, "node_modules/@github/copilot");
    for (const candidate of ["npm-loader.js", "index.js"]) {
        const full = path.resolve(pkgDir, candidate);
        if (fs.existsSync(full)) {return full;}
    }
    throw new Error(`Copilot CLI not found under ${pkgDir} — run \`npm ci\` in evals/.`);
}

/**
 * Gate tool names the graders actually require, read from the eval specs.
 *
 * The specs name tools as literal strings, so a rename in the tool definitions
 * would leave every `tool-calls` grader asserting a tool that can never be called.
 * Comparing against the specs catches that; comparing the definitions against
 * themselves would not.
 */
function requiredToolNamesFromSpecs(): Set<string> {
    const specDir = path.join(__dirname, "project-plan");
    const names = new Set<string>();
    let files: string[];
    try {
        files = fs.readdirSync(specDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
    } catch {
        return names;
    }
    for (const file of files) {
        const text = fs.readFileSync(path.join(specDir, file), "utf8");
        for (const match of text.matchAll(new RegExp(`${MCP_SERVER_NAME}-[a-z_]+`, "g"))) {
            names.add(match[0]);
        }
    }
    return names;
}

function fail(message: string, detail?: string): never {
    console.error(`\n✖ ${message}\n`);
    if (detail) {console.error(`${detail}\n`);}
    process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-tools-"));
// Give the CLI its own HOME so a developer's personal Copilot config cannot
// change the result, keeping this check consistent with CI.
const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-tools-home-"));

const expected = workflowToolDefinitions();
const client = new CopilotClient({
    workingDirectory: workDir,
    connection: RuntimeConnection.forStdio({ path: bundledCliPath() }),
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
});

let session;
try {
    session = await client.createSession({
        onPermissionRequest: approveAll,
        tools: expected,
        streaming: false,
        workingDirectory: workDir,
    });

    const metadata = await session.rpc.tools.getCurrentMetadata().catch(() => undefined);
    const available = new Set(
        (metadata?.tools ?? [])
            .map(t => (typeof t === "string" ? t : t?.name))
            .filter(Boolean),
    );

    if (!available.size) {
        fail(
            "The CLI reported no tools at all.",
            `  Expected ${expected.length} gate tools. Raw response:\n${JSON.stringify(metadata, null, 2)}`,
        );
    }

    const missing = expected.map(t => t.name).filter(name => !available.has(name));
    if (missing.length) {
        fail(
            `${missing.length} of ${expected.length} gate tool(s) are not available to the agent.`,
            `  missing: ${missing.join(", ")}\n\n`
            + `  The graders match these names exactly, so a rename here fails every\n`
            + `  gate-tool grader. Reported tools:\n  ${[...available].sort().join(", ")}`,
        );
    }

    const required = requiredToolNamesFromSpecs();
    const unsatisfied = [...required].filter(name => !available.has(name));
    if (unsatisfied.length) {
        fail(
            `${unsatisfied.length} gate tool(s) required by the eval specs do not exist.`,
            `  required but missing: ${unsatisfied.join(", ")}\n\n`
            + `  A \`tool-calls\` grader names these literally, so it can never pass.\n`
            + `  Either the tool was renamed in evals/mcp/workflow-tools.ts or the\n`
            + `  spec has a typo. Registered tools:\n  ${expected.map(t => t.name).sort().join(", ")}`,
        );
    }

    console.log(
        `✔ All ${expected.length} workflow gate tools are available to the agent`
        + ` (${required.size} referenced by graders).`,
    );
} catch (err) {
    fail(
        `Gate tool preflight could not complete: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
    );
} finally {
    await session?.disconnect().catch(() => { /* ignore */ });
    await client.stop().catch(() => { /* ignore */ });
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
}

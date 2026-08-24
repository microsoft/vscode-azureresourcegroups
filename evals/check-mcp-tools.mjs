#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Verify the workflow-tools MCP server actually reaches the agent.
 *
 * Half the graders assert the agent called a gate tool. If the MCP server never
 * connects, the agent can't call one, and the suite reports a spread of "required
 * tool not called" failures 15 minutes later that read like agent regressions —
 * the agent even improvises around the missing tools, which buries the cause.
 *
 * MCP availability is not purely local: third-party MCP can be disabled by Copilot
 * policy, so a token that authenticates fine can still get no servers. This check
 * separates "the agent behaved wrong" from "the agent had nothing to call".
 *
 * Usage: node evals/check-mcp-tools.mjs
 */

import { approveAll, CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { MCP_SERVER_NAME, TOOLS } from "./mcp/workflow-tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function bundledCliPath() {
    const pkgDir = path.resolve(__dirname, "node_modules/@github/copilot");
    for (const candidate of ["npm-loader.js", "index.js"]) {
        const full = path.resolve(pkgDir, candidate);
        if (fs.existsSync(full)) {return full;}
    }
    throw new Error(`Copilot CLI not found under ${pkgDir} — run \`npm ci\` in evals/.`);
}

function fail(message, detail) {
    console.error(`\n✖ ${message}\n`);
    if (detail) {console.error(`${detail}\n`);}
    process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-preflight-"));
const client = new CopilotClient({
    workingDirectory: workDir,
    connection: RuntimeConnection.forStdio({ path: bundledCliPath() }),
    env: { ...process.env },
});

let session;
try {
    session = await client.createSession({
        onPermissionRequest: approveAll,
        mcpServers: {
            [MCP_SERVER_NAME]: {
                type: "local",
                command: "node",
                args: [path.resolve(__dirname, "mcp/workflow-tools-server.mjs")],
                tools: ["*"],
            },
        },
        streaming: false,
        workingDirectory: workDir,
    });

    const listing = await session.rpc.mcp.list();
    const server = (listing?.servers ?? []).find(s => s.name === MCP_SERVER_NAME);
    const host = listing?.host ?? {};

    if (!server || server.status !== "connected") {
        const hints = [];
        if (host.mcp3pEnabled === false) {
            hints.push(
                "  `mcp3pEnabled` is false: third-party MCP servers are disabled for this\n"
                + "  token by Copilot policy. The evals cannot observe gate tool calls until\n"
                + "  MCP is enabled for the account or org the eval token belongs to.",
            );
        }
        if (host.failedServers && Object.keys(host.failedServers).length) {
            hints.push(`  failedServers: ${JSON.stringify(host.failedServers, null, 2)}`);
        }
        fail(
            `MCP server '${MCP_SERVER_NAME}' is not connected (status: ${server?.status ?? "absent"}).`,
            `${hints.join("\n\n") || "  No failure detail was reported by the host."}\n\n`
            + `  Full host state:\n${JSON.stringify(listing, null, 2)}`,
        );
    }

    const response = await session.rpc.mcp.listTools({ serverName: MCP_SERVER_NAME });
    const found = new Set((response?.tools ?? []).map(t => t.name ?? t));
    // The host may report bare or server-prefixed names depending on version.
    const missing = TOOLS
        .map(([name]) => name)
        .filter(name => !found.has(name) && !found.has(`${MCP_SERVER_NAME}-${name}`));

    if (missing.length) {
        fail(
            `MCP server '${MCP_SERVER_NAME}' connected but is missing ${missing.length} tool(s).`,
            `  missing: ${missing.join(", ")}\n  reported: ${[...found].join(", ") || "(none)"}`,
        );
    }

    console.log(`✔ MCP server '${MCP_SERVER_NAME}' connected with all ${TOOLS.length} gate tools available.`);
} catch (err) {
    if (err?.message?.startsWith("MCP server")) {throw err;}
    fail(`MCP preflight could not complete: ${err.message}`, err.stack);
} finally {
    await session?.disconnect().catch(() => { /* ignore */ });
    await client.stop().catch(() => { /* ignore */ });
    fs.rmSync(workDir, { recursive: true, force: true });
}

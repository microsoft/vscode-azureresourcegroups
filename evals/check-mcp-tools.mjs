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
import { MCP_SERVER_NAME, mcpServerConfig, TOOLS, waitForMcpServer } from "./mcp/workflow-tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function bundledCliPath() {
    const pkgDir = path.resolve(__dirname, "node_modules/@github/copilot");
    for (const candidate of ["npm-loader.js", "index.js"]) {
        const full = path.resolve(pkgDir, candidate);
        if (fs.existsSync(full)) { return full; }
    }
    throw new Error(`Copilot CLI not found under ${pkgDir} — run \`npm ci\` in evals/.`);
}

/** Where the CLI writes its own logs; the host summary alone never explains a silent drop. */
function logDir() {
    return path.join(homeDir, ".copilot", "logs");
}

/**
 * Print what the CLI itself said about MCP.
 *
 * A server can be dropped before it is ever started — e.g. an MCP registry policy
 * that does not permit local servers — and that decision shows up only in the CLI
 * log, not in `mcp.list()`, which just reports an empty list with no error.
 */
function dumpCliMcpLog() {
    const dir = logDir();
    let files;
    try {
        files = fs.readdirSync(dir)
            .filter(f => f.startsWith("process-") && f.endsWith(".log"))
            .map(f => path.join(dir, f));
    } catch {
        console.error(`  (no CLI logs under ${dir})`);
        return;
    }
    if (!files.length) {
        console.error(`  (no CLI log written under ${dir} during this run)`);
        return;
    }
    for (const file of files) {
        const hits = fs.readFileSync(file, "utf8")
            .split("\n")
            .filter(line => /mcp|registry|workflow-tools/i.test(line))
            .slice(-60);
        console.error(`\n  --- ${path.basename(file)} (${hits.length} MCP lines) ---`);
        console.error(hits.map(l => `  ${l.slice(0, 400)}`).join("\n") || "  (none)");
    }
}

function fail(message, detail) {
    console.error(`\n✖ ${message}\n`);
    if (detail) { console.error(`${detail}\n`); }
    process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-preflight-"));
// Give the CLI its own HOME so its log is the only one in the directory we read
// back, and so a developer's personal Copilot config cannot change the result.
const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-preflight-home-"));
const client = new CopilotClient({
    workingDirectory: workDir,
    connection: RuntimeConnection.forStdio({ path: bundledCliPath() }),
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    // The registry/policy decision that silently drops a server is only logged at debug.
    logLevel: "debug",
});

let session;
try {
    session = await client.createSession({
        onPermissionRequest: approveAll,
        mcpServers: mcpServerConfig(),
        streaming: false,
        workingDirectory: workDir,
    });

    const { ok, listing, reason } = await waitForMcpServer(session);
    const host = listing?.host ?? {};

    if (!ok) {
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
        console.error(`\n  CLI: ${bundledCliPath()}`);
        console.error(`  platform: ${process.platform}/${process.arch}  node: ${process.version}`);
        dumpCliMcpLog();
        fail(
            `MCP server '${MCP_SERVER_NAME}' is not connected (${reason}).`,
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
    if (err?.message?.startsWith("MCP server")) { throw err; }
    fail(`MCP preflight could not complete: ${err.message}`, err.stack);
} finally {
    await session?.disconnect().catch(() => { /* ignore */ });
    await client.stop().catch(() => { /* ignore */ });
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
}

#!/usr/bin/env node
"use strict";

// HTTP MCP server — start before running vally eval, connect via type: "http".
// Usage: node evals/mcp/workflow-tools-http.cjs
// Listens on http://localhost:3100/mcp

const http = require("http");

const TOOLS = [
    "open_requirements_view", "open_plan_view", "open_frontend_preview_view",
    "open_deploy_plan_view", "open_local_plan_view", "open_local_next_steps_view",
    "open_scaffold_next_steps_view", "start_project_scaffold",
    "start_project_integrate", "start_azure_debug_generate",
    "start_local_development", "start_deployment",
];

const PORT = parseInt(process.env.MCP_PORT || "3100", 10);

function handleJsonRpc(msg) {
    var method = msg.method || "";
    var id = msg.id;
    var params = msg.params || {};

    if (method === "initialize") {
        return {
            jsonrpc: "2.0", id: id, result: {
                protocolVersion: (params.protocolVersion || "2024-11-05"),
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: "workflow-tools", version: "1.0.0" },
            }
        };
    }
    if (method === "notifications/initialized" || method === "initialized") {
        return null;
    }
    if (method === "tools/list") {
        return {
            jsonrpc: "2.0", id: id, result: {
                tools: TOOLS.map(function (n) {
                    return { name: n, description: "Workflow tool: " + n, inputSchema: { type: "object", properties: {} } };
                }),
            }
        };
    }
    if (method === "tools/call") {
        var name = params.name || "";
        console.log("[workflow-tools] " + name + "(" + JSON.stringify(params.arguments || {}) + ")");
        return {
            jsonrpc: "2.0", id: id, result: {
                content: [{ type: "text", text: "OK: " + name + " executed successfully." }],
            }
        };
    }
    if (id !== undefined) {
        return { jsonrpc: "2.0", id: id, result: {} };
    }
    return null;
}

var server = http.createServer(function (req, res) {
    if (req.method === "POST" && req.url === "/mcp") {
        var body = "";
        req.on("data", function (chunk) { body += chunk; });
        req.on("end", function () {
            try {
                var msg = JSON.parse(body);
                var response = handleJsonRpc(msg);
                if (response) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(response));
                } else {
                    res.writeHead(204);
                    res.end();
                }
            } catch (e) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    } else if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", tools: TOOLS.length }));
    } else {
        res.writeHead(404);
        res.end("Not found");
    }
});

server.listen(PORT, function () {
    console.log("[workflow-tools] HTTP MCP server listening on http://localhost:" + PORT + "/mcp");
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    registerAppResource,
    registerAppTool,
    RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

function createServer(): McpServer {
    const server = new McpServer({
        name: "Azure Code Assistant",
        version: "1.0.0",
    });

    registerLanguagePicker(server);
    registerNextSteps(server);

    return server;
}

function registerLanguagePicker(server: McpServer): void {
    const resourceUri = "ui://select-language/language-picker.html";

    const htmlPath = path.join(__dirname, "languagePickerApp.html");
    const html = fs.readFileSync(htmlPath, "utf-8");

    let resolveSelection: ((language: string) => void) | null = null;

    server.tool(
        "report_language_selection",
        "Internal: called by the language picker UI to report the user's selection.",
        { language: z.string().describe("The selected language label") },
        async ({ language }) => {
            if (resolveSelection) {
                resolveSelection(language);
                resolveSelection = null;
            }
            return { content: [{ type: "text" as const, text: "Selection received." }] };
        },
    );

    registerAppTool(
        server,
        "select_preferred_language",
        {
            title: "Select Preferred Language",
            description:
                "Prompts the user to select their preferred programming language or framework for Azure project scaffolding.",
            inputSchema: {},
            annotations: { readOnlyHint: true },
            _meta: { ui: { resourceUri } },
        },
        async () => {
            const selected = await new Promise<string>((resolve) => {
                resolveSelection = resolve;
            });
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `The user selected: ${selected}. Use this as the language/framework for scaffolding the project.`,
                    },
                ],
            };
        },
    );

    registerAppResource(
        server,
        resourceUri,
        resourceUri,
        { mimeType: RESOURCE_MIME_TYPE },
        async () => {
            return {
                contents: [
                    {
                        uri: resourceUri,
                        mimeType: RESOURCE_MIME_TYPE,
                        text: html,
                    },
                ],
            };
        },
    );
}

function registerNextSteps(server: McpServer): void {
    const resourceUri = "ui://next-steps/next-steps.html";

    const htmlPath = path.join(__dirname, "nextStepsApp.html");
    const html = fs.readFileSync(htmlPath, "utf-8");

    let resolveChoice: ((choice: string) => void) | null = null;

    server.tool(
        "report_next_step_choice",
        "Internal: called by the next steps UI when the user picks an option.",
        { choice: z.string().describe("The next step the user chose: 'deploy' or 'debug'") },
        async ({ choice }) => {
            if (resolveChoice) {
                resolveChoice(choice);
                resolveChoice = null;
            }
            return { content: [{ type: "text" as const, text: `Choice received: ${choice}` }] };
        },
    );

    registerAppTool(
        server,
        "ask_next_step",
        {
            title: "Next Steps",
            description:
                "After scaffolding a project, shows the user a next steps card with options to deploy to Azure or debug locally. Returns which option the user chose.",
            inputSchema: {
                projectPath: z.string().describe("The absolute path to the project directory containing azure.yaml."),
            },
            annotations: { readOnlyHint: true },
            // eslint-disable-next-line @typescript-eslint/naming-convention
            _meta: { ui: { resourceUri } },
        },
        async () => {
            const choice = await new Promise<string>((resolve) => {
                resolveChoice = resolve;
            });

            if (choice === "deploy") {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: "The user chose to deploy to Azure. Run 'azd up' in the project directory now.",
                        },
                    ],
                };
            } else {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: "The user chose to debug locally. Help them set up and start a local debug session for their project.",
                        },
                    ],
                };
            }
        },
    );

    registerAppResource(
        server,
        resourceUri,
        resourceUri,
        { mimeType: RESOURCE_MIME_TYPE },
        async () => {
            return {
                contents: [
                    {
                        uri: resourceUri,
                        mimeType: RESOURCE_MIME_TYPE,
                        text: html,
                    },
                ],
            };
        },
    );
}

async function main() {
    const server = createServer();
    await server.connect(new StdioServerTransport());
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

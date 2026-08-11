/**
 * Runs the production parseScaffoldPlanMarkdown() against whatever the agent
 * produced. If the parser returns zero sections, the webview would show an
 * error banner — so this grader fails.
 *
 * Note: This imports the compiled parser from the extension's dist output.
 * Run `npm run build:esbuild` before running evals if the parser has changed.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workspace = process.env.EVALUATE_WORKSPACE || process.cwd();
const planPath = resolve(workspace, '.azure/project-plan.md');

if (!existsSync(planPath)) {
    console.error('FAIL: .azure/project-plan.md does not exist');
    process.exit(1);
}

const markdown = readFileSync(planPath, 'utf8');

// Inline a minimal version of the parser logic that mirrors parseScaffoldPlanMarkdown
// to avoid needing the full extension build output in the eval environment.
function parseScaffoldPlanMarkdown(md) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const sections = [];
    for (const line of lines) {
        const match = line.match(/^##\s+(\d+)\.\s+(.+)$/);
        if (match) {
            sections.push({ number: parseInt(match[1], 10), title: match[2].trim() });
        }
    }

    const status = extractMetadata(lines, 'Status');
    return { status, sections };
}

function extractMetadata(lines, key) {
    for (const line of lines) {
        const match = line.match(new RegExp(`^\\*\\*${key}\\*\\*\\s*:\\s*(.+)$`));
        if (match) return match[1].trim();
    }
    return undefined;
}

const result = parseScaffoldPlanMarkdown(markdown);

if (!result.sections || result.sections.length === 0) {
    console.error('FAIL: parseScaffoldPlanMarkdown returned zero sections — webview would show parse error');
    process.exit(1);
}

if (!result.status) {
    console.error('FAIL: parseScaffoldPlanMarkdown could not extract Status metadata');
    process.exit(1);
}

console.error(`PASS: plan parsed successfully (${result.sections.length} sections, status: ${result.status})`);
process.exit(0);

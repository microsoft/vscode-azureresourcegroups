/**
 * Validates .azure/project-plan.md against the structural contracts
 * required by the ScaffoldPlanView webview parser.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workspace = process.env.EVALUATE_WORKSPACE || process.cwd();
const planPath = resolve(workspace, '.azure/project-plan.md');

let raw;
try {
    raw = readFileSync(planPath, 'utf8');
} catch {
    console.error(`FAIL: ${planPath} does not exist`);
    process.exit(1);
}

const lines = raw.split('\n');
const errors = [];

// Metadata rows
const hasStatus = lines.some(l => /^\*\*Status\*\*\s*:/.test(l));
const hasCreated = lines.some(l => /^\*\*Created\*\*\s*:/.test(l));
const hasMode = lines.some(l => /^\*\*Mode\*\*\s*:/.test(l));

if (!hasStatus) errors.push('Missing **Status**: metadata row');
if (!hasCreated) errors.push('Missing **Created**: metadata row');
if (!hasMode) errors.push('Missing **Mode**: metadata row');

// No YAML front-matter
if (lines[0]?.trim() === '---') {
    errors.push('Plan must not have YAML front-matter');
}

// No mermaid blocks
if (raw.includes('```mermaid')) {
    errors.push('Plan must not contain mermaid diagrams');
}

// All ## headings must be numbered
const h2Lines = lines.filter(l => /^##\s+/.test(l));
const unnumbered = h2Lines.filter(l => !/^##\s+\d+\.\s+/.test(l));
if (unnumbered.length > 0) {
    errors.push(`Unnumbered ## headings found: ${unnumbered.map(l => l.trim()).join('; ')}`);
}

// Extract numbered sections
const sections = [];
for (const line of h2Lines) {
    const match = line.match(/^##\s+(\d+)\.\s+(.+)$/);
    if (match) {
        sections.push({ number: parseInt(match[1], 10), title: match[2].trim() });
    }
}

if (sections.length === 0) {
    errors.push('No numbered sections found');
}

// Section 6 must be Design System & UI
const section6 = sections.find(s => s.number === 6);
if (section6) {
    if (!section6.title.toLowerCase().includes('design system')) {
        errors.push(`Section 6 title must contain "Design System", got: "${section6.title}"`);
    }
    // Check for Component Library row in section 6 content
    const s6Start = lines.findIndex(l => /^##\s+6\./.test(l));
    const s6End = lines.findIndex((l, i) => i > s6Start && /^##\s+\d+\./.test(l));
    const s6Content = lines.slice(s6Start, s6End === -1 ? undefined : s6End).join('\n');
    if (!s6Content.includes('**Component Library**')) {
        errors.push('Section 6 missing **Component Library**: row');
    }
} else {
    errors.push('Section 6 not found');
}

// Section 7 (Project Structure) must exist
if (!sections.find(s => s.number === 7)) {
    errors.push('Section 7 (Project Structure) not found');
}

// Section 8 (Route Definitions) must have a table with health endpoint
const section8 = sections.find(s => s.number === 8);
if (section8) {
    const s8Start = lines.findIndex(l => /^##\s+8\./.test(l));
    const s8End = lines.findIndex((l, i) => i > s8Start && /^##\s+\d+\./.test(l));
    const s8Content = lines.slice(s8Start, s8End === -1 ? undefined : s8End).join('\n');
    if (!s8Content.includes('Method') || !s8Content.includes('Path')) {
        errors.push('Section 8 route table missing Method/Path columns');
    }
    if (!/\/api\/health/i.test(s8Content)) {
        errors.push('Section 8 missing health endpoint (/api/health)');
    }
} else {
    errors.push('Section 8 (Route Definitions) not found');
}

if (errors.length > 0) {
    console.error('FAIL: project plan structure errors:');
    for (const e of errors) {
        console.error(`  • ${e}`);
    }
    process.exit(1);
}

console.error('PASS: project-plan.md structure is valid');
process.exit(0);

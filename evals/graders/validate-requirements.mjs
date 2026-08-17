/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Validates .azure/requirements.json against the schema contracts.
 *
 * Flags: --assert-no-frontend, --assert-blob-storage, --assert-cosmosdb,
 *        --assert-no-datastore, --assert-service-count=N
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const flags = new Set(process.argv.slice(2));
const workspace = process.env.EVALUATE_WORKSPACE || process.cwd();
const requirementsPath = resolve(workspace, '.azure/requirements.json');

let raw;
try {
    raw = readFileSync(requirementsPath, 'utf8');
} catch {
    console.error(`FAIL: ${requirementsPath} does not exist`);
    process.exit(1);
}

let data;
try {
    data = JSON.parse(raw);
} catch (e) {
    console.error(`FAIL: ${requirementsPath} is not valid JSON — ${e.message}`);
    process.exit(1);
}

const errors = [];

// Schema: questions array exists
if (!Array.isArray(data.questions) || data.questions.length === 0) {
    errors.push('Missing or empty questions[]');
}

// Schema: each question has required fields.
// Free-text feature questions ({serviceId}:features) intentionally omit
// `options` and `allowFreeformInput` — see resources/agents/azure-project-plan/requirements.md.
const requiredQuestionFields = ['id', 'category', 'question', 'status', 'multiSelect'];
for (const q of data.questions ?? []) {
    const isFeatureQuestion = typeof q.id === 'string' && q.id.endsWith(':features');
    for (const field of requiredQuestionFields) {
        if (q[field] === undefined) {
            errors.push(`Question "${q.id ?? '?'}" missing field: ${field}`);
        }
    }
    if (!isFeatureQuestion && q.allowFreeformInput === undefined) {
        errors.push(`Question "${q.id ?? '?'}" missing field: allowFreeformInput`);
    }
    if (isFeatureQuestion && q.allowFreeformInput !== undefined) {
        errors.push(`Feature question "${q.id}" must omit allowFreeformInput`);
    }
    if (q.recommendedChoice === undefined) {
        errors.push(`Question "${q.id ?? '?'}" missing recommendedChoice`);
    }
    if (q.options && !Array.isArray(q.options)) {
        errors.push(`Question "${q.id ?? '?'}" has non-array options`);
    }
    if (Array.isArray(q.options)) {
        for (const opt of q.options) {
            if (!opt.label) {
                errors.push(`Question "${q.id ?? '?'}" has option without label`);
            }
        }
    }
}

// Schema: services array
if (data.services !== undefined && !Array.isArray(data.services)) {
    errors.push('services must be an array if present');
}
for (const svc of data.services ?? []) {
    if (!svc.id || !svc.label || !svc.role) {
        errors.push(`Service missing id/label/role: ${JSON.stringify(svc)}`);
    }
}

// Find the dataStores question
const dataStoresQ = data.questions?.find(q => q.id === 'dataStores' || q.category === 'data' && q.multiSelect === true);

if (dataStoresQ) {
    if (dataStoresQ.multiSelect !== true) {
        errors.push('dataStores question must have multiSelect: true');
    }
    const exclusiveOpt = dataStoresQ.options?.find(o => o.label === 'No datastore required');
    if (exclusiveOpt && !exclusiveOpt.exclusive) {
        errors.push('"No datastore required" option must have exclusive: true');
    }
    if (dataStoresQ.allowFreeformInput !== false) {
        errors.push('dataStores allowFreeformInput must be false');
    }
}

// Find language questions — frontend should only offer TS/JS
const frontendServices = (data.services ?? []).filter(s => s.role === 'frontend');
for (const svc of frontendServices) {
    const langQ = data.questions?.find(q => q.serviceId === svc.id && (q.category === 'runtime' || q.id?.includes('language')));
    if (langQ?.options) {
        const labels = langQ.options.map(o => o.label?.toLowerCase());
        if (labels.some(l => l?.includes('python') || l?.includes('c#') || l?.includes('.net'))) {
            errors.push(`Frontend language question offers non-JS/TS options: ${labels.join(', ')}`);
        }
    }
}

// Check allowFreeformInput per question type
for (const q of data.questions ?? []) {
    if ((q.category === 'runtime' || q.id?.includes('language')) && q.allowFreeformInput !== false) {
        errors.push(`Language question "${q.id}" must have allowFreeformInput: false`);
    }
}

// Flag assertions
if (flags.has('--assert-no-frontend')) {
    const hasFrontend = (data.services ?? []).some(s => s.role === 'frontend');
    if (hasFrontend) {
        errors.push('Expected no frontend service but found one');
    }
}

if (flags.has('--assert-blob-storage')) {
    const rec = Array.isArray(dataStoresQ?.recommendedChoice) ? dataStoresQ.recommendedChoice : [dataStoresQ?.recommendedChoice];
    if (!rec.some(r => r?.includes('Blob'))) {
        errors.push('Expected Blob Storage in dataStores recommendedChoice');
    }
}

if (flags.has('--assert-cosmosdb')) {
    const rec = Array.isArray(dataStoresQ?.recommendedChoice) ? dataStoresQ.recommendedChoice : [dataStoresQ?.recommendedChoice];
    if (!rec.some(r => r?.includes('Cosmos'))) {
        errors.push('Expected CosmosDB in dataStores recommendedChoice');
    }
}

if (flags.has('--assert-no-datastore')) {
    const rec = Array.isArray(dataStoresQ?.recommendedChoice) ? dataStoresQ.recommendedChoice : [dataStoresQ?.recommendedChoice];
    if (!rec.includes('No datastore required')) {
        errors.push('Expected "No datastore required" in recommendedChoice');
    }
    if (rec.length > 1 && rec.includes('No datastore required')) {
        errors.push('"No datastore required" must not be combined with other stores');
    }
}

const serviceCountFlag = [...flags].find(f => f.startsWith('--assert-service-count='));
if (serviceCountFlag) {
    const expected = parseInt(serviceCountFlag.split('=')[1], 10);
    const actual = (data.services ?? []).length;
    if (actual !== expected) {
        errors.push(`Expected ${expected} services, got ${actual}`);
    }
}

if (errors.length > 0) {
    console.error('FAIL: requirements validation errors:');
    for (const e of errors) {
        console.error(`  • ${e}`);
    }
    process.exit(1);
}

console.error('PASS: requirements.json is valid');
process.exit(0);

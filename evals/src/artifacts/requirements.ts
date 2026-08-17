/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    isAnswerEmpty,
    parseRequirementsJson,
    RequirementsAnswer,
} from '../../../src/webviews/copilotOnRails/views/utils/parseRequirements';
import {
    ArtifactValidationIssue,
    ArtifactValidationResult,
    createValidationResult,
} from './validationTypes';

export function validateRequirementsArtifact(
    content: string,
    options: { requireConfirmed?: boolean } = {},
): ArtifactValidationResult {
    const issues: ArtifactValidationIssue[] = [];
    let raw: Record<string, unknown>;
    try {
        const parsed: unknown = JSON.parse(content);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return createValidationResult([issue('invalidRoot', '$', 'Requirements must be a JSON object.')]);
        }
        raw = parsed as Record<string, unknown>;
    } catch (error) {
        return createValidationResult([issue('invalidJson', '$', getErrorMessage(error))]);
    }

    if (raw.schemaVersion !== '2') {
        issues.push(issue('schemaVersion', '$.schemaVersion', 'Expected requirements schemaVersion "2".'));
    }
    const requirements = parseRequirementsJson(content);
    if (!requirements.services?.length) {
        issues.push(issue('missingServices', '$.services', 'At least one service is required.'));
    }
    if (!requirements.questions.length) {
        issues.push(issue('missingQuestions', '$.questions', 'At least one question is required.'));
    }

    const serviceIds = new Set<string>();
    for (const [index, service] of (requirements.services ?? []).entries()) {
        if (serviceIds.has(service.id)) {
            issues.push(issue('duplicateServiceId', `$.services[${index}].id`, `Duplicate service id "${service.id}".`));
        }
        serviceIds.add(service.id);
        if (!requirements.questions.some(question => question.serviceId === service.id && question.id.endsWith(':language'))) {
            issues.push(issue('missingLanguageQuestion', `$.services[${index}]`, `Service "${service.id}" has no language question.`));
        }
    }

    const rawQuestions = Array.isArray(raw.questions) ? raw.questions : [];
    for (const [index, value] of rawQuestions.entries()) {
        const path = `$.questions[${index}]`;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            issues.push(issue('invalidQuestion', path, 'Question must be an object.'));
            continue;
        }
        const question = value as Record<string, unknown>;
        const id = typeof question.id === 'string' ? question.id : '';
        const isFeatureQuestion = id.endsWith(':features');
        requireNonEmptyString(question, 'id', path, issues);
        requireNonEmptyString(question, 'category', path, issues);
        requireNonEmptyString(question, 'question', path, issues);
        requireNonEmptyString(question, 'header', path, issues);
        if (typeof question.multiSelect !== 'boolean') {
            issues.push(issue('missingMultiSelect', `${path}.multiSelect`, 'multiSelect must be a boolean.'));
        }
        if (question.recommendedChoice === undefined) {
            issues.push(issue('missingRecommendedChoice', `${path}.recommendedChoice`, 'recommendedChoice is required.'));
        }
        if (!isFeatureQuestion) {
            if (!Array.isArray(question.options) || question.options.length === 0) {
                issues.push(issue('missingOptions', `${path}.options`, 'Non-feature questions require options.'));
            }
            if (typeof question.allowFreeformInput !== 'boolean') {
                issues.push(issue('missingAllowFreeformInput', `${path}.allowFreeformInput`, 'allowFreeformInput must be a boolean.'));
            }
        }
        const status = question.status;
        if (status !== 'inferred' && status !== 'needs_input' && status !== 'confirmed') {
            issues.push(issue('invalidStatus', `${path}.status`, 'Status must be inferred, needs_input, or confirmed.'));
        }
        if (options.requireConfirmed && status !== 'confirmed') {
            issues.push(issue('unconfirmedQuestion', `${path}.status`, `Question "${id}" is not confirmed.`));
        }
        if (options.requireConfirmed && isAnswerEmpty(question.answer as RequirementsAnswer)) {
            issues.push(issue('emptyConfirmedAnswer', `${path}.answer`, `Question "${id}" has no confirmed answer.`));
        }
        if (question.serviceId !== undefined && (typeof question.serviceId !== 'string' || !serviceIds.has(question.serviceId))) {
            issues.push(issue('invalidServiceId', `${path}.serviceId`, `Question "${id}" references an unknown service.`));
        }
        if (id === 'appType') {
            issues.push(issue('forbiddenAppType', `${path}.id`, 'App type must be derived from services, not asked as a question.'));
        }
        if (id === 'dataStores') {
            validateDataStoresQuestion(question, path, issues);
        } else if (question.multiSelect === true) {
            issues.push(issue('unexpectedMultiSelect', `${path}.multiSelect`, 'Only dataStores may be multi-select.'));
        }
    }

    if (!requirements.questions.some(question => question.id === 'dataStores' && !question.serviceId)) {
        issues.push(issue('missingDataStores', '$.questions', 'Shared dataStores question is required.'));
    }
    if (!requirements.questions.some(question => question.id === 'auth' && !question.serviceId)) {
        issues.push(issue('missingAuth', '$.questions', 'Shared auth question is required.'));
    }

    return createValidationResult(issues);
}

export function confirmRequirementsArtifact(
    content: string,
    answers: Record<string, RequirementsAnswer> = {},
): string {
    const raw = JSON.parse(content) as Record<string, unknown>;
    if (!Array.isArray(raw.questions)) {
        throw new Error('Requirements artifact has no questions array.');
    }
    raw.questions = raw.questions.map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`Requirements question ${index} is not an object.`);
        }
        const question = value as Record<string, unknown>;
        const id = typeof question.id === 'string' ? question.id : `question-${index}`;
        const answer = Object.prototype.hasOwnProperty.call(answers, id)
            ? answers[id]
            : question.answer ?? question.recommendedChoice;
        if (isAnswerEmpty(answer as RequirementsAnswer)) {
            throw new Error(`Requirements question "${id}" has no answer or recommendedChoice.`);
        }
        return {
            ...question,
            answer,
            status: 'confirmed',
        };
    });
    raw.executionMode = 'guided';
    const confirmed = JSON.stringify(raw, null, 2) + '\n';
    const validation = validateRequirementsArtifact(confirmed, { requireConfirmed: true });
    if (!validation.valid) {
        throw new Error(`Confirmed requirements are invalid: ${validation.issues.map(value => value.message).join('; ')}`);
    }
    return confirmed;
}

function validateDataStoresQuestion(
    question: Record<string, unknown>,
    path: string,
    issues: ArtifactValidationIssue[],
): void {
    if (question.multiSelect !== true) {
        issues.push(issue('dataStoresNotMultiSelect', `${path}.multiSelect`, 'dataStores must be multi-select.'));
    }
    const options = Array.isArray(question.options) ? question.options : [];
    const noStore = options.find(value => value
        && typeof value === 'object'
        && !Array.isArray(value)
        && (value as Record<string, unknown>).label === 'No datastore required') as Record<string, unknown> | undefined;
    if (!noStore || noStore.exclusive !== true) {
        issues.push(issue('missingExclusiveNoStore', `${path}.options`, '"No datastore required" must be an exclusive option.'));
    }
}

function requireNonEmptyString(
    value: Record<string, unknown>,
    key: string,
    parentPath: string,
    issues: ArtifactValidationIssue[],
): void {
    if (typeof value[key] !== 'string' || value[key].trim().length === 0) {
        issues.push(issue(`missing${key[0].toUpperCase()}${key.slice(1)}`, `${parentPath}.${key}`, `${key} must be a non-empty string.`));
    }
}

function issue(code: string, path: string, message: string): ArtifactValidationIssue {
    return { code, path, message };
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

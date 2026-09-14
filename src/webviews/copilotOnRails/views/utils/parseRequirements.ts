/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isJsonObject } from '../../shared/jsonUtils';

export type RequirementsAnswer = string | number | boolean | string[] | null;

export type RequirementsStatus = 'inferred' | 'needs_input' | 'confirmed' | string;

export type RequirementsRecommendedChoice = string | string[];

/**
 * How the create-project workflow should run after the requirements form is
 * submitted. `'guided'` keeps the default step-by-step flow with preview
 * webviews and explicit approval gates. `'auto'` ("autopilot") runs the entire
 * plan → scaffold → local debug chain end-to-end without further interaction.
 */
export type RequirementsExecutionMode = 'guided' | 'auto';

export interface RequirementsOption {
    label: string;
    description?: string;
    exclusive?: boolean;
}

export interface RequirementsQuestion {
    id: string;
    category: string;
    question: string;
    header?: string;
    answer: RequirementsAnswer;
    status: RequirementsStatus;
    rationale?: string;
    options?: RequirementsOption[];
    recommendedChoice?: RequirementsRecommendedChoice;
    multiSelect?: boolean;
    allowFreeformInput?: boolean;
    /** When set, ties this question to a specific service in `services[]`. */
    serviceId?: string;
}

export type RequirementsServiceRole = 'frontend' | 'backend' | 'worker';

export interface RequirementsService {
    /** Unique ID for this service, matching `serviceId` on questions. */
    id: string;
    /** Human-readable label, e.g. "Payments API" or "Customer Portal". */
    label: string;
    /** Service role. */
    role: RequirementsServiceRole;
    /** Workspace-relative root path, e.g. "./api" or "./web". */
    root?: string;
}

export interface RequirementsWorkspaceSignals {
    rootPath?: string;
    detectedFiles?: string[];
    hasSourceCode?: boolean;
    hasPackageJson?: boolean;
    decision?: string;
    decisionReason?: string;
}

export interface RequirementsData {
    schemaVersion?: string;
    generatedAt?: string;
    mode?: string;
    summary?: string;
    executionMode?: RequirementsExecutionMode;
    workspaceSignals?: RequirementsWorkspaceSignals;
    /** Detected services (frontends, backends, workers). */
    services?: RequirementsService[];
    questions: RequirementsQuestion[];
    parseError?: {
        message: string;
        fileLabel?: string;
    };
}

export type RequirementsInputType = 'text' | 'number' | 'boolean' | 'tags' | 'select' | 'multiselect';

export function inferInputType(
    answer: RequirementsAnswer,
    options?: RequirementsOption[],
    explicitMultiSelect?: boolean,
): RequirementsInputType {
    const hasOptions = Array.isArray(options) && options.length > 0;
    if (hasOptions) {
        if (explicitMultiSelect === true) {
            return 'multiselect';
        }
        if (explicitMultiSelect === false) {
            return 'select';
        }
        return Array.isArray(answer) ? 'multiselect' : 'select';
    }
    if (Array.isArray(answer)) {
        return 'tags';
    }
    if (typeof answer === 'number') {
        return 'number';
    }
    if (typeof answer === 'boolean') {
        return 'boolean';
    }
    return 'text';
}

function parseOption(raw: unknown): RequirementsOption | undefined {
    if (!isJsonObject(raw)) {
        return undefined;
    }

    const label = typeof raw.label === 'string' ? raw.label : undefined;
    if (!label) {
        return undefined;
    }

    const description = typeof raw.description === 'string' ? raw.description : undefined;
    const exclusive = typeof raw.exclusive === 'boolean' ? raw.exclusive : undefined;
    return { label, description, exclusive };
}

function parseWorkspaceSignals(raw: unknown): RequirementsWorkspaceSignals | undefined {
    if (!isJsonObject(raw)) {
        return undefined;
    }

    return {
        rootPath: typeof raw.rootPath === 'string' ? raw.rootPath : undefined,
        detectedFiles: Array.isArray(raw.detectedFiles)
            ? raw.detectedFiles.filter((file): file is string => typeof file === 'string')
            : undefined,
        hasSourceCode: typeof raw.hasSourceCode === 'boolean' ? raw.hasSourceCode : undefined,
        hasPackageJson: typeof raw.hasPackageJson === 'boolean' ? raw.hasPackageJson : undefined,
        decision: typeof raw.decision === 'string' ? raw.decision : undefined,
        decisionReason: typeof raw.decisionReason === 'string' ? raw.decisionReason : undefined,
    };
}

export function parseRequirementsJson(content: string): RequirementsData {
    const parsed: unknown = JSON.parse(content);
    if (!isJsonObject(parsed)) {
        throw new TypeError('Requirements JSON must contain an object.');
    }

    const questionsRaw = Array.isArray(parsed.questions) ? parsed.questions : [];

    const questions: RequirementsQuestion[] = questionsRaw
        .map((q, idx): RequirementsQuestion | undefined => {
            if (!isJsonObject(q)) {
                return undefined;
            }
            const id = typeof q.id === 'string' && q.id.trim() ? q.id : `question-${idx}`;
            const category = typeof q.category === 'string' && q.category.trim() ? q.category : 'general';
            const question = typeof q.question === 'string' ? q.question : '';
            const header = typeof q.header === 'string' ? q.header : undefined;
            const status = typeof q.status === 'string' ? q.status : 'needs_input';
            const rationale = typeof q.rationale === 'string'
                ? q.rationale
                : (typeof q.reason === 'string' ? q.reason : undefined);
            const multiSelect = typeof q.multiSelect === 'boolean' ? q.multiSelect : undefined;
            const allowFreeformInput = typeof q.allowFreeformInput === 'boolean' ? q.allowFreeformInput : undefined;
            const serviceId = typeof q.serviceId === 'string' && q.serviceId.trim() ? q.serviceId : undefined;

            let answer: RequirementsAnswer;
            if (q.answer === null || q.answer === undefined) {
                answer = null;
            } else if (Array.isArray(q.answer)) {
                answer = q.answer.filter((x): x is string => typeof x === 'string');
            } else if (typeof q.answer === 'string' || typeof q.answer === 'number' || typeof q.answer === 'boolean') {
                answer = q.answer;
            } else {
                answer = null;
            }

            const options = Array.isArray(q.options)
                ? q.options.map(parseOption).filter((o): o is RequirementsOption => o !== undefined)
                : undefined;

            let recommendedChoice: RequirementsRecommendedChoice | undefined;
            if (Array.isArray(q.recommendedChoice)) {
                recommendedChoice = q.recommendedChoice.filter((x): x is string => typeof x === 'string');
            } else if (typeof q.recommendedChoice === 'string') {
                recommendedChoice = q.recommendedChoice;
            }

            return {
                id,
                category,
                question,
                header,
                answer,
                status,
                rationale,
                options,
                recommendedChoice,
                multiSelect,
                allowFreeformInput,
                serviceId,
            };
        })
        .filter((q): q is RequirementsQuestion => q !== undefined);

    const workspaceSignals = parseWorkspaceSignals(parsed.workspaceSignals);

    const servicesRaw = Array.isArray(parsed.services) ? parsed.services : [];
    const services: RequirementsService[] = servicesRaw
        .map((s): RequirementsService | undefined => {
            if (!isJsonObject(s)) { return undefined; }
            const id = typeof s.id === 'string' && s.id.trim() ? s.id : undefined;
            const label = typeof s.label === 'string' && s.label.trim() ? s.label : undefined;
            const role = typeof s.role === 'string' && ['frontend', 'backend', 'worker'].includes(s.role) ? s.role as RequirementsServiceRole : undefined;
            if (!id || !label || !role) { return undefined; }
            const root = typeof s.root === 'string' ? s.root : undefined;
            return { id, label, role, root };
        })
        .filter((s): s is RequirementsService => s !== undefined);

    const executionMode: RequirementsExecutionMode | undefined =
        parsed.executionMode === 'auto' || parsed.executionMode === 'guided'
            ? parsed.executionMode
            : undefined;

    return {
        schemaVersion: typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : undefined,
        generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined,
        mode: typeof parsed.mode === 'string' ? parsed.mode : undefined,
        summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
        executionMode,
        workspaceSignals,
        services: services.length > 0 ? services : undefined,
        questions,
    };
}

export function isAnswerEmpty(answer: RequirementsAnswer): boolean {
    if (answer === null || answer === undefined) {
        return true;
    }
    if (typeof answer === 'string') {
        return answer.trim().length === 0;
    }
    if (Array.isArray(answer)) {
        return answer.length === 0 || answer.every((s) => s.trim().length === 0);
    }
    return false;
}

export function toggleRequirementsOption(
    selected: string[],
    options: RequirementsOption[],
    label: string,
): string[] {
    const clickedOption = options.find(option => option.label === label);
    if (!clickedOption) {
        return selected;
    }

    if (clickedOption.exclusive) {
        return selected.includes(label) ? [] : [label];
    }

    const optionLabels = new Set(options.map(option => option.label));
    const exclusiveLabels = new Set(options.filter(option => option.exclusive).map(option => option.label));
    const selectedOptions = selected.filter(value => optionLabels.has(value) && !exclusiveLabels.has(value));
    const customValues = selected.filter(value => !optionLabels.has(value));
    const nextSelectedOptions = selectedOptions.includes(label)
        ? selectedOptions.filter(value => value !== label)
        : [...selectedOptions, label];
    return [...nextSelectedOptions, ...customValues];
}

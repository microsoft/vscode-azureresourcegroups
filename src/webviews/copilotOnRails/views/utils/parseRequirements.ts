/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type RequirementsAnswer = string | number | boolean | string[] | null;

export type RequirementsStatus = 'inferred' | 'needs_input' | 'confirmed' | string;

export interface RequirementsQuestion {
    id: string;
    category: string;
    question: string;
    answer: RequirementsAnswer;
    status: RequirementsStatus;
    rationale?: string;
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
    workspaceSignals?: RequirementsWorkspaceSignals;
    questions: RequirementsQuestion[];
    parseError?: {
        message: string;
        fileLabel?: string;
    };
}

export type RequirementsInputType = 'text' | 'number' | 'boolean' | 'tags';

export function inferInputType(answer: RequirementsAnswer): RequirementsInputType {
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

export function parseRequirementsJson(content: string): RequirementsData {
    const raw = JSON.parse(content) as Record<string, unknown>;
    const questionsRaw = Array.isArray(raw.questions) ? raw.questions as unknown[] : [];

    const questions: RequirementsQuestion[] = questionsRaw
        .map((q, idx): RequirementsQuestion | undefined => {
            if (!q || typeof q !== 'object') {
                return undefined;
            }
            const obj = q as Record<string, unknown>;
            const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id : `question-${idx}`;
            const category = typeof obj.category === 'string' && obj.category.trim() ? obj.category : 'general';
            const question = typeof obj.question === 'string' ? obj.question : '';
            const status = typeof obj.status === 'string' ? obj.status : 'needs_input';
            const rationale = typeof obj.rationale === 'string' ? obj.rationale : undefined;

            let answer: RequirementsAnswer;
            if (obj.answer === null || obj.answer === undefined) {
                answer = null;
            } else if (Array.isArray(obj.answer)) {
                answer = obj.answer.filter((x): x is string => typeof x === 'string');
            } else if (typeof obj.answer === 'string' || typeof obj.answer === 'number' || typeof obj.answer === 'boolean') {
                answer = obj.answer;
            } else {
                answer = String(obj.answer);
            }

            return { id, category, question, answer, status, rationale };
        })
        .filter((q): q is RequirementsQuestion => q !== undefined);

    const workspaceSignals = raw.workspaceSignals && typeof raw.workspaceSignals === 'object'
        ? raw.workspaceSignals as RequirementsWorkspaceSignals
        : undefined;

    return {
        schemaVersion: typeof raw.schemaVersion === 'string' ? raw.schemaVersion : undefined,
        generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : undefined,
        mode: typeof raw.mode === 'string' ? raw.mode : undefined,
        summary: typeof raw.summary === 'string' ? raw.summary : undefined,
        workspaceSignals,
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Input, Textarea, Tooltip } from '@fluentui/react-components';
import { CheckmarkCircleRegular, DismissRegular, SendRegular, WarningRegular } from '@fluentui/react-icons';
import { WebviewContext } from '@microsoft/vscode-azext-webview/webview';
import { useCallback, useContext, useEffect, useMemo, useState, type JSX } from 'react';
import './styles/requirementsView.scss';
import { inferInputType, isAnswerEmpty, type RequirementsAnswer, type RequirementsData, type RequirementsQuestion } from './utils/parseRequirements';

interface DraftMap {
    [questionId: string]: RequirementsAnswer;
}

interface EditedMap {
    [questionId: string]: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
    project: 'Project',
    app: 'Application',
    runtime: 'Runtime',
    frontend: 'Frontend',
    backend: 'Backend',
    auth: 'Authentication',
    data: 'Data',
    storage: 'Storage',
    ai: 'AI',
    testing: 'Testing',
    deployment: 'Deployment',
    iac: 'Infrastructure as Code',
    cicd: 'CI / CD',
    operations: 'Operations',
    scale: 'Scale',
    compliance: 'Compliance',
    general: 'General',
};

const CATEGORY_ORDER = [
    'project',
    'app',
    'runtime',
    'frontend',
    'backend',
    'auth',
    'data',
    'storage',
    'ai',
    'testing',
    'deployment',
    'iac',
    'cicd',
    'operations',
    'scale',
    'compliance',
    'general',
];

function categoryLabel(category: string): string {
    return CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

function categorySortValue(category: string): number {
    const idx = CATEGORY_ORDER.indexOf(category);
    return idx === -1 ? CATEGORY_ORDER.length : idx;
}

export const RequirementsView = (): JSX.Element => {
    const [data, setData] = useState<RequirementsData | null>(null);
    const [drafts, setDrafts] = useState<DraftMap>({});
    const [edited, setEdited] = useState<EditedMap>({});
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const { vscodeApi } = useContext(WebviewContext);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message?.command === 'setRequirementsData') {
                const incoming = message.data as RequirementsData;
                setData(incoming);
                // Reset drafts to whatever's in the file. Don't preserve in-flight
                // edits, since the file is the source of truth on reload.
                const nextDrafts: DraftMap = {};
                for (const q of incoming.questions) {
                    nextDrafts[q.id] = q.answer;
                }
                setDrafts(nextDrafts);
                setEdited({});
            } else if (message?.command === 'submitError') {
                setSaveError(typeof message.error === 'string' ? message.error : 'Failed to save requirements.');
                setIsSaving(false);
            } else if (message?.command === 'submitComplete') {
                setIsSaving(false);
                setSaveError(null);
            }
        };
        window.addEventListener('message', handler);
        vscodeApi.postMessage({ command: 'ready' });
        return () => window.removeEventListener('message', handler);
    }, [vscodeApi]);

    const updateDraft = useCallback((id: string, value: RequirementsAnswer) => {
        setDrafts(prev => ({ ...prev, [id]: value }));
        setEdited(prev => ({ ...prev, [id]: true }));
        setSaveError(null);
    }, []);

    const grouped = useMemo(() => {
        if (!data) {
            return [] as { category: string; questions: RequirementsQuestion[] }[];
        }
        const map = new Map<string, RequirementsQuestion[]>();
        for (const q of data.questions) {
            if (q.status === 'inferred') {
                continue;
            }
            const list = map.get(q.category) ?? [];
            list.push(q);
            map.set(q.category, list);
        }
        return Array.from(map.entries())
            .sort((a, b) => categorySortValue(a[0]) - categorySortValue(b[0]))
            .map(([category, questions]) => ({ category, questions }));
    }, [data]);

    const missingRequired = useMemo(() => {
        if (!data) {
            return [] as RequirementsQuestion[];
        }
        return data.questions.filter(q => {
            const draftAnswer = drafts[q.id];
            const effective = draftAnswer === undefined ? q.answer : draftAnswer;
            return q.status === 'needs_input' && isAnswerEmpty(effective);
        });
    }, [data, drafts]);

    const canSubmit = data !== null && missingRequired.length === 0 && !isSaving;

    const handleSubmit = useCallback(() => {
        if (!data || !canSubmit) {
            return;
        }
        const updatedQuestions = data.questions.map(q => {
            const userEdited = edited[q.id] === true;
            const draftAnswer = drafts[q.id];
            const effective = draftAnswer === undefined ? q.answer : draftAnswer;

            let nextStatus = q.status;
            if (q.status === 'needs_input' && !isAnswerEmpty(effective)) {
                nextStatus = 'confirmed';
            } else if (q.status === 'inferred' && userEdited) {
                nextStatus = 'confirmed';
            }

            return {
                ...q,
                answer: effective,
                status: nextStatus,
            };
        });

        setIsSaving(true);
        setSaveError(null);
        vscodeApi.postMessage({
            command: 'submitRequirements',
            data: {
                ...data,
                questions: updatedQuestions,
            },
        });
    }, [data, canSubmit, drafts, edited, vscodeApi]);

    if (!data) {
        return (
            <div className='requirementsView'>
                <div className='emptyState'>Loading requirements…</div>
            </div>
        );
    }

    if (data.parseError) {
        return (
            <div className='requirementsView'>
                <div className='banner banner--error'>
                    <WarningRegular />
                    <div>
                        <strong>Couldn't parse requirements file.</strong>
                        <p>{data.parseError.message}</p>
                        {data.parseError.fileLabel && <p className='muted'>{data.parseError.fileLabel}</p>}
                    </div>
                </div>
            </div>
        );
    }

    const needsInputCount = data.questions.filter(q => q.status === 'needs_input').length;
    const answeredNeedsInputCount = needsInputCount - missingRequired.length;

    return (
        <div className='requirementsView'>
            <header className='requirementsHeader'>
                <div className='headerText'>
                    <h1>Project requirements</h1>
                    <p className='summary'>All fields below are required. Fill out every input, then submit to Copilot to continue.</p>
                </div>
                <div className='headerActions'>
                    <div className='progress'>
                        <span>{answeredNeedsInputCount}/{needsInputCount} inputs filled</span>
                    </div>
                    <Tooltip
                        relationship='label'
                        content={
                            missingRequired.length === 0
                                ? 'Save answers and generate the scaffold plan.'
                                : `Please answer ${missingRequired.length} remaining required question${missingRequired.length === 1 ? '' : 's'}.`
                        }
                    >
                        <Button
                            appearance='primary'
                            icon={<SendRegular />}
                            onClick={handleSubmit}
                            disabled={!canSubmit}
                        >
                            {isSaving ? 'Submitting…' : 'Submit'}
                        </Button>
                    </Tooltip>
                </div>
            </header>

            {saveError && (
                <div className='banner banner--error'>
                    <WarningRegular />
                    <div>
                        <strong>Couldn't submit requirements.</strong>
                        <p>{saveError}</p>
                    </div>
                </div>
            )}

            {grouped.map(group => (
                <section className='categoryCard' key={group.category}>
                    <header className='categoryHeader'>
                        <h2>{categoryLabel(group.category)}</h2>
                    </header>
                    <ul className='questionList'>
                        {group.questions.map(q => (
                            <QuestionRow
                                key={q.id}
                                question={q}
                                draft={drafts[q.id] === undefined ? q.answer : drafts[q.id]}
                                edited={edited[q.id] === true}
                                onChange={(value) => updateDraft(q.id, value)}
                            />
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
};

const QuestionRow = ({
    question,
    draft,
    edited,
    onChange,
}: {
    question: RequirementsQuestion;
    draft: RequirementsAnswer;
    edited: boolean;
    onChange: (value: RequirementsAnswer) => void;
}): JSX.Element => {
    const inputType = inferInputType(question.answer ?? draft);
    const isMissing = question.status === 'needs_input' && isAnswerEmpty(draft);
    const isConfirmed = question.status === 'confirmed' || edited;

    return (
        <li className={`questionRow ${isMissing ? 'questionRow--missing' : ''}`}>
            <div className='questionMeta'>
                <span className='questionText'>{question.question}</span>
                <span className='statusBadges'>
                    {!isMissing && isConfirmed && (
                        <Badge appearance='tint' color='success' size='small' icon={<CheckmarkCircleRegular />}>Confirmed</Badge>
                    )}
                </span>
            </div>
            <div className='questionInput'>
                <AnswerInput inputType={inputType} value={draft} onChange={onChange} />
                {edited && draft !== question.answer && (
                    <Tooltip relationship='label' content='Reset to original value'>
                        <Button
                            appearance='subtle'
                            size='small'
                            icon={<DismissRegular />}
                            onClick={() => onChange(question.answer)}
                            aria-label='Reset'
                        />
                    </Tooltip>
                )}
            </div>
            {question.rationale && (
                <p className='rationale'>{question.rationale}</p>
            )}
        </li>
    );
};

const AnswerInput = ({
    inputType,
    value,
    onChange,
}: {
    inputType: ReturnType<typeof inferInputType>;
    value: RequirementsAnswer;
    onChange: (next: RequirementsAnswer) => void;
}): JSX.Element => {
    if (inputType === 'tags') {
        const text = Array.isArray(value) ? value.join(', ') : (value == null ? '' : String(value));
        return (
            <Input
                size='small'
                value={text}
                placeholder='Comma-separated values'
                onChange={(_, data) => {
                    const next = data.value.split(',').map(s => s.trim()).filter(s => s.length > 0);
                    onChange(next);
                }}
                className='answerInput answerInput--tags'
            />
        );
    }

    if (inputType === 'number') {
        const text = value == null ? '' : String(value);
        return (
            <Input
                size='small'
                type='number'
                value={text}
                onChange={(_, data) => {
                    if (data.value.trim() === '') {
                        onChange(null);
                    } else {
                        const num = Number(data.value);
                        onChange(Number.isFinite(num) ? num : data.value);
                    }
                }}
                className='answerInput answerInput--number'
            />
        );
    }

    const text = value == null ? '' : String(value);
    const useTextarea = text.length > 60;

    if (useTextarea) {
        return (
            <Textarea
                size='small'
                value={text}
                onChange={(_, data) => onChange(data.value)}
                resize='vertical'
                className='answerInput answerInput--textarea'
                rows={3}
            />
        );
    }

    return (
        <Input
            size='small'
            value={text}
            onChange={(_, data) => onChange(data.value)}
            className='answerInput answerInput--text'
        />
    );
};

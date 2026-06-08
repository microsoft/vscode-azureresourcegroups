/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Input, Textarea, Tooltip } from '@fluentui/react-components';
import { CheckboxUncheckedRegular, CheckmarkRegular, SendRegular, WarningRegular } from '@fluentui/react-icons';
import { WebviewContext } from '@microsoft/vscode-azext-webview/webview';
import { useCallback, useContext, useEffect, useMemo, useState, type JSX } from 'react';
import './styles/requirementsView.scss';
import { inferInputType, isAnswerEmpty, type RequirementsAnswer, type RequirementsData, type RequirementsOption, type RequirementsQuestion, type RequirementsRecommendedChoice } from './utils/parseRequirements';

interface DraftMap {
    [questionId: string]: RequirementsAnswer;
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

function defaultDraftFor(question: RequirementsQuestion): RequirementsAnswer {
    if (!isAnswerEmpty(question.answer)) {
        return question.answer;
    }
    const rec = question.recommendedChoice;
    if (rec === undefined) {
        return question.answer;
    }
    // Multi-select question (answer typed as array): always return an array,
    // wrapping a string recommendation if needed.
    if (Array.isArray(question.answer)) {
        return Array.isArray(rec) ? rec.slice() : [rec];
    }
    // Single-value question: take the first if recommendation is an array.
    return Array.isArray(rec) ? (rec[0] ?? null) : rec;
}

export const RequirementsView = (): JSX.Element => {
    const [data, setData] = useState<RequirementsData | null>(null);
    const [drafts, setDrafts] = useState<DraftMap>({});
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const { vscodeApi } = useContext(WebviewContext);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message?.command === 'setRequirementsData') {
                const incoming = message.data as RequirementsData;
                setData(incoming);
                // Seed drafts from the file. When a question is missing an answer
                // but has a recommendedChoice, pre-select the recommendation so
                // the user just has to review-and-submit rather than fill from
                // scratch.
                const nextDrafts: DraftMap = {};
                for (const q of incoming.questions) {
                    nextDrafts[q.id] = defaultDraftFor(q);
                }
                setDrafts(nextDrafts);
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
        setSaveError(null);
    }, []);

    const grouped = useMemo(() => {
        if (!data) {
            return [] as { category: string; questions: RequirementsQuestion[] }[];
        }
        const map = new Map<string, RequirementsQuestion[]>();
        for (const q of data.questions) {
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
            return isAnswerEmpty(effective);
        });
    }, [data, drafts]);

    const canSubmit = data !== null && missingRequired.length === 0 && !isSaving;

    const handleSubmit = useCallback(() => {
        if (!data || !canSubmit) {
            return;
        }
        const updatedQuestions = data.questions.map(q => {
            const draftAnswer = drafts[q.id];
            const effective = draftAnswer === undefined ? q.answer : draftAnswer;
            // Every visible answer that has a value at submit time counts as
            // confirmed by the user — they reviewed the form and clicked submit.
            const nextStatus = isAnswerEmpty(effective) ? q.status : 'confirmed';
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
    }, [data, canSubmit, drafts, vscodeApi]);

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

    const needsInputCount = missingRequired.length;
    const totalCount = data.questions.length;
    const filledCount = totalCount - needsInputCount;

    return (
        <div className='requirementsView'>
            <header className='requirementsHeader'>
                <div className='headerText'>
                    <h1>Project requirements</h1>
                    <p className='summary'>
                        {needsInputCount === 0
                            ? 'Review the pre-filled answers below. Adjust anything that doesn\'t fit, then submit.'
                            : `Review the pre-filled answers and complete the ${needsInputCount} item${needsInputCount === 1 ? '' : 's'} that still need input.`}
                    </p>
                </div>
                <div className='headerActions'>
                    <Tooltip
                        relationship='label'
                        content={
                            missingRequired.length === 0
                                ? 'Save answers and generate the scaffold plan.'
                                : `Please answer ${missingRequired.length} remaining question${missingRequired.length === 1 ? '' : 's'}.`
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
                    <div className='progress'>
                        <span>{filledCount}/{totalCount} answered</span>
                    </div>
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

            {grouped.map(group => {
                const label = categoryLabel(group.category);
                return (
                    <section className='categoryCard' key={group.category}>
                        <header className='categoryHeader'>
                            <h2>{label}</h2>
                        </header>
                        <ul className='questionList'>
                            {group.questions.map(q => {
                                const hideHeader = group.questions.length === 1;
                                return (
                                    <QuestionRow
                                        key={q.id}
                                        question={q}
                                        draft={drafts[q.id] === undefined ? q.answer : drafts[q.id]}
                                        hideHeader={hideHeader}
                                        onChange={(value) => updateDraft(q.id, value)}
                                    />
                                );
                            })}
                        </ul>
                    </section>
                );
            })}
        </div>
    );
};

const QuestionRow = ({
    question,
    draft,
    hideHeader,
    onChange,
}: {
    question: RequirementsQuestion;
    draft: RequirementsAnswer;
    hideHeader: boolean;
    onChange: (value: RequirementsAnswer) => void;
}): JSX.Element => {
    const inputType = inferInputType(draft ?? question.answer, question.options, question.multiSelect);
    const isMissing = isAnswerEmpty(draft);
    const heading = question.header ?? question.question;
    const showSubtext = question.header !== undefined && question.question && question.question !== question.header;

    return (
        <li className={`questionRow ${isMissing ? 'questionRow--missing' : ''}`}>
            {!hideHeader && (
                <div className='questionMeta'>
                    <span className='questionText'>{heading}</span>
                </div>
            )}
            {showSubtext && (
                <p className='questionSubtext'>{question.question}</p>
            )}
            <div className='questionInput'>
                <AnswerInput
                    inputType={inputType}
                    options={question.options}
                    recommendedChoice={question.recommendedChoice}
                    allowFreeformInput={question.allowFreeformInput}
                    value={draft}
                    onChange={onChange}
                />
            </div>
        </li>
    );
};

const AnswerInput = ({
    inputType,
    options,
    recommendedChoice,
    allowFreeformInput,
    value,
    onChange,
}: {
    inputType: ReturnType<typeof inferInputType>;
    options: RequirementsOption[] | undefined;
    recommendedChoice: RequirementsRecommendedChoice | undefined;
    allowFreeformInput: boolean | undefined;
    value: RequirementsAnswer;
    onChange: (next: RequirementsAnswer) => void;
}): JSX.Element => {
    if ((inputType === 'select' || inputType === 'multiselect') && options && options.length > 0) {
        return (
            <OptionsList
                multiSelect={inputType === 'multiselect'}
                options={options}
                recommendedChoice={recommendedChoice}
                allowFreeformInput={allowFreeformInput}
                value={value}
                onChange={onChange}
            />
        );
    }

    if (inputType === 'tags') {
        const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
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
        const text = String(value ?? '');
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

    const text = String(value ?? '');
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

const OptionsList = ({
    multiSelect,
    options,
    recommendedChoice,
    allowFreeformInput,
    value,
    onChange,
}: {
    multiSelect: boolean;
    options: RequirementsOption[];
    recommendedChoice: RequirementsRecommendedChoice | undefined;
    allowFreeformInput: boolean | undefined;
    value: RequirementsAnswer;
    onChange: (next: RequirementsAnswer) => void;
}): JSX.Element => {
    const optionLabels = useMemo(() => options.map(o => o.label), [options]);

    const selected = useMemo<string[]>(() => {
        if (multiSelect) {
            return Array.isArray(value) ? value : [];
        }
        return typeof value === 'string' && value.length > 0 ? [value] : [];
    }, [multiSelect, value]);

    const recommendedSet = useMemo<Set<string>>(() => {
        if (recommendedChoice === undefined) {
            return new Set();
        }
        return new Set(Array.isArray(recommendedChoice) ? recommendedChoice : [recommendedChoice]);
    }, [recommendedChoice]);

    const customAnswer = useMemo(() => {
        if (multiSelect) {
            return selected.filter(v => !optionLabels.includes(v)).join(', ');
        }
        return selected.length === 1 && !optionLabels.includes(selected[0]) ? selected[0] : '';
    }, [multiSelect, optionLabels, selected]);

    const handleOptionClick = (label: string) => {
        if (multiSelect) {
            const optionsSelected = selected.filter(v => optionLabels.includes(v));
            const customExtras = selected.filter(v => !optionLabels.includes(v));
            const nextOptionsSelected = optionsSelected.includes(label)
                ? optionsSelected.filter(v => v !== label)
                : [...optionsSelected, label];
            onChange([...nextOptionsSelected, ...customExtras]);
        } else {
            onChange(label);
        }
    };

    const handleCustomChange = (text: string) => {
        if (multiSelect) {
            const optionsSelected = selected.filter(v => optionLabels.includes(v));
            const customValues = text.split(',').map(s => s.trim()).filter(s => s.length > 0);
            onChange([...optionsSelected, ...customValues]);
        } else {
            onChange(text);
        }
    };

    const showFreeform = allowFreeformInput !== false;

    return (
        <div className={`optionsList ${multiSelect ? 'optionsList--multi' : 'optionsList--single'}`} role={multiSelect ? 'group' : 'radiogroup'}>
            {options.map((option, idx) => {
                const isSelected = selected.includes(option.label);
                const isRecommended = recommendedSet.has(option.label);
                return (
                    <button
                        key={option.label}
                        type='button'
                        role={multiSelect ? 'checkbox' : 'radio'}
                        aria-checked={isSelected}
                        className={`optionsList__row ${isSelected ? 'optionsList__row--selected' : ''}`}
                        onClick={() => handleOptionClick(option.label)}
                    >
                        <span className='optionsList__indicator' aria-hidden='true'>
                            {multiSelect
                                ? (isSelected
                                    ? <CheckmarkRegular className='optionsList__checkboxIcon optionsList__checkboxIcon--checked' />
                                    : <CheckboxUncheckedRegular className='optionsList__checkboxIcon' />)
                                : (isSelected
                                    ? <CheckmarkRegular className='optionsList__radioIcon optionsList__radioIcon--checked' />
                                    : <span className='optionsList__radioDot' />)
                            }
                        </span>
                        <span className='optionsList__index'>{idx + 1}</span>
                        <span className='optionsList__labelGroup'>
                            <span className='optionsList__label'>{option.label}</span>
                            {option.description && (
                                <span className='optionsList__description'>{option.description}</span>
                            )}
                        </span>
                        {isRecommended && (
                            <span className='optionsList__recommended'>Recommended</span>
                        )}
                    </button>
                );
            })}
            {showFreeform && (
                <div className='optionsList__row optionsList__row--custom'>
                    <span className='optionsList__indicator optionsList__indicator--blank' aria-hidden='true' />
                    <span className='optionsList__index'>{options.length + 1}</span>
                    <Input
                        size='small'
                        value={customAnswer}
                        placeholder={multiSelect ? 'Add custom values (comma-separated)' : 'Enter custom answer'}
                        onChange={(_, data) => handleCustomChange(data.value)}
                        className='optionsList__customInput'
                    />
                </div>
            )}
        </div>
    );
};

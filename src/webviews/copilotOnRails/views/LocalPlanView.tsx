/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Checkbox, CounterBadge, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Input, Option, Spinner, Textarea, Tooltip } from '@fluentui/react-components';
import { CheckmarkRegular, CommentEditRegular, DismissRegular, DocumentRegular, SendRegular, WarningRegular } from '@fluentui/react-icons';
import { WebviewContext } from '@microsoft/vscode-azext-webview/webview';
import * as jsoncParser from 'jsonc-parser';
import mermaid from 'mermaid';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { StageProgress } from './components/StageProgress';
import './styles/localPlanView.scss';
import { type LocalPlanContent, type LocalPlanData, type LocalPlanSection } from './utils/parseLocalPlanMarkdown';

mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    fontSize: 30,
    flowchart: {
        nodeSpacing: 60,
        rankSpacing: 80,
        padding: 20,
        useMaxWidth: false,
    },
});
let mermaidIdCounter = 0;

const alwaysExpandedSections = new Set(['project analysis', 'prerequisites', 'scan results']);
const defaultOpenSections = new Set(['architecture diagram']);
const editableCodeSections = new Set(['launch configuration']);

const COMPOUND_LAUNCH_NAME_REGEX = /^Compound Launch Config Name:\s*✏️\s*\*\*([^*]+?)\*\*\s*$/u;
const GENERATE_TOGGLE_REGEX = /^\*\*Generate:\*\*\s*\[([ x])\]\s*$/u;
const GENERATE_HEADER = 'generate';

function isDatabaseConfigSection(title: string | undefined): boolean {
    return (title ?? '').toLowerCase().trim() === 'database configuration';
}

function isPortRegistrySection(title: string | undefined): boolean {
    return (title ?? '').toLowerCase().trim() === 'port registry';
}

function isGenerationOptionsSection(title: string | undefined): boolean {
    return (title ?? '').toLowerCase().trim() === 'generation options';
}

function isServicesSection(title: string | undefined): boolean {
    return (title ?? '').toLowerCase().trim() === 'services';
}

function isEmulatorsSection(title: string | undefined): boolean {
    return (title ?? '').toLowerCase().trim() === 'emulators';
}

function isConnectionStringsSection(title: string | undefined): boolean {
    const lower = (title ?? '').toLowerCase().trim();
    return lower === 'connection strings' || lower === 'connection string';
}

function isExistingConfigurationSection(title: string | undefined): boolean {
    const lower = (title ?? '').toLowerCase().trim();
    return lower === 'existing configuration' || lower === 'existing config';
}

function findGenerateColumnIdx(headers: string[]): number {
    return headers.findIndex(h => h.toLowerCase().trim() === GENERATE_HEADER);
}

function findLaunchConfigNameColumnIdx(headers: string[]): number {
    return headers.findIndex(h => h.toLowerCase().trim() === 'launch config name');
}

function buildTableRowMarkdown(cells: string[]): string {
    return `| ${cells.map(c => c.trim()).join(' | ')} |`;
}

interface PlanSectionContextValue {
    sectionTitle: string;
    subsectionTitle?: string;
}
const PlanSectionContext = createContext<PlanSectionContextValue>({ sectionTitle: '' });

interface PlanLineEditContextValue {
    submitPlanEdit: (lineStart: number, lineEnd: number, newText: string) => Promise<void>;
    showEditError: (message: string) => void;
    setSourceFeedback: (sourceKey: string, text: string | null) => void;
}
const PlanLineEditContext = createContext<PlanLineEditContextValue>({
    submitPlanEdit: async () => { /* no-op */ },
    showEditError: () => { /* no-op */ },
    setSourceFeedback: () => { /* no-op */ },
});

type ParagraphBlock = Extract<LocalPlanContent, { type: 'paragraph' }>;
type TableBlock = Extract<LocalPlanContent, { type: 'table' }>;

interface CodeEditNoteContextValue {
    addCodeEditNote: (language: string, oldCode: string, newCode: string) => void;
    updateCodeBlock: (originalCode: string, newCode: string, language: string) => Promise<void>;
    showCodeEditError: (message: string) => void;
}
const CodeEditNoteContext = createContext<CodeEditNoteContextValue>({
    addCodeEditNote: () => { /* no-op */ },
    updateCodeBlock: async () => { /* no-op */ },
    showCodeEditError: () => { /* no-op */ },
});

function buildCodeEditNote(language: string, _oldCode: string, newCode: string): string {
    const langLabel = language?.trim() ? language.trim() : 'code';
    const fence = `\`\`\`${language?.trim() ?? ''}`;
    return [
        `I directly edited the ${langLabel} block in the Launch Configuration section. The plan file now contains:`,
        '',
        fence,
        newCode,
        '```',
        '',
        'Please make sure any generated files (.vscode/launch.json, .vscode/tasks.json, etc.) and any related plan content stay consistent with this updated block.',
    ].join('\n');
}

interface FeedbackItem {
    id: string;
    text: string;
    sourceKey?: string;
}

let feedbackIdCounter = 0;
const nextId = (): string => `fb-${++feedbackIdCounter}`;

function buildFeedbackPrompt(items: FeedbackItem[]): string {
    const notes = items
        .map(i => `- ${i.text.trim()}`)
        .filter(t => t.length > 2);

    const lines: string[] = [
        'Please revise the local development plan based on my feedback and update vscode-debug-plan.md.',
        'Keep existing sections unchanged unless a change below implies otherwise. Wait for my approval after updating the file.',
        '',
    ];
    if (notes.length > 0) {
        lines.push('Notes:', ...notes, '');
    }
    return lines.join('\n').trimEnd();
}

export const LocalPlanView = (): JSX.Element => {
    const [plan, setPlan] = useState<LocalPlanData | null>(null);
    const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
    const [freeformDraft, setFreeformDraft] = useState('');
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [isAwaitingRevision, setIsAwaitingRevision] = useState(false);
    const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
    const [codeEditError, setCodeEditError] = useState<string | null>(null);
    const { vscodeApi } = useContext(WebviewContext);
    const pendingCodeBlockUpdatesRef = useRef<Map<string, { resolve: () => void; reject: (message: string) => void }>>(new Map());
    const pendingPlanLineEditsRef = useRef<Map<string, { resolve: () => void; reject: (message: string) => void }>>(new Map());

    const hasEdits = useMemo(
        () => feedbackItems.length > 0 || freeformDraft.trim().length > 0,
        [feedbackItems, freeformDraft],
    );

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message?.command === 'setLocalPlanData') {
                setPlan(message.data as LocalPlanData);
                // New plan data from the controller — either the initial load or a
                // post-revision refresh. Either way, clear pending feedback state.
                setFeedbackItems([]);
                setFreeformDraft('');
            } else if (message?.command === 'revisionInProgress') {
                setIsAwaitingRevision(true);
                setDrawerOpen(false);
            } else if (message?.command === 'revisionComplete') {
                setIsAwaitingRevision(false);
            } else if (message?.command === 'codeBlockUpdated') {
                const requestId = typeof message.requestId === 'string' ? message.requestId : undefined;
                if (!requestId) {
                    return;
                }
                const pending = pendingCodeBlockUpdatesRef.current.get(requestId);
                if (!pending) {
                    return;
                }
                pendingCodeBlockUpdatesRef.current.delete(requestId);
                pending.resolve();
            } else if (message?.command === 'codeBlockUpdateError') {
                const errorMessage = typeof message.error === 'string' ? message.error : 'Failed to save changes to the plan file.';
                const requestId = typeof message.requestId === 'string' ? message.requestId : undefined;
                if (requestId) {
                    const pending = pendingCodeBlockUpdatesRef.current.get(requestId);
                    if (pending) {
                        pendingCodeBlockUpdatesRef.current.delete(requestId);
                        pending.reject(errorMessage);
                        return;
                    }
                }
                setCodeEditError(errorMessage);
            } else if (message?.command === 'planLinesUpdated') {
                const requestId = typeof message.requestId === 'string' ? message.requestId : undefined;
                if (!requestId) {
                    return;
                }
                const pending = pendingPlanLineEditsRef.current.get(requestId);
                if (!pending) {
                    return;
                }
                pendingPlanLineEditsRef.current.delete(requestId);
                pending.resolve();
            } else if (message?.command === 'planLinesUpdateError') {
                const errorMessage = typeof message.error === 'string' ? message.error : 'Failed to save changes to the plan file.';
                const requestId = typeof message.requestId === 'string' ? message.requestId : undefined;
                if (requestId) {
                    const pending = pendingPlanLineEditsRef.current.get(requestId);
                    if (pending) {
                        pendingPlanLineEditsRef.current.delete(requestId);
                        pending.reject(errorMessage);
                        return;
                    }
                }
                setCodeEditError(errorMessage);
            }
        };
        window.addEventListener('message', handler);
        vscodeApi.postMessage({ command: 'ready' });
        return () => {
            window.removeEventListener('message', handler);
            pendingCodeBlockUpdatesRef.current.forEach((pending) => pending.reject('The edit request was cancelled before completion.'));
            pendingCodeBlockUpdatesRef.current.clear();
            pendingPlanLineEditsRef.current.forEach((pending) => pending.reject('The edit request was cancelled before completion.'));
            pendingPlanLineEditsRef.current.clear();
        };
    }, []);

    const handleApprove = useCallback(() => {
        if (!plan) {
            return;
        }
        if (hasEdits) {
            setConfirmSubmitOpen(true);
            return;
        }
        vscodeApi.postMessage({ command: 'approvePlan', data: plan });
    }, [plan, hasEdits, vscodeApi]);

    const handleRemoveFeedback = useCallback((id: string) => {
        setFeedbackItems(prev => prev.filter(i => i.id !== id));
    }, []);

    const addCodeEditNote = useCallback((language: string, oldCode: string, newCode: string) => {
        const text = buildCodeEditNote(language, oldCode, newCode);
        setFeedbackItems(prev => [...prev, { id: nextId(), text }]);
        setDrawerOpen(true);
    }, []);

    const showCodeEditError = useCallback((message: string) => {
        setCodeEditError(message);
    }, []);

    const updateCodeBlock = useCallback((originalCode: string, newCode: string, language: string): Promise<void> => {
        const requestId = `code-update-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return new Promise<void>((resolve, reject) => {
            pendingCodeBlockUpdatesRef.current.set(requestId, { resolve, reject });
            vscodeApi.postMessage({
                command: 'updateCodeBlock',
                requestId,
                originalCode,
                language,
                newCode,
            });
        });
    }, [vscodeApi]);

    const codeEditContextValue = useMemo<CodeEditNoteContextValue>(
        () => ({ addCodeEditNote, updateCodeBlock, showCodeEditError }),
        [addCodeEditNote, updateCodeBlock, showCodeEditError],
    );

    const submitPlanEdit = useCallback((lineStart: number, lineEnd: number, newText: string): Promise<void> => {
        const requestId = `plan-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return new Promise<void>((resolve, reject) => {
            pendingPlanLineEditsRef.current.set(requestId, { resolve, reject });
            vscodeApi.postMessage({
                command: 'updatePlanLines',
                requestId,
                lineStart,
                lineEnd,
                newText,
            });
        });
    }, [vscodeApi]);

    const setSourceFeedback = useCallback((sourceKey: string, text: string | null) => {
        setFeedbackItems(prev => {
            const filtered = prev.filter(i => i.sourceKey !== sourceKey);
            if (text === null) {
                return filtered;
            }
            return [...filtered, { id: nextId(), sourceKey, text }];
        });
        if (text !== null) {
            setDrawerOpen(true);
        }
    }, []);

    const planLineEditContextValue = useMemo<PlanLineEditContextValue>(
        () => ({ submitPlanEdit, showEditError: showCodeEditError, setSourceFeedback }),
        [submitPlanEdit, showCodeEditError, setSourceFeedback],
    );

    const handleAddNote = useCallback(() => {
        const text = freeformDraft.trim();
        if (!text) {
            return;
        }
        setFeedbackItems(prev => [...prev, { id: nextId(), text }]);
        setFreeformDraft('');
    }, [freeformDraft]);

    const handleDiscardAll = useCallback(() => {
        setFeedbackItems([]);
        setFreeformDraft('');
    }, []);

    const handleSubmitFeedback = useCallback(() => {
        if (!plan || !hasEdits) {
            return;
        }
        const draftTrimmed = freeformDraft.trim();
        const items = draftTrimmed.length > 0
            ? [...feedbackItems, { id: nextId(), text: draftTrimmed }]
            : feedbackItems;
        const prompt = buildFeedbackPrompt(items);
        vscodeApi.postMessage({ command: 'submitPlanFeedback', prompt, data: plan });
        setIsAwaitingRevision(true);
        setDrawerOpen(false);
        setConfirmSubmitOpen(false);
    }, [plan, hasEdits, feedbackItems, freeformDraft, vscodeApi]);

    if (!plan) {
        return <div className='localPlanView'><p>Loading local dev plan...</p></div>;
    }

    if (plan.parseError) {
        return (
            <div className='localPlanView'>
                <div className='parseFailureWarning' role='alert'>
                    <div className='parseFailureIcon'><WarningRegular /></div>
                    <div className='parseFailureBody'>
                        <h2>We couldn't render this plan</h2>
                        <p>{plan.parseError.message}</p>
                        {plan.parseError.fileLabel && (
                            <p className='parseFailureFile'><strong>Plan file:</strong> {plan.parseError.fileLabel}</p>
                        )}
                        <Button
                            appearance='primary'
                            icon={<DocumentRegular />}
                            onClick={() => vscodeApi.postMessage({ command: 'openSourceFile' })}
                        >
                            Open plan file
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`localPlanView ${drawerOpen ? 'drawerOpen' : ''} ${isAwaitingRevision ? 'revising' : ''}`}>
            <StageProgress currentStage={1} />
            <div className='planMain'>
                <div className='planHeader'>
                    <div className='headerTop'>
                        <div>
                            <h1>{plan.title}</h1>
                            <div className='metadataBadges'>
                                {plan.status && plan.status !== 'Unknown' && <span className='badge'>{plan.status}</span>}
                            </div>
                        </div>
                        <div className='headerActions'>
                            <Tooltip content='Request changes to the plan before approving' relationship='label'>
                                <Button
                                    appearance='subtle'
                                    aria-label='Feedback'
                                    icon={
                                        <span className='feedbackIconWrapper'>
                                            <CommentEditRegular />
                                            {hasEdits && (
                                                <CounterBadge
                                                    className='feedbackBadge'
                                                    count={feedbackItems.length + (freeformDraft.trim() ? 1 : 0)}
                                                    size='small'
                                                    color='danger'
                                                />
                                            )}
                                        </span>
                                    }
                                    disabled={isAwaitingRevision}
                                    onClick={() => setDrawerOpen(v => !v)}
                                />
                            </Tooltip>
                            <Button
                                appearance='primary'
                                icon={<CheckmarkRegular />}
                                disabled={isAwaitingRevision}
                                onClick={handleApprove}
                            >
                                Approve Plan
                            </Button>
                        </div>
                    </div>
                </div>

                {isAwaitingRevision && (
                    <div className='revisionBanner' role='status' aria-live='polite'>
                        <Spinner size='tiny' />
                        <span>Copilot is revising the plan…</span>
                    </div>
                )}

                {plan.sections
                    .filter((s) => !shouldHideSection(s))
                    .sort((a, b) => sectionSortOrder(a.title) - sectionSortOrder(b.title))
                    .map((section, i) => {
                        const lower = section.title.toLowerCase();
                        const collapsible = !alwaysExpandedSections.has(lower);
                        const defaultOpen = !collapsible || defaultOpenSections.has(lower);
                        const codeEditable = editableCodeSections.has(lower);
                        return (
                            <CodeEditNoteContext.Provider key={i} value={codeEditContextValue}>
                                <PlanLineEditContext.Provider value={planLineEditContextValue}>
                                    <PlanSectionContext.Provider value={{ sectionTitle: section.title }}>
                                        <SectionCard
                                            section={section}
                                            collapsible={collapsible}
                                            defaultOpen={defaultOpen}
                                            codeEditable={codeEditable}
                                        />
                                    </PlanSectionContext.Provider>
                                </PlanLineEditContext.Provider>
                            </CodeEditNoteContext.Provider>
                        );
                    })}
            </div>

            {drawerOpen && !isAwaitingRevision && (
                <FeedbackDrawer
                    items={feedbackItems}
                    freeformDraft={freeformDraft}
                    onFreeformChange={setFreeformDraft}
                    onAddNote={handleAddNote}
                    onRemoveItem={handleRemoveFeedback}
                    onSubmit={handleSubmitFeedback}
                    onDiscardAll={handleDiscardAll}
                    onClose={() => setDrawerOpen(false)}
                />
            )}

            <SubmitEditsDialog
                open={confirmSubmitOpen}
                editCount={feedbackItems.length + (freeformDraft.trim() ? 1 : 0)}
                onCancel={() => setConfirmSubmitOpen(false)}
                onSubmit={handleSubmitFeedback}
            />

            <CodeEditErrorDialog
                open={codeEditError !== null}
                message={codeEditError ?? ''}
                onClose={() => setCodeEditError(null)}
            />
        </div>
    );
};

interface FeedbackDrawerProps {
    items: FeedbackItem[];
    freeformDraft: string;
    onFreeformChange: (value: string) => void;
    onAddNote: () => void;
    onRemoveItem: (id: string) => void;
    onSubmit: () => void;
    onDiscardAll: () => void;
    onClose: () => void;
}

const FeedbackDrawer = ({ items, freeformDraft, onFreeformChange, onAddNote, onRemoveItem, onSubmit, onDiscardAll, onClose }: FeedbackDrawerProps): JSX.Element => {
    const hasAny = items.length > 0 || freeformDraft.trim().length > 0;
    return (
        <aside className='feedbackDrawer' aria-label='Plan feedback'>
            <div className='drawerHeader'>
                <h2>Request changes</h2>
                <Button
                    appearance='subtle'
                    icon={<DismissRegular />}
                    aria-label='Close feedback'
                    onClick={onClose}
                />
            </div>
            <p className='drawerInfo'>Your feedback will be sent to Copilot as a prompt. Copilot will revise the plan and update the file. The updated plan will reload here for your final approval.</p>

            <div className='drawerBody'>
                {items.length > 0 && (
                    <ul className='feedbackList'>
                        {items.map(item => (
                            <li key={item.id} className='feedbackItem freeform'>
                                <span className='feedbackFreeformText'>{item.text}</span>
                                <Button
                                    appearance='subtle'
                                    size='small'
                                    icon={<DismissRegular />}
                                    aria-label='Remove feedback item'
                                    onClick={() => onRemoveItem(item.id)}
                                />
                            </li>
                        ))}
                    </ul>
                )}

                <div className='freeformBlock'>
                    <Textarea
                        value={freeformDraft}
                        onChange={(_, data) => onFreeformChange(data.value)}
                        placeholder='Add a note for Copilot (e.g. "Use Azurite instead of the storage emulator")'
                        rows={3}
                        resize='vertical'
                    />
                    <div className='freeformActions'>
                        <Button
                            appearance='secondary'
                            size='small'
                            disabled={freeformDraft.trim().length === 0}
                            onClick={onAddNote}
                        >
                            Add note
                        </Button>
                    </div>
                </div>
            </div>

            <div className='drawerFooter'>
                <Button
                    appearance='subtle'
                    disabled={!hasAny}
                    onClick={onDiscardAll}
                >
                    Discard all
                </Button>
                <Button
                    appearance='primary'
                    icon={<SendRegular />}
                    disabled={!hasAny}
                    onClick={onSubmit}
                >
                    Submit feedback
                </Button>
            </div>
        </aside>
    );
};

interface SubmitEditsDialogProps {
    open: boolean;
    editCount: number;
    onCancel: () => void;
    onSubmit: () => void;
}

const SubmitEditsDialog = ({ open, editCount, onCancel, onSubmit }: SubmitEditsDialogProps): JSX.Element => (
    <Dialog open={open} onOpenChange={(_, data) => { if (!data.open) { onCancel(); } }}>
        <DialogSurface>
            <DialogBody>
                <DialogTitle>Submit edits to Copilot?</DialogTitle>
                <DialogContent>
                    {editCount > 0
                        ? `You have ${editCount} pending edit${editCount === 1 ? '' : 's'}. Would you like to submit ${editCount === 1 ? 'it' : 'them'} to Copilot to revise the plan?`
                        : 'Edits were made. Would you like to submit those edits to Copilot?'}
                </DialogContent>
                <DialogActions>
                    <Button appearance='secondary' onClick={onCancel}>Cancel</Button>
                    <Button appearance='primary' icon={<SendRegular />} onClick={onSubmit}>Submit</Button>
                </DialogActions>
            </DialogBody>
        </DialogSurface>
    </Dialog>
);

const SectionCard = ({ section, collapsible, defaultOpen, codeEditable }: { section: LocalPlanSection; collapsible: boolean; defaultOpen: boolean; codeEditable: boolean }): JSX.Element => {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className='sectionCard'>
            <div
                className={`sectionHeading ${collapsible ? 'clickable' : ''}`}
                onClick={() => collapsible && setOpen(!open)}
            >
                {collapsible && <span className={`sectionChevron ${open ? 'open' : ''}`}>▶</span>}
                <h2>{section.title}</h2>
            </div>
            {open && (
                <div className='sectionContent'>
                    {isEmulatorsSection(section.title) ? (
                        <EmulatorsTable section={section} codeEditable={codeEditable} />
                    ) : section.content.map((item, i) => (
                        <ContentBlock key={i} item={item} codeEditable={codeEditable} />
                    ))}
                </div>
            )}
        </div>
    );
};

function isHiddenSection(title: string): boolean {
    const lower = title.toLowerCase();
    return lower === 'execution checklist'
        || lower === 'manual tests'
        || lower === 'table of contents'
        || lower === 'debug configuration checklist'
        || lower === 'convenience scripts'
        || lower === 'api test collections'
        || lower === 'migrations';
}

function hasDetectedFeatures(content: LocalPlanContent[]): boolean {
    for (const item of content) {
        if (item.type === 'bulletList' && item.items.length > 0) { return true; }
        if (item.type === 'table' && item.rows.length > 0) { return true; }
        if (item.type === 'subsection' && hasDetectedFeatures(item.content)) { return true; }
    }
    return false;
}

function shouldHideSection(section: LocalPlanSection): boolean {
    if (isHiddenSection(section.title)) { return true; }
    if (section.title.toLowerCase().trim() === 'limited support') {
        return !hasDetectedFeatures(section.content);
    }
    return false;
}

function isHiddenSubsection(title: string): boolean {
    const lower = title.toLowerCase();
    return lower === 'task configuration'
        || lower === 'build configuration'
        || lower === 'task/build configuration'
        || lower === 'task / build configuration'
        || lower === 'tasks configuration'
        || lower === 'build task'
        || lower === 'build tasks';
}

function isFlattenedSubsection(title: string): boolean {
    const lower = title.toLowerCase();
    return lower === 'debug configuration'
        || lower === 'launch configuration'
        || lower === 'launch configurations'
        || lower === 'debug/launch configuration'
        || lower === 'debug / launch configuration'
        || lower === 'debug configurations';
}

function sectionSortOrder(title: string): number {
    const lower = title.toLowerCase();
    if (lower === 'prerequisites') { return 0; }
    if (lower === 'architecture diagram') { return 1; }
    return 2;
}

const ContentBlock = ({ item, codeEditable }: { item: LocalPlanContent; codeEditable: boolean }): JSX.Element | null => {
    const sectionCtx = useContext(PlanSectionContext);
    switch (item.type) {
        case 'table':
            if (isDatabaseConfigSection(sectionCtx.sectionTitle)) {
                return <EditableValueTable table={item} valueColumnIdx={1} />;
            }
            if (isPortRegistrySection(sectionCtx.sectionTitle)) {
                return <EditableValueTable table={item} valueColumnIdx={0} />;
            }
            if (isGenerationOptionsSection(sectionCtx.sectionTitle) && findGenerateColumnIdx(item.headers) >= 0) {
                return <EditableGenerateTable table={item} />;
            }
            if (isServicesSection(sectionCtx.sectionTitle)) {
                if (findGenerateColumnIdx(item.headers) >= 0) {
                    return <ServicesTable table={item} />;
                }
                return <DataTable headers={item.headers} rows={item.rows} />;
            }
            if (isConnectionStringsSection(sectionCtx.sectionTitle)) {
                return <ConnectionStringsTable table={item} />;
            }
            if (isExistingConfigurationSection(sectionCtx.sectionTitle)) {
                return <ExistingConfigurationTable table={item} />;
            }
            return <TableAsList rows={item.rows} />;
        case 'codeBlock':
            if (item.language?.toLowerCase() === 'mermaid') {
                return <MermaidBlock code={item.code} />;
            }
            if (codeEditable) {
                return <EditableCodeBlock language={item.language} code={item.code} />;
            }
            return <CodeBlock language={item.language} code={item.code} />;
        case 'bulletList':
            return <BulletListBlock items={item.items} />;
        case 'blockquote':
            return <BlockquoteBlock text={item.text} />;
        case 'paragraph': {
            const compoundMatch = item.text.match(COMPOUND_LAUNCH_NAME_REGEX);
            if (compoundMatch) {
                return <EditableLaunchName paragraph={item} currentName={compoundMatch[1]} />;
            }
            const generateMatch = item.text.match(GENERATE_TOGGLE_REGEX);
            if (generateMatch && isGenerationOptionsSection(sectionCtx.sectionTitle)) {
                return <EditableGenerateToggleParagraph paragraph={item} checked={generateMatch[1] === 'x'} />;
            }
            return <p className='paragraph' dangerouslySetInnerHTML={{ __html: formatInline(item.text) }} />;
        }
        case 'subsection':
            if (isHiddenSubsection(item.title)) { return null; }
            if (isFlattenedSubsection(item.title)) {
                return (
                    <>
                        {item.content.map((child, i) => (
                            <ContentBlock key={i} item={child} codeEditable={codeEditable} />
                        ))}
                    </>
                );
            }
            return <SubsectionBlock title={item.title} content={item.content} codeEditable={codeEditable} />;
    }
};

const TableAsList = ({ rows }: { rows: string[][] }): JSX.Element => (
    <ul className='bulletList'>
        {rows.map((row, ri) => {
            const [label, ...rest] = row;
            const value = rest.join(' — ').trim();
            const html = value
                ? `<strong>${formatInline(label)}</strong>: ${formatInline(value)}`
                : formatInline(label);
            return <li key={ri} dangerouslySetInnerHTML={{ __html: html }} />;
        })}
    </ul>
);

const DataTable = ({ headers, rows }: { headers: string[]; rows: string[][] }): JSX.Element => (
    <div className='dataTableWrapper'>
        <table className='dataTable'>
            <thead>
                <tr>
                    {headers.map((h, hi) => (
                        <th key={hi} dangerouslySetInnerHTML={{ __html: formatInline(h) }} />
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map((row, ri) => (
                    <tr key={ri}>
                        {row.map((cell, ci) => (
                            <td key={ci} dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const ServicesTable = ({ table }: { table: TableBlock }): JSX.Element => {
    const { setSourceFeedback, submitPlanEdit, showEditError } = useContext(PlanLineEditContext);
    const generateIdx = findGenerateColumnIdx(table.headers);
    const launchNameIdx = findLaunchConfigNameColumnIdx(table.headers);
    const originalStates = useMemo(
        () => table.rows.map(r => /^yes$/i.test((r[generateIdx] ?? '').trim())),
        [table.rows, generateIdx],
    );
    const [states, setStates] = useState<boolean[]>(originalStates);
    const originalLaunchNames = useMemo(
        () => table.rows.map(r => (r[launchNameIdx] ?? '').trim()),
        [table.rows, launchNameIdx],
    );
    const [launchNameDrafts, setLaunchNameDrafts] = useState<string[]>(originalLaunchNames);
    const [savingRow, setSavingRow] = useState<number | null>(null);
    const focusedRowRef = useRef<number | null>(null);

    useEffect(() => {
        setStates(originalStates);
    }, [originalStates]);

    useEffect(() => {
        if (focusedRowRef.current === null) {
            setLaunchNameDrafts(originalLaunchNames);
        }
    }, [originalLaunchNames]);

    const toggleRow = useCallback((rowIdx: number) => {
        const next = !states[rowIdx];
        setStates(prev => { const arr = prev.slice(); arr[rowIdx] = next; return arr; });
        const rowLabel = (table.rows[rowIdx][launchNameIdx >= 0 ? launchNameIdx : 0] ?? '').trim() || `row ${rowIdx + 1}`;
        const sourceKey = `services-generate-${table.lineStart}-${rowIdx}`;
        if (next === originalStates[rowIdx]) {
            setSourceFeedback(sourceKey, null);
            return;
        }
        const desired = next ? 'Yes' : 'No';
        const text = `In the **Services** table, set **Generate** to **${desired}** for **${rowLabel}**.`;
        setSourceFeedback(sourceKey, text);
    }, [states, table, launchNameIdx, originalStates, setSourceFeedback]);

    const commitLaunchName = useCallback((rowIdx: number, next: string) => {
        const trimmed = next.trim();
        const original = originalLaunchNames[rowIdx];
        if (!trimmed) {
            setLaunchNameDrafts(prev => {
                const arr = prev.slice();
                arr[rowIdx] = original;
                return arr;
            });
            return;
        }
        if (trimmed === original) {
            return;
        }
        const newRow = table.rows[rowIdx].slice();
        newRow[launchNameIdx] = trimmed;
        const newLine = buildTableRowMarkdown(newRow);
        const lineIdx = table.rowLines[rowIdx];
        setSavingRow(rowIdx);
        submitPlanEdit(lineIdx, lineIdx, newLine)
            .catch((err: unknown) => {
                setLaunchNameDrafts(prev => {
                    const arr = prev.slice();
                    arr[rowIdx] = original;
                    return arr;
                });
                const message = err instanceof Error ? err.message : String(err);
                showEditError(message);
            })
            .finally(() => setSavingRow(null));
    }, [originalLaunchNames, table, launchNameIdx, submitPlanEdit, showEditError]);

    return (
        <div className='dataTableWrapper'>
            <table className='dataTable'>
                <thead>
                    <tr>
                        {table.headers.map((h, hi) => (
                            <th key={hi} dangerouslySetInnerHTML={{ __html: formatInline(h) }} />
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {table.rows.map((row, ri) => (
                        <tr key={ri}>
                            {row.map((cell, ci) => {
                                if (ci === generateIdx) {
                                    return (
                                        <td key={ci} className='dataTableCheckboxCell'>
                                            <Checkbox
                                                checked={states[ri]}
                                                onChange={() => toggleRow(ri)}
                                            />
                                        </td>
                                    );
                                }
                                if (ci === launchNameIdx) {
                                    return (
                                        <td key={ci} className='dataTableInputCell'>
                                            <Input
                                                size='small'
                                                value={launchNameDrafts[ri]}
                                                disabled={savingRow === ri}
                                                onChange={(_, data) => {
                                                    setLaunchNameDrafts(prev => {
                                                        const arr = prev.slice();
                                                        arr[ri] = data.value;
                                                        return arr;
                                                    });
                                                }}
                                                onFocus={() => { focusedRowRef.current = ri; }}
                                                onBlur={(e) => {
                                                    focusedRowRef.current = null;
                                                    commitLaunchName(ri, e.target.value);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        (e.target as HTMLInputElement).blur();
                                                    } else if (e.key === 'Escape') {
                                                        e.preventDefault();
                                                        setLaunchNameDrafts(prev => {
                                                            const arr = prev.slice();
                                                            arr[ri] = originalLaunchNames[ri];
                                                            return arr;
                                                        });
                                                        (e.target as HTMLInputElement).blur();
                                                    }
                                                }}
                                            />
                                        </td>
                                    );
                                }
                                return <td key={ci} dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />;
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

interface EmulatorInfo {
    subsectionTitle: string;
    port?: string;
    connection?: string;
    image?: { absoluteLine: number; prefix: string; value: string };
    dataDir?: { absoluteLine: number; prefix: string; suffix: string; value: string };
}

function parseEmulators(content: LocalPlanContent[]): EmulatorInfo[] {
    const emulators: EmulatorInfo[] = [];
    for (const item of content) {
        if (item.type !== 'subsection') { continue; }
        const info: EmulatorInfo = { subsectionTitle: item.title };
        for (const child of item.content) {
            if (child.type === 'bulletList') {
                for (const bullet of child.items) {
                    const portMatch = bullet.match(/^\*\*Port:\*\*\s*`?([^`]+?)`?\s*$/i);
                    if (portMatch) { info.port = portMatch[1].trim(); continue; }
                    const connMatch = bullet.match(/^\*\*Connection:\*\*\s*`?(.+?)`?\s*$/i);
                    if (connMatch) { info.connection = connMatch[1].trim(); }
                }
            } else if (child.type === 'codeBlock' && /^ya?ml$/i.test(child.language ?? '')) {
                const codeLines = child.code.split('\n');
                const codeStartLine = child.lineStart + 1;
                for (let li = 0; li < codeLines.length; li++) {
                    const ln = codeLines[li];
                    if (!info.image) {
                        const imgMatch = ln.match(/^(\s*image:\s*)(\S.*)$/);
                        if (imgMatch) {
                            info.image = {
                                absoluteLine: codeStartLine + li,
                                prefix: imgMatch[1],
                                value: imgMatch[2].trim(),
                            };
                            continue;
                        }
                    }
                    if (!info.dataDir) {
                        const volMatch = ln.match(/^(\s*-\s+)(\.{1,2}\/[^:\s]+)(:.+)$/);
                        if (volMatch) {
                            info.dataDir = {
                                absoluteLine: codeStartLine + li,
                                prefix: volMatch[1],
                                value: volMatch[2],
                                suffix: volMatch[3],
                            };
                        }
                    }
                }
            }
        }
        emulators.push(info);
    }
    return emulators;
}

function findEmulatorImageColumnIdx(headers: string[]): number {
    const lower = headers.map(h => h.toLowerCase().trim());
    const exact = ['image', 'image (version tag)', 'docker image', 'container image'];
    for (const name of exact) {
        const idx = lower.indexOf(name);
        if (idx >= 0) { return idx; }
    }
    return lower.findIndex(h => h.startsWith('image'));
}

function findEmulatorDataDirColumnIdx(headers: string[]): number {
    const lower = headers.map(h => h.toLowerCase().trim());
    const exact = ['data directory', 'data dir', 'data-directory', 'volume', 'data path'];
    for (const name of exact) {
        const idx = lower.indexOf(name);
        if (idx >= 0) { return idx; }
    }
    return lower.findIndex(h => h.includes('data') && (h.includes('dir') || h.includes('path')));
}

function findVariableNameColumnIdx(headers: string[]): number {
    const lower = headers.map(h => h.toLowerCase().trim());
    const exact = ['variable name', 'env var', 'environment variable', 'var name', 'variable'];
    for (const name of exact) {
        const idx = lower.indexOf(name);
        if (idx >= 0) { return idx; }
    }
    return lower.findIndex(h => h.includes('variable') || h.includes('env'));
}

const ConnectionStringsTable = ({ table }: { table: TableBlock }): JSX.Element => {
    const { submitPlanEdit, showEditError } = useContext(PlanLineEditContext);
    const varNameIdx = findVariableNameColumnIdx(table.headers);
    const originalNames = useMemo(
        () => table.rows.map(r => (varNameIdx >= 0 ? (r[varNameIdx] ?? '').trim() : '')),
        [table.rows, varNameIdx],
    );
    const [drafts, setDrafts] = useState<string[]>(originalNames);
    const [savingRow, setSavingRow] = useState<number | null>(null);
    const focusedRowRef = useRef<number | null>(null);

    useEffect(() => {
        if (focusedRowRef.current === null) { setDrafts(originalNames); }
    }, [originalNames]);

    const commitName = useCallback((rowIdx: number, next: string) => {
        const trimmed = next.trim();
        const original = originalNames[rowIdx];
        if (varNameIdx < 0) { return; }
        if (!trimmed) {
            setDrafts(prev => { const arr = prev.slice(); arr[rowIdx] = original; return arr; });
            return;
        }
        if (trimmed === original) { return; }
        const newRow = table.rows[rowIdx].slice();
        newRow[varNameIdx] = trimmed;
        const newLine = buildTableRowMarkdown(newRow);
        const lineIdx = table.rowLines[rowIdx];
        setSavingRow(rowIdx);
        submitPlanEdit(lineIdx, lineIdx, newLine)
            .catch((err: unknown) => {
                setDrafts(prev => { const arr = prev.slice(); arr[rowIdx] = original; return arr; });
                showEditError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => setSavingRow(null));
    }, [originalNames, table, varNameIdx, submitPlanEdit, showEditError]);

    if (varNameIdx < 0) {
        return <DataTable headers={table.headers} rows={table.rows} />;
    }

    return (
        <div className='dataTableWrapper'>
            <table className='dataTable'>
                <thead>
                    <tr>
                        {table.headers.map((h, hi) => (
                            <th key={hi} dangerouslySetInnerHTML={{ __html: formatInline(h) }} />
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {table.rows.map((row, ri) => (
                        <tr key={ri}>
                            {row.map((cell, ci) => {
                                if (ci === varNameIdx) {
                                    return (
                                        <td key={ci} className='dataTableInputCell'>
                                            <Input
                                                size='small'
                                                value={drafts[ri] ?? ''}
                                                disabled={savingRow === ri}
                                                onChange={(_, data) => setDrafts(prev => { const arr = prev.slice(); arr[ri] = data.value; return arr; })}
                                                onFocus={() => { focusedRowRef.current = ri; }}
                                                onBlur={(e) => {
                                                    focusedRowRef.current = null;
                                                    commitName(ri, e.target.value);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        (e.target as HTMLInputElement).blur();
                                                    } else if (e.key === 'Escape') {
                                                        e.preventDefault();
                                                        setDrafts(prev => { const arr = prev.slice(); arr[ri] = originalNames[ri]; return arr; });
                                                        (e.target as HTMLInputElement).blur();
                                                    }
                                                }}
                                            />
                                        </td>
                                    );
                                }
                                return <td key={ci} dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />;
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const EXISTING_CONFIG_ACTIONS = ['Merge', 'Create', 'Skip'] as const;

function findActionColumnIdx(headers: string[]): number {
    const lower = headers.map(h => h.toLowerCase().trim());
    return lower.indexOf('action');
}

function normalizeAction(value: string): string {
    const trimmed = value.trim();
    const match = EXISTING_CONFIG_ACTIONS.find(o => o.toLowerCase() === trimmed.toLowerCase());
    return match ?? trimmed;
}

const ExistingConfigurationTable = ({ table }: { table: TableBlock }): JSX.Element => {
    const { submitPlanEdit, showEditError } = useContext(PlanLineEditContext);
    const actionIdx = findActionColumnIdx(table.headers);
    const originalActions = useMemo(
        () => table.rows.map(r => (actionIdx >= 0 ? normalizeAction(r[actionIdx] ?? '') : '')),
        [table.rows, actionIdx],
    );
    const [actions, setActions] = useState<string[]>(originalActions);
    const [savingRow, setSavingRow] = useState<number | null>(null);

    useEffect(() => {
        setActions(originalActions);
    }, [originalActions]);

    const commitAction = useCallback((rowIdx: number, next: string) => {
        const original = originalActions[rowIdx];
        if (next === original) { return; }
        setActions(prev => { const arr = prev.slice(); arr[rowIdx] = next; return arr; });
        const newRow = table.rows[rowIdx].slice();
        newRow[actionIdx] = next;
        const newLine = buildTableRowMarkdown(newRow);
        const lineIdx = table.rowLines[rowIdx];
        setSavingRow(rowIdx);
        submitPlanEdit(lineIdx, lineIdx, newLine)
            .catch((err: unknown) => {
                setActions(prev => { const arr = prev.slice(); arr[rowIdx] = original; return arr; });
                showEditError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => setSavingRow(null));
    }, [originalActions, table, actionIdx, submitPlanEdit, showEditError]);

    if (actionIdx < 0) {
        return <DataTable headers={table.headers} rows={table.rows} />;
    }

    return (
        <div className='dataTableWrapper'>
            <table className='dataTable'>
                <thead>
                    <tr>
                        {table.headers.map((h, hi) => (
                            <th key={hi} dangerouslySetInnerHTML={{ __html: formatInline(h) }} />
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {table.rows.map((row, ri) => (
                        <tr key={ri}>
                            {row.map((cell, ci) => {
                                if (ci === actionIdx) {
                                    const current = actions[ri] ?? '';
                                    return (
                                        <td key={ci} className='dataTableDropdownCell'>
                                            <Dropdown
                                                size='small'
                                                value={current}
                                                selectedOptions={[current]}
                                                disabled={savingRow === ri}
                                                onOptionSelect={(_, data) => {
                                                    const picked = data.optionValue;
                                                    if (picked) { commitAction(ri, picked); }
                                                }}
                                            >
                                                {EXISTING_CONFIG_ACTIONS.map(opt => (
                                                    <Option key={opt} value={opt}>{opt}</Option>
                                                ))}
                                            </Dropdown>
                                        </td>
                                    );
                                }
                                return <td key={ci} dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />;
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const EmulatorsTable = ({ section, codeEditable }: { section: LocalPlanSection; codeEditable: boolean }): JSX.Element => {
    const tableBlock = section.content.find((c): c is TableBlock => c.type === 'table');
    if (tableBlock) {
        return <EmulatorsMarkdownTable table={tableBlock} />;
    }
    return <EmulatorsSubsectionTable section={section} codeEditable={codeEditable} />;
};

const EmulatorsMarkdownTable = ({ table }: { table: TableBlock }): JSX.Element => {
    const { submitPlanEdit, showEditError } = useContext(PlanLineEditContext);
    const imageIdx = findEmulatorImageColumnIdx(table.headers);
    const dataDirIdx = findEmulatorDataDirColumnIdx(table.headers);
    const originalImages = useMemo(
        () => table.rows.map(r => (imageIdx >= 0 ? (r[imageIdx] ?? '').trim() : '')),
        [table.rows, imageIdx],
    );
    const originalDataDirs = useMemo(
        () => table.rows.map(r => (dataDirIdx >= 0 ? (r[dataDirIdx] ?? '').trim() : '')),
        [table.rows, dataDirIdx],
    );
    const [imageDrafts, setImageDrafts] = useState<string[]>(originalImages);
    const [dataDirDrafts, setDataDirDrafts] = useState<string[]>(originalDataDirs);
    const [savingRow, setSavingRow] = useState<number | null>(null);
    const focusedImageRef = useRef<number | null>(null);
    const focusedDataDirRef = useRef<number | null>(null);

    useEffect(() => {
        if (focusedImageRef.current === null) { setImageDrafts(originalImages); }
    }, [originalImages]);
    useEffect(() => {
        if (focusedDataDirRef.current === null) { setDataDirDrafts(originalDataDirs); }
    }, [originalDataDirs]);

    const commitColumn = useCallback((rowIdx: number, columnIdx: number, next: string, originals: string[], revert: (rowIdx: number, value: string) => void) => {
        const trimmed = next.trim();
        const original = originals[rowIdx];
        if (!trimmed) {
            revert(rowIdx, original);
            return;
        }
        if (trimmed === original) { return; }
        const newRow = table.rows[rowIdx].slice();
        newRow[columnIdx] = trimmed;
        const newLine = buildTableRowMarkdown(newRow);
        const lineIdx = table.rowLines[rowIdx];
        setSavingRow(rowIdx);
        submitPlanEdit(lineIdx, lineIdx, newLine)
            .catch((err: unknown) => {
                revert(rowIdx, original);
                showEditError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => setSavingRow(null));
    }, [table, submitPlanEdit, showEditError]);

    const revertImage = useCallback((rowIdx: number, value: string) => {
        setImageDrafts(prev => { const arr = prev.slice(); arr[rowIdx] = value; return arr; });
    }, []);
    const revertDataDir = useCallback((rowIdx: number, value: string) => {
        setDataDirDrafts(prev => { const arr = prev.slice(); arr[rowIdx] = value; return arr; });
    }, []);

    return (
        <div className='dataTableWrapper'>
            <table className='dataTable'>
                <thead>
                    <tr>
                        {table.headers.map((h, hi) => (
                            <th key={hi} dangerouslySetInnerHTML={{ __html: formatInline(h) }} />
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {table.rows.map((row, ri) => (
                        <tr key={ri}>
                            {row.map((cell, ci) => {
                                if (ci === imageIdx) {
                                    return (
                                        <td key={ci} className='dataTableInputCell'>
                                            <Input
                                                size='small'
                                                value={imageDrafts[ri] ?? ''}
                                                disabled={savingRow === ri}
                                                onChange={(_, data) => setImageDrafts(prev => { const arr = prev.slice(); arr[ri] = data.value; return arr; })}
                                                onFocus={() => { focusedImageRef.current = ri; }}
                                                onBlur={(e) => {
                                                    focusedImageRef.current = null;
                                                    commitColumn(ri, imageIdx, e.target.value, originalImages, revertImage);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        (e.target as HTMLInputElement).blur();
                                                    } else if (e.key === 'Escape') {
                                                        e.preventDefault();
                                                        revertImage(ri, originalImages[ri]);
                                                        (e.target as HTMLInputElement).blur();
                                                    }
                                                }}
                                            />
                                        </td>
                                    );
                                }
                                if (ci === dataDirIdx) {
                                    return (
                                        <td key={ci} className='dataTableInputCell'>
                                            <Input
                                                size='small'
                                                value={dataDirDrafts[ri] ?? ''}
                                                disabled={savingRow === ri}
                                                onChange={(_, data) => setDataDirDrafts(prev => { const arr = prev.slice(); arr[ri] = data.value; return arr; })}
                                                onFocus={() => { focusedDataDirRef.current = ri; }}
                                                onBlur={(e) => {
                                                    focusedDataDirRef.current = null;
                                                    commitColumn(ri, dataDirIdx, e.target.value, originalDataDirs, revertDataDir);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        (e.target as HTMLInputElement).blur();
                                                    } else if (e.key === 'Escape') {
                                                        e.preventDefault();
                                                        revertDataDir(ri, originalDataDirs[ri]);
                                                        (e.target as HTMLInputElement).blur();
                                                    }
                                                }}
                                            />
                                        </td>
                                    );
                                }
                                return <td key={ci} dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />;
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const EmulatorsSubsectionTable = ({ section, codeEditable }: { section: LocalPlanSection; codeEditable: boolean }): JSX.Element => {
    const { submitPlanEdit, showEditError } = useContext(PlanLineEditContext);
    const emulators = useMemo(() => parseEmulators(section.content), [section.content]);
    const originalImages = useMemo(() => emulators.map(e => e.image?.value ?? ''), [emulators]);
    const originalDataDirs = useMemo(() => emulators.map(e => e.dataDir?.value ?? ''), [emulators]);
    const [imageDrafts, setImageDrafts] = useState<string[]>(originalImages);
    const [dataDirDrafts, setDataDirDrafts] = useState<string[]>(originalDataDirs);
    const [savingImageRow, setSavingImageRow] = useState<number | null>(null);
    const [savingDataDirRow, setSavingDataDirRow] = useState<number | null>(null);
    const focusedImageRef = useRef<number | null>(null);
    const focusedDataDirRef = useRef<number | null>(null);

    useEffect(() => {
        if (focusedImageRef.current === null) { setImageDrafts(originalImages); }
    }, [originalImages]);
    useEffect(() => {
        if (focusedDataDirRef.current === null) { setDataDirDrafts(originalDataDirs); }
    }, [originalDataDirs]);

    const commitImage = useCallback((rowIdx: number, next: string) => {
        const trimmed = next.trim();
        const original = originalImages[rowIdx];
        const target = emulators[rowIdx]?.image;
        if (!target) { return; }
        if (!trimmed) {
            setImageDrafts(prev => { const arr = prev.slice(); arr[rowIdx] = original; return arr; });
            return;
        }
        if (trimmed === original) { return; }
        const newLine = `${target.prefix}${trimmed}`;
        setSavingImageRow(rowIdx);
        submitPlanEdit(target.absoluteLine, target.absoluteLine, newLine)
            .catch((err: unknown) => {
                setImageDrafts(prev => { const arr = prev.slice(); arr[rowIdx] = original; return arr; });
                showEditError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => setSavingImageRow(null));
    }, [originalImages, emulators, submitPlanEdit, showEditError]);

    const commitDataDir = useCallback((rowIdx: number, next: string) => {
        const trimmed = next.trim();
        const original = originalDataDirs[rowIdx];
        const target = emulators[rowIdx]?.dataDir;
        if (!target) { return; }
        if (!trimmed) {
            setDataDirDrafts(prev => { const arr = prev.slice(); arr[rowIdx] = original; return arr; });
            return;
        }
        if (trimmed === original) { return; }
        const newLine = `${target.prefix}${trimmed}${target.suffix}`;
        setSavingDataDirRow(rowIdx);
        submitPlanEdit(target.absoluteLine, target.absoluteLine, newLine)
            .catch((err: unknown) => {
                setDataDirDrafts(prev => { const arr = prev.slice(); arr[rowIdx] = original; return arr; });
                showEditError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => setSavingDataDirRow(null));
    }, [originalDataDirs, emulators, submitPlanEdit, showEditError]);

    if (emulators.length === 0) {
        return (
            <>
                {section.content.map((item, i) => (
                    <ContentBlock key={i} item={item} codeEditable={codeEditable} />
                ))}
            </>
        );
    }

    return (
        <div className='dataTableWrapper'>
            <table className='dataTable'>
                <thead>
                    <tr>
                        <th>Emulator</th>
                        <th>Image</th>
                        <th>Data Directory</th>
                        <th>Port</th>
                        <th>Connection</th>
                    </tr>
                </thead>
                <tbody>
                    {emulators.map((emu, ri) => (
                        <tr key={ri}>
                            <td dangerouslySetInnerHTML={{ __html: formatInline(emu.subsectionTitle) }} />
                            <td className='dataTableInputCell'>
                                {emu.image ? (
                                    <Input
                                        size='small'
                                        value={imageDrafts[ri] ?? ''}
                                        disabled={savingImageRow === ri}
                                        onChange={(_, data) => setImageDrafts(prev => { const arr = prev.slice(); arr[ri] = data.value; return arr; })}
                                        onFocus={() => { focusedImageRef.current = ri; }}
                                        onBlur={(e) => {
                                            focusedImageRef.current = null;
                                            commitImage(ri, e.target.value);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                (e.target as HTMLInputElement).blur();
                                            } else if (e.key === 'Escape') {
                                                e.preventDefault();
                                                setImageDrafts(prev => { const arr = prev.slice(); arr[ri] = originalImages[ri]; return arr; });
                                                (e.target as HTMLInputElement).blur();
                                            }
                                        }}
                                    />
                                ) : <span className='dataTableMuted'>—</span>}
                            </td>
                            <td className='dataTableInputCell'>
                                {emu.dataDir ? (
                                    <Input
                                        size='small'
                                        value={dataDirDrafts[ri] ?? ''}
                                        disabled={savingDataDirRow === ri}
                                        onChange={(_, data) => setDataDirDrafts(prev => { const arr = prev.slice(); arr[ri] = data.value; return arr; })}
                                        onFocus={() => { focusedDataDirRef.current = ri; }}
                                        onBlur={(e) => {
                                            focusedDataDirRef.current = null;
                                            commitDataDir(ri, e.target.value);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                (e.target as HTMLInputElement).blur();
                                            } else if (e.key === 'Escape') {
                                                e.preventDefault();
                                                setDataDirDrafts(prev => { const arr = prev.slice(); arr[ri] = originalDataDirs[ri]; return arr; });
                                                (e.target as HTMLInputElement).blur();
                                            }
                                        }}
                                    />
                                ) : <span className='dataTableMuted'>—</span>}
                            </td>
                            <td>{emu.port ? <code>{emu.port}</code> : <span className='dataTableMuted'>—</span>}</td>
                            <td>{emu.connection ? <code>{emu.connection}</code> : <span className='dataTableMuted'>—</span>}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const EditableLaunchName = ({ paragraph, currentName }: { paragraph: ParagraphBlock; currentName: string }): JSX.Element => {
    const { submitPlanEdit, showEditError } = useContext(PlanLineEditContext);
    const [draft, setDraft] = useState(currentName);
    const [isSaving, setIsSaving] = useState(false);
    const focusedRef = useRef(false);

    useEffect(() => {
        if (!focusedRef.current) {
            setDraft(currentName);
        }
    }, [currentName]);

    const commit = useCallback((next: string) => {
        const trimmed = next.trim();
        if (!trimmed) {
            setDraft(currentName);
            return;
        }
        if (trimmed === currentName) {
            return;
        }
        const newLine = `Compound Launch Config Name: ✏️ **${trimmed}**`;
        setIsSaving(true);
        submitPlanEdit(paragraph.lineStart, paragraph.lineEnd, newLine)
            .catch((err: unknown) => {
                setDraft(currentName);
                const message = err instanceof Error ? err.message : String(err);
                showEditError(message);
            })
            .finally(() => setIsSaving(false));
    }, [paragraph.lineStart, paragraph.lineEnd, currentName, submitPlanEdit, showEditError]);

    return (
        <p className='paragraph editableLaunchName'>
            <strong>Compound Launch Config Name</strong>
            <Input
                size='small'
                value={draft}
                disabled={isSaving}
                onChange={(_, data) => setDraft(data.value)}
                onFocus={() => { focusedRef.current = true; }}
                onBlur={(e) => {
                    focusedRef.current = false;
                    commit(e.target.value);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setDraft(currentName);
                        (e.target as HTMLInputElement).blur();
                    }
                }}
            />
        </p>
    );
};

const EditableGenerateToggleParagraph = ({ paragraph, checked }: { paragraph: ParagraphBlock; checked: boolean }): JSX.Element => {
    const { submitPlanEdit, showEditError } = useContext(PlanLineEditContext);
    const [current, setCurrent] = useState(checked);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => { setCurrent(checked); }, [checked]);

    const toggle = useCallback(() => {
        const next = !current;
        const newLine = `**Generate:** [${next ? 'x' : ' '}]`;
        setCurrent(next);
        setIsSaving(true);
        submitPlanEdit(paragraph.lineStart, paragraph.lineEnd, newLine)
            .catch((err: unknown) => {
                setCurrent(!next);
                const message = err instanceof Error ? err.message : String(err);
                showEditError(message);
            })
            .finally(() => setIsSaving(false));
    }, [current, paragraph.lineStart, paragraph.lineEnd, submitPlanEdit, showEditError]);

    return (
        <div className='editableGenerateToggle'>
            <Checkbox
                checked={current}
                disabled={isSaving}
                onChange={() => toggle()}
                label='Generate'
            />
        </div>
    );
};

const EditableValueTable = ({ table, valueColumnIdx }: { table: TableBlock; valueColumnIdx: number }): JSX.Element => {
    const { submitPlanEdit, showEditError } = useContext(PlanLineEditContext);
    const [drafts, setDrafts] = useState<string[]>(() => table.rows.map(r => (r[valueColumnIdx] ?? '').trim()));
    const [savingRow, setSavingRow] = useState<number | null>(null);
    const focusedRowRef = useRef<number | null>(null);

    useEffect(() => {
        if (focusedRowRef.current === null) {
            setDrafts(table.rows.map(r => (r[valueColumnIdx] ?? '').trim()));
        }
    }, [table.rows, valueColumnIdx]);

    const commitRow = useCallback((rowIdx: number, next: string) => {
        const trimmed = next.trim();
        const original = (table.rows[rowIdx][valueColumnIdx] ?? '').trim();
        if (trimmed === original) {
            return;
        }
        const newRow = table.rows[rowIdx].slice();
        newRow[valueColumnIdx] = trimmed;
        const newLine = buildTableRowMarkdown(newRow);
        const lineIdx = table.rowLines[rowIdx];
        setSavingRow(rowIdx);
        submitPlanEdit(lineIdx, lineIdx, newLine)
            .catch((err: unknown) => {
                setDrafts(prev => {
                    const arr = prev.slice();
                    arr[rowIdx] = original;
                    return arr;
                });
                const message = err instanceof Error ? err.message : String(err);
                showEditError(message);
            })
            .finally(() => setSavingRow(null));
    }, [table, valueColumnIdx, submitPlanEdit, showEditError]);

    return (
        <ul className='bulletList editableValueList'>
            {table.rows.map((row, ri) => {
                const otherColumns = row.filter((_, idx) => idx !== valueColumnIdx).join(' — ').trim();
                const labelHtml = otherColumns ? `<strong>${formatInline(otherColumns)}</strong>` : '';
                return (
                    <li key={ri} className='editableValueRow'>
                        {labelHtml && <span className='editableValueLabel' dangerouslySetInnerHTML={{ __html: labelHtml }} />}
                        <Input
                            size='small'
                            value={drafts[ri]}
                            disabled={savingRow === ri}
                            onChange={(_, data) => {
                                setDrafts(prev => {
                                    const arr = prev.slice();
                                    arr[ri] = data.value;
                                    return arr;
                                });
                            }}
                            onFocus={() => { focusedRowRef.current = ri; }}
                            onBlur={(e) => {
                                focusedRowRef.current = null;
                                commitRow(ri, e.target.value);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    (e.target as HTMLInputElement).blur();
                                } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setDrafts(prev => {
                                        const arr = prev.slice();
                                        arr[ri] = (table.rows[ri][valueColumnIdx] ?? '').trim();
                                        return arr;
                                    });
                                    (e.target as HTMLInputElement).blur();
                                }
                            }}
                            className='editableValueInput'
                        />
                    </li>
                );
            })}
        </ul>
    );
};

const EditableGenerateTable = ({ table }: { table: TableBlock }): JSX.Element => {
    const { submitPlanEdit, showEditError } = useContext(PlanLineEditContext);
    const generateIdx = findGenerateColumnIdx(table.headers);
    const [states, setStates] = useState<boolean[]>(() => table.rows.map(r => /\[\s*x\s*\]/i.test(r[generateIdx] ?? '')));
    const [savingRow, setSavingRow] = useState<number | null>(null);

    useEffect(() => {
        setStates(table.rows.map(r => /\[\s*x\s*\]/i.test(r[generateIdx] ?? '')));
    }, [table.rows, generateIdx]);

    const toggleRow = useCallback((rowIdx: number) => {
        const next = !states[rowIdx];
        const newRow = table.rows[rowIdx].slice();
        newRow[generateIdx] = next ? '[x]' : '[ ]';
        const newLine = buildTableRowMarkdown(newRow);
        const lineIdx = table.rowLines[rowIdx];
        setStates(prev => { const arr = prev.slice(); arr[rowIdx] = next; return arr; });
        setSavingRow(rowIdx);
        submitPlanEdit(lineIdx, lineIdx, newLine)
            .catch((err: unknown) => {
                setStates(prev => { const arr = prev.slice(); arr[rowIdx] = !next; return arr; });
                const message = err instanceof Error ? err.message : String(err);
                showEditError(message);
            })
            .finally(() => setSavingRow(null));
    }, [states, table, generateIdx, submitPlanEdit, showEditError]);

    return (
        <ul className='bulletList editableGenerateList'>
            {table.rows.map((row, ri) => {
                const labelParts = row.filter((_, idx) => idx !== generateIdx);
                const head = formatInline(labelParts[0] ?? '');
                const tail = labelParts.slice(1).map(p => formatInline(p)).join(' — ');
                const html = tail ? `<strong>${head}</strong>: ${tail}` : `<strong>${head}</strong>`;
                return (
                    <li key={ri} className='editableGenerateRow'>
                        <Checkbox
                            checked={states[ri]}
                            disabled={savingRow === ri}
                            onChange={() => toggleRow(ri)}
                        />
                        <span className='editableGenerateLabel' dangerouslySetInnerHTML={{ __html: html }} />
                    </li>
                );
            })}
        </ul>
    );
};

const CodeBlock = ({ language, code }: { language: string; code: string }): JSX.Element => (
    <div className='codeBlock'>
        {language && <span className='codeBlockLang'>{language}</span>}
        <pre><code>{code}</code></pre>
    </div>
);

const EditableCodeBlock = ({ language, code }: { language: string; code: string }): JSX.Element => {
    const [currentCode, setCurrentCode] = useState(code);
    const [isSaving, setIsSaving] = useState(false);
    const { addCodeEditNote, updateCodeBlock, showCodeEditError } = useContext(CodeEditNoteContext);

    useEffect(() => {
        setCurrentCode(code);
        setIsSaving(false);
    }, [code]);

    const parsed = useMemo(() => safeParseJson(currentCode), [currentCode]);
    const entries = useMemo<LaunchEntry[]>(() => extractLaunchEntries(parsed), [parsed]);

    const commitEntryName = useCallback(async (entry: LaunchEntry, currentName: string, nextName: string): Promise<'applied' | 'reset'> => {
        const trimmed = nextName.trim();
        if (!trimmed || trimmed === currentName) {
            return 'reset';
        }

        const nameKey = entry.kind === 'task' ? 'label' : 'name';
        const arrayKey = entry.kind === 'task' ? 'tasks' : entry.kind === 'compound' ? 'compounds' : 'configurations';

        let newCode: string;
        try {
            const edits = jsoncParser.modify(currentCode, [arrayKey, entry.index, nameKey], trimmed, {
                formattingOptions: { insertSpaces: true, tabSize: 4, eol: '\n' },
            });
            newCode = jsoncParser.applyEdits(currentCode, edits);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            showCodeEditError(`Couldn't update this launch configuration: ${message}`);
            return 'reset';
        }

        if (!newCode || newCode === currentCode) {
            return 'reset';
        }

        setIsSaving(true);
        try {
            await updateCodeBlock(currentCode, newCode, language);
            setCurrentCode(newCode);
            addCodeEditNote(language, currentCode, newCode);
            return 'applied';
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            showCodeEditError(message);
            return 'reset';
        } finally {
            setIsSaving(false);
        }
    }, [currentCode, language, updateCodeBlock, addCodeEditNote, showCodeEditError]);

    if (entries.length === 0) {
        return <CodeBlock language={language} code={currentCode} />;
    }

    return (
        <div className='launchConfigSummary'>
            <ul className='launchConfigList'>
                {entries.map((entry) => (
                    <LaunchConfigItem
                        key={`${entry.kind}-${entry.index}`}
                        entry={entry}
                        onCommitName={commitEntryName}
                        disabled={isSaving}
                    />
                ))}
            </ul>
        </div>
    );
};

interface LaunchEntry {
    kind: 'configuration' | 'compound' | 'task';
    index: number;
    raw: Record<string, unknown>;
}

function safeParseJson(code: string): unknown {
    try {
        return JSON.parse(code);
    } catch {
        try {
            const errors: jsoncParser.ParseError[] = [];
            const result = jsoncParser.parse(code, errors, { allowTrailingComma: true, disallowComments: false });
            if (errors.length > 0) {
                return undefined;
            }
            return result;
        } catch {
            return undefined;
        }
    }
}

function extractLaunchEntries(parsed: unknown): LaunchEntry[] {
    if (!parsed || typeof parsed !== 'object') { return []; }
    const obj = parsed as Record<string, unknown>;
    const entries: LaunchEntry[] = [];
    if (Array.isArray(obj.configurations)) {
        (obj.configurations as unknown[]).forEach((raw, index) => {
            if (raw && typeof raw === 'object') {
                entries.push({ kind: 'configuration', index, raw: raw as Record<string, unknown> });
            }
        });
    }
    if (Array.isArray(obj.compounds)) {
        (obj.compounds as unknown[]).forEach((raw, index) => {
            if (raw && typeof raw === 'object') {
                entries.push({ kind: 'compound', index, raw: raw as Record<string, unknown> });
            }
        });
    }
    if (entries.length === 0 && Array.isArray(obj.tasks)) {
        (obj.tasks as unknown[]).forEach((raw, index) => {
            if (raw && typeof raw === 'object') {
                entries.push({ kind: 'task', index, raw: raw as Record<string, unknown> });
            }
        });
    }
    return entries;
}

const LaunchConfigItem = ({ entry, onCommitName, disabled }: {
    entry: LaunchEntry;
    onCommitName: (entry: LaunchEntry, currentName: string, nextName: string) => Promise<'applied' | 'reset'>;
    disabled: boolean;
}): JSX.Element => {
    const nameKey = entry.kind === 'task' ? 'label' : 'name';
    const currentName = String(entry.raw?.[nameKey] ?? '');
    const description = entry.kind === 'task'
        ? describeTask(entry.raw)
        : entry.kind === 'compound'
            ? describeCompound(entry.raw)
            : describeConfig(entry.raw);

    const [draft, setDraft] = useState(currentName);
    const focusedRef = useRef(false);

    useEffect(() => {
        if (!focusedRef.current) {
            setDraft(currentName);
        }
    }, [currentName]);

    const commit = useCallback((next: string) => {
        void onCommitName(entry, currentName, next).then((result) => {
            if (result !== 'applied') {
                setDraft(currentName);
            }
        }).catch(() => {
            setDraft(currentName);
        });
    }, [entry, currentName, onCommitName]);

    const inputId = `launchConfigName-${entry.kind}-${entry.index}`;

    return (
        <li className='launchConfigItem'>
            <div className='launchConfigNameRow'>
                <label className='launchConfigNameLabel' htmlFor={inputId}>Name</label>
                <Input
                    id={inputId}
                    size='small'
                    value={draft}
                    disabled={disabled}
                    onChange={(_, data) => setDraft(data.value)}
                    onFocus={() => { focusedRef.current = true; }}
                    onBlur={(e) => {
                        focusedRef.current = false;
                        commit(e.target.value);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setDraft(currentName);
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                    className='launchConfigNameInput'
                />
            </div>
            <p className='launchConfigDescription'>{description}</p>
        </li>
    );
};

function describeConfig(c: Record<string, unknown>): string {
    const type = typeof c.type === 'string' ? c.type.toLowerCase() : '';
    const request = typeof c.request === 'string' ? c.request.toLowerCase() : '';
    const parts: string[] = [];

    if (type === 'chrome' || type === 'msedge' || type === 'pwa-chrome' || type === 'pwa-msedge') {
        const browser = type.includes('msedge') ? 'Edge' : 'Chrome';
        const url = typeof c.url === 'string' ? c.url : undefined;
        parts.push(url ? `Opens ${browser} at ${url} with the debugger attached.` : `Launches ${browser} with the debugger attached.`);
    } else if (type === 'node' || type === 'pwa-node') {
        if (request === 'attach') {
            parts.push(`Attaches the Node.js debugger${typeof c.port === 'number' ? ` on port ${c.port}` : ''}.`);
        } else {
            const program = typeof c.program === 'string' ? c.program : '';
            parts.push(`Launches and debugs Node.js${program ? ` (${program})` : ''}.`);
        }
    } else if (type === 'coreclr' || type === 'clr') {
        parts.push('Attaches the .NET debugger to the running process.');
    } else if (type === 'python' || type === 'debugpy') {
        parts.push(`Attaches the Python debugger${typeof c.port === 'number' ? ` on port ${c.port}` : ''}.`);
    } else if (type === 'java') {
        parts.push(`Attaches the Java debugger${typeof c.port === 'number' ? ` on port ${c.port}` : ''}.`);
    } else if (type === 'go') {
        parts.push('Attaches the Delve (Go) debugger.');
    } else if (type) {
        parts.push(`Runs a "${type}" debug session${request ? ` (${request})` : ''}.`);
    } else {
        parts.push('Debug configuration.');
    }

    if (typeof c.preLaunchTask === 'string' && c.preLaunchTask) {
        parts.push(`Triggers task "${c.preLaunchTask}" before launching.`);
    }
    return parts.join(' ');
}

function describeTask(t: Record<string, unknown>): string {
    const parts: string[] = [];
    const cmd = typeof t.command === 'string' ? t.command : '';
    const type = typeof t.type === 'string' ? t.type : '';

    if (cmd.startsWith('docker compose') || cmd.startsWith('docker-compose')) {
        parts.push('Starts the local emulators via Docker Compose.');
    } else if (type === 'shell' && cmd) {
        const preview = cmd.length > 80 ? `${cmd.slice(0, 77)}\u2026` : cmd;
        parts.push(`Shell task: \`${preview}\``);
    } else if (type === 'npm' && typeof t.script === 'string') {
        parts.push(`Runs npm script: \`${t.script}\`.`);
    } else if (type) {
        parts.push(`Runs a "${type}" task.`);
    } else {
        parts.push('Build task.');
    }

    if (Array.isArray(t.dependsOn) && t.dependsOn.length > 0) {
        parts.push(`Depends on: ${t.dependsOn.map((d) => `"${String(d)}"`).join(', ')}.`);
    } else if (typeof t.dependsOn === 'string' && t.dependsOn) {
        parts.push(`Depends on: "${t.dependsOn}".`);
    }
    return parts.join(' ');
}

function describeCompound(c: Record<string, unknown>): string {
    const parts: string[] = ['Compound launch configuration.'];
    if (Array.isArray(c.configurations) && c.configurations.length > 0) {
        const names = c.configurations
            .map((entry) => {
                if (typeof entry === 'string') { return entry; }
                if (entry && typeof entry === 'object') {
                    const name = (entry as Record<string, unknown>).name;
                    if (typeof name === 'string') { return name; }
                }
                return undefined;
            })
            .filter((n): n is string => !!n);
        if (names.length > 0) {
            parts.push(`Launches ${names.map((n) => `"${n}"`).join(', ')} together.`);
        }
    }
    if (typeof c.preLaunchTask === 'string' && c.preLaunchTask) {
        parts.push(`Triggers task "${c.preLaunchTask}" before launching.`);
    }
    if (c.stopAll === true) {
        parts.push('Stopping one stops all of them.');
    }
    return parts.join(' ');
}

const CodeEditErrorDialog = ({ open, message, onClose }: { open: boolean; message: string; onClose: () => void }): JSX.Element => (
    <Dialog open={open} onOpenChange={(_, data) => { if (!data.open) { onClose(); } }}>
        <DialogSurface>
            <DialogBody>
                <DialogTitle>Couldn't save changes</DialogTitle>
                <DialogContent>{message}</DialogContent>
                <DialogActions>
                    <Button appearance='primary' onClick={onClose}>OK</Button>
                </DialogActions>
            </DialogBody>
        </DialogSurface>
    </Dialog>
);

const MermaidBlock = ({ code }: { code: string }): JSX.Element => {
    const ref = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const id = `mermaid-diagram-${++mermaidIdCounter}`;
        mermaid.render(id, code).then(({ svg }) => {
            if (!cancelled && ref.current) {
                ref.current.innerHTML = svg;
                setError(null);
            }
        }).catch((err: Error) => {
            if (!cancelled) {
                setError(err.message);
            }
        });
        return () => { cancelled = true; };
    }, [code]);

    if (error) {
        return (
            <div className='codeBlock'>
                <span className='codeBlockLang'>mermaid (error)</span>
                <pre><code>{code}</code></pre>
            </div>
        );
    }

    return <div className='mermaidDiagram' ref={ref} />;
};

const BulletListBlock = ({ items }: { items: string[] }): JSX.Element => (
    <ul className='bulletList'>
        {items.map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
        ))}
    </ul>
);

const BlockquoteBlock = ({ text }: { text: string }): JSX.Element => (
    <div className='blockquote' dangerouslySetInnerHTML={{ __html: formatInline(text) }} />
);

const SubsectionBlock = ({ title, content, codeEditable }: { title: string; content: LocalPlanContent[]; codeEditable: boolean }): JSX.Element => {
    const [open, setOpen] = useState(false);
    const parentSection = useContext(PlanSectionContext);

    return (
        <div className='subsection'>
            <div className='subsectionHeading clickable' onClick={() => setOpen(!open)}>
                <span className={`sectionChevron ${open ? 'open' : ''}`}>▶</span>
                <h3>{title}</h3>
            </div>
            {open && (
                <PlanSectionContext.Provider value={{ sectionTitle: parentSection.sectionTitle, subsectionTitle: title }}>
                    <div className='subsectionContent'>
                        {content.map((item, i) => (
                            <ContentBlock key={i} item={item} codeEditable={codeEditable} />
                        ))}
                    </div>
                </PlanSectionContext.Provider>
            )}
        </div>
    );
};

function formatInline(text: string): string {
    return escapeHtml(stripPencilIcons(text))
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="link" title="$2">$1</span>');
}

function stripPencilIcons(text: string): string {
    // Remove the pencil emoji (with or without VS16 variation selector) and any
    // surrounding whitespace so the rendered view stays clean.
    return text.replace(/\s*\u270F\uFE0F?\s*/gu, ' ').replace(/\s{2,}/g, ' ').trim();
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

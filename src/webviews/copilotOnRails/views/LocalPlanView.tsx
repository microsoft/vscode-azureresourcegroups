/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, CounterBadge, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Spinner, Textarea, Tooltip } from '@fluentui/react-components';
import { CheckmarkRegular, CommentEditRegular, DismissRegular, DocumentRegular, SendRegular, WarningRegular } from '@fluentui/react-icons';
import { WebviewContext } from '@microsoft/vscode-azext-webview/webview';
import * as jsoncParser from 'jsonc-parser';
import mermaid from 'mermaid';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX } from 'react';
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

interface CodeEditNoteContextValue {
    addCodeEditNote: (language: string, oldCode: string, newCode: string) => void;
}
const CodeEditNoteContext = createContext<CodeEditNoteContextValue>({
    addCodeEditNote: () => { /* no-op */ },
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
}

let feedbackIdCounter = 0;
const nextId = (): string => `fb-${++feedbackIdCounter}`;

function buildFeedbackPrompt(items: FeedbackItem[]): string {
    const notes = items
        .map(i => `- ${i.text.trim()}`)
        .filter(t => t.length > 2);

    const lines: string[] = [
        'Please revise the local development plan based on my feedback and update local-development-plan.md.',
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
            } else if (message?.command === 'codeBlockUpdateError') {
                setCodeEditError(typeof message.error === 'string' ? message.error : 'Failed to save changes to the plan file.');
            }
        };
        window.addEventListener('message', handler);
        vscodeApi.postMessage({ command: 'ready' });
        return () => window.removeEventListener('message', handler);
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

    const codeEditContextValue = useMemo<CodeEditNoteContextValue>(
        () => ({ addCodeEditNote }),
        [addCodeEditNote],
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
                    .filter((s) => !isHiddenSection(s.title))
                    .sort((a, b) => sectionSortOrder(a.title) - sectionSortOrder(b.title))
                    .map((section, i) => {
                        const lower = section.title.toLowerCase();
                        const collapsible = !alwaysExpandedSections.has(lower);
                        const defaultOpen = !collapsible || defaultOpenSections.has(lower);
                        const codeEditable = editableCodeSections.has(lower);
                        return (
                            <CodeEditNoteContext.Provider key={i} value={codeEditContextValue}>
                                <SectionCard
                                    section={section}
                                    collapsible={collapsible}
                                    defaultOpen={defaultOpen}
                                    codeEditable={codeEditable}
                                />
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
                    {section.content.map((item, i) => (
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
        || lower === 'limited support'
        || lower === 'convenience scripts'
        || lower === 'api test collections'
        || lower === 'migrations';
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
    switch (item.type) {
        case 'table':
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
        case 'paragraph':
            return <p className='paragraph' dangerouslySetInnerHTML={{ __html: formatInline(item.text) }} />;
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

const CodeBlock = ({ language, code }: { language: string; code: string }): JSX.Element => (
    <div className='codeBlock'>
        {language && <span className='codeBlockLang'>{language}</span>}
        <pre><code>{code}</code></pre>
    </div>
);

const EditableCodeBlock = ({ language, code }: { language: string; code: string }): JSX.Element => {
    const parsed = useMemo(() => safeParseJson(code), [code]);
    const entries = useMemo<LaunchEntry[]>(() => extractLaunchEntries(parsed), [parsed]);

    if (entries.length === 0) {
        return <CodeBlock language={language} code={code} />;
    }

    return (
        <div className='launchConfigSummary'>
            <ul className='launchConfigList'>
                {entries.map((entry) => (
                    <LaunchConfigItem
                        key={`${entry.kind}-${entry.index}`}
                        entry={entry}
                        originalCode={code}
                        language={language}
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

const LaunchConfigItem = ({ entry, originalCode, language }: { entry: LaunchEntry; originalCode: string; language: string }): JSX.Element => {
    const { vscodeApi } = useContext(WebviewContext);
    const { addCodeEditNote } = useContext(CodeEditNoteContext);

    const nameKey = entry.kind === 'task' ? 'label' : 'name';
    const arrayKey = entry.kind === 'task' ? 'tasks' : entry.kind === 'compound' ? 'compounds' : 'configurations';
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
        const trimmed = next.trim();
        if (!trimmed || trimmed === currentName) {
            setDraft(currentName);
            return;
        }
        const edits = jsoncParser.modify(originalCode, [arrayKey, entry.index, nameKey], trimmed, {
            formattingOptions: { insertSpaces: true, tabSize: 4, eol: '\n' },
        });
        const newCode = jsoncParser.applyEdits(originalCode, edits);
        if (!newCode || newCode === originalCode) {
            setDraft(currentName);
            return;
        }
        vscodeApi.postMessage({
            command: 'updateCodeBlock',
            originalCode,
            language,
            newCode,
        });
        addCodeEditNote(language, originalCode, newCode);
    }, [currentName, arrayKey, entry.index, nameKey, originalCode, language, vscodeApi, addCodeEditNote]);

    const inputId = `launchConfigName-${entry.kind}-${entry.index}`;

    return (
        <li className='launchConfigItem'>
            <div className='launchConfigNameRow'>
                <label className='launchConfigNameLabel' htmlFor={inputId}>Name</label>
                <Input
                    id={inputId}
                    size='small'
                    value={draft}
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

    return (
        <div className='subsection'>
            <div className='subsectionHeading clickable' onClick={() => setOpen(!open)}>
                <span className={`sectionChevron ${open ? 'open' : ''}`}>▶</span>
                <h3>{title}</h3>
            </div>
            {open && (
                <div className='subsectionContent'>
                    {content.map((item, i) => (
                        <ContentBlock key={i} item={item} codeEditable={codeEditable} />
                    ))}
                </div>
            )}
        </div>
    );
};

function formatInline(text: string): string {
    return escapeHtml(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="link" title="$2">$1</span>');
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

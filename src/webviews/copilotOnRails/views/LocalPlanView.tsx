/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Checkbox, CounterBadge, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner, Textarea, Tooltip } from '@fluentui/react-components';
import { CheckmarkRegular, CommentEditRegular, DismissRegular, DocumentRegular, SendRegular, WarningRegular } from '@fluentui/react-icons';
import { WebviewContext } from '@microsoft/vscode-azext-webview/webview';
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

// Sections expected in the new vscode-debug-plan format. Anything else is hidden.
const ALLOWED_SECTIONS = new Set([
    'prerequisites',
    'debug configurations',
    'orchestrator',
    'emulators',
    'architecture diagram',
    'migrations',
    'api test collections',
    'convenience scripts',
]);

// Section order shown in the UI.
const SECTION_ORDER: string[] = [
    'prerequisites',
    'debug configurations',
    'orchestrator',
    'emulators',
    'architecture diagram',
    'migrations',
    'api test collections',
    'convenience scripts',
];

// Sections that are always rendered open; the rest get a clickable header
// that toggles open/closed. (Architecture Diagram opens by default but stays
// collapsible since the mermaid diagram is large.)
const ALWAYS_EXPANDED_SECTIONS = new Set(['prerequisites']);
const DEFAULT_OPEN_SECTIONS = new Set([
    'prerequisites',
    'debug configurations',
    'architecture diagram',
]);

const GENERATE_HEADER = 'generate';

function findGenerateColumnIdx(headers: string[]): number {
    return headers.findIndex((h) => h.toLowerCase().trim() === GENERATE_HEADER);
}

function sectionSortOrder(title: string): number {
    const lower = title.toLowerCase().trim();
    const idx = SECTION_ORDER.indexOf(lower);
    return idx === -1 ? SECTION_ORDER.length : idx;
}

function shouldHideSection(section: LocalPlanSection): boolean {
    return !ALLOWED_SECTIONS.has(section.title.toLowerCase().trim());
}

interface ToggleEntry {
    sectionTitle: string;
    rowLabel: string;
    generate: boolean;
}

interface PlanToggleContextValue {
    getToggle: (key: string) => ToggleEntry | undefined;
    setToggle: (key: string, entry: ToggleEntry | null) => void;
}
const PlanToggleContext = createContext<PlanToggleContextValue>({
    getToggle: () => undefined,
    setToggle: () => { /* no-op */ },
});

type TableBlock = Extract<LocalPlanContent, { type: 'table' }>;

interface FeedbackItem {
    id: string;
    text: string;
}

let feedbackIdCounter = 0;
const nextId = (): string => `fb-${++feedbackIdCounter}`;

function buildFeedbackPrompt(items: FeedbackItem[]): string {
    const notes = items
        .map((i) => `- ${i.text.trim()}`)
        .filter((t) => t.length > 2);

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

function toggleFeedbackText(entry: ToggleEntry): string {
    return `In **${entry.sectionTitle}**, set **Generate** to **${entry.generate ? 'Yes' : 'No'}** for **${entry.rowLabel}**.`;
}

export const LocalPlanView = (): JSX.Element => {
    const [plan, setPlan] = useState<LocalPlanData | null>(null);
    const [freeformItems, setFreeformItems] = useState<FeedbackItem[]>([]);
    const [freeformDraft, setFreeformDraft] = useState('');
    const [pendingToggles, setPendingToggles] = useState<Map<string, ToggleEntry>>(new Map());
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [isAwaitingRevision, setIsAwaitingRevision] = useState(false);
    const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
    const { vscodeApi } = useContext(WebviewContext);

    const toggleItems = useMemo<FeedbackItem[]>(
        () => Array.from(pendingToggles.entries()).map(([key, entry]) => ({
            id: `toggle-${key}`,
            text: toggleFeedbackText(entry),
        })),
        [pendingToggles],
    );

    const allItems = useMemo(() => [...toggleItems, ...freeformItems], [toggleItems, freeformItems]);

    const hasEdits = useMemo(
        () => allItems.length > 0 || freeformDraft.trim().length > 0,
        [allItems, freeformDraft],
    );

    const isAlreadyApproved = useMemo(() => {
        const s = plan?.status?.trim().toLowerCase();
        return !!s && s !== 'planning' && s !== 'unknown';
    }, [plan?.status]);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message?.command === 'setLocalPlanData') {
                setPlan(message.data as LocalPlanData);
                setFreeformItems([]);
                setFreeformDraft('');
                setPendingToggles(new Map());
            } else if (message?.command === 'revisionInProgress') {
                setIsAwaitingRevision(true);
                setDrawerOpen(false);
            } else if (message?.command === 'revisionComplete') {
                setIsAwaitingRevision(false);
            }
        };
        window.addEventListener('message', handler);
        vscodeApi.postMessage({ command: 'ready' });
        return () => {
            window.removeEventListener('message', handler);
        };
    }, [vscodeApi]);

    const handleApprove = useCallback(() => {
        if (!plan || isAlreadyApproved) {
            return;
        }
        if (hasEdits) {
            setConfirmSubmitOpen(true);
            return;
        }
        vscodeApi.postMessage({ command: 'approvePlan', data: plan });
    }, [plan, hasEdits, isAlreadyApproved, vscodeApi]);

    const handleRemoveFeedback = useCallback((id: string) => {
        if (id.startsWith('toggle-')) {
            const key = id.slice('toggle-'.length);
            setPendingToggles((prev) => {
                if (!prev.has(key)) {
                    return prev;
                }
                const next = new Map(prev);
                next.delete(key);
                return next;
            });
            return;
        }
        setFreeformItems((prev) => prev.filter((i) => i.id !== id));
    }, []);

    const getToggle = useCallback((key: string) => pendingToggles.get(key), [pendingToggles]);
    const setToggle = useCallback((key: string, entry: ToggleEntry | null) => {
        setPendingToggles((prev) => {
            const next = new Map(prev);
            if (entry === null) {
                if (!next.delete(key)) {
                    return prev;
                }
            } else {
                next.set(key, entry);
            }
            return next;
        });
    }, []);

    const planToggleContextValue = useMemo<PlanToggleContextValue>(
        () => ({ getToggle, setToggle }),
        [getToggle, setToggle],
    );

    const handleAddNote = useCallback(() => {
        const text = freeformDraft.trim();
        if (!text) {
            return;
        }
        setFreeformItems((prev) => [...prev, { id: nextId(), text }]);
        setFreeformDraft('');
    }, [freeformDraft]);

    const handleDiscardAll = useCallback(() => {
        setFreeformItems([]);
        setFreeformDraft('');
        setPendingToggles(new Map());
    }, []);

    const handleSubmitFeedback = useCallback(() => {
        if (!plan || !hasEdits) {
            return;
        }
        const draftTrimmed = freeformDraft.trim();
        const items = draftTrimmed.length > 0
            ? [...allItems, { id: nextId(), text: draftTrimmed }]
            : allItems;
        const prompt = buildFeedbackPrompt(items);
        vscodeApi.postMessage({ command: 'submitPlanFeedback', prompt, data: plan });
        setIsAwaitingRevision(true);
        setDrawerOpen(false);
        setConfirmSubmitOpen(false);
    }, [plan, hasEdits, allItems, freeformDraft, vscodeApi]);

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
                                                    count={allItems.length + (freeformDraft.trim() ? 1 : 0)}
                                                    size='small'
                                                    color='danger'
                                                />
                                            )}
                                        </span>
                                    }
                                    disabled={isAwaitingRevision}
                                    onClick={() => setDrawerOpen((v) => !v)}
                                />
                            </Tooltip>
                            <Tooltip
                                content={isAlreadyApproved ? 'Plan already approved' : 'Approve the plan and continue with Copilot'}
                                relationship='label'
                            >
                                <Button
                                    appearance='primary'
                                    icon={<CheckmarkRegular />}
                                    disabled={isAwaitingRevision || isAlreadyApproved}
                                    onClick={handleApprove}
                                >
                                    Approve Plan
                                </Button>
                            </Tooltip>
                        </div>
                    </div>
                </div>

                {isAwaitingRevision && (
                    <div className='revisionBanner' role='status' aria-live='polite'>
                        <Spinner size='tiny' />
                        <span>Copilot is revising the plan…</span>
                    </div>
                )}

                <PlanToggleContext.Provider value={planToggleContextValue}>
                    {plan.sections
                        .filter((s) => !shouldHideSection(s))
                        .sort((a, b) => sectionSortOrder(a.title) - sectionSortOrder(b.title))
                        .map((section, i) => {
                            const lower = section.title.toLowerCase().trim();
                            const collapsible = !ALWAYS_EXPANDED_SECTIONS.has(lower);
                            const defaultOpen = !collapsible || DEFAULT_OPEN_SECTIONS.has(lower);
                            return (
                                <SectionCard
                                    key={i}
                                    section={section}
                                    collapsible={collapsible}
                                    defaultOpen={defaultOpen}
                                />
                            );
                        })}
                </PlanToggleContext.Provider>
            </div>

            {drawerOpen && !isAwaitingRevision && (
                <FeedbackDrawer
                    items={allItems}
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
                editCount={allItems.length + (freeformDraft.trim() ? 1 : 0)}
                onCancel={() => setConfirmSubmitOpen(false)}
                onSubmit={handleSubmitFeedback}
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
                        {items.map((item) => (
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

const SectionCard = ({ section, collapsible, defaultOpen }: { section: LocalPlanSection; collapsible: boolean; defaultOpen: boolean }): JSX.Element => {
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
                        <ContentBlock key={i} item={item} sectionTitle={section.title} />
                    ))}
                </div>
            )}
        </div>
    );
};

const ContentBlock = ({ item, sectionTitle }: { item: LocalPlanContent; sectionTitle: string }): JSX.Element | null => {
    switch (item.type) {
        case 'table':
            if (findGenerateColumnIdx(item.headers) >= 0) {
                return <GenerateCheckboxTable table={item} sectionTitle={sectionTitle} />;
            }
            return <DataTable headers={item.headers} rows={item.rows} />;
        case 'codeBlock':
            if (item.language?.toLowerCase() === 'mermaid') {
                return <MermaidBlock code={item.code} />;
            }
            return <CodeBlock language={item.language} code={item.code} />;
        case 'bulletList':
            return <BulletListBlock items={item.items} />;
        case 'blockquote':
            return <BlockquoteBlock text={item.text} />;
        case 'paragraph':
            return <p className='paragraph' dangerouslySetInnerHTML={{ __html: formatInline(item.text) }} />;
        case 'subsection':
            return <SubsectionBlock title={item.title} content={item.content} sectionTitle={sectionTitle} />;
    }
};

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

/**
 * Renders a table whose Generate column contains `[x]`/`[ ]` markdown
 * checkboxes. Toggling a checkbox stages a feedback note in the drawer
 * (keyed by row); the plan file is left untouched until Copilot revises it.
 */
const GenerateCheckboxTable = ({ table, sectionTitle }: { table: TableBlock; sectionTitle: string }): JSX.Element => {
    const { getToggle, setToggle } = useContext(PlanToggleContext);
    const generateIdx = findGenerateColumnIdx(table.headers);

    const originalStates = useMemo(
        () => table.rows.map((r) => /\[\s*x\s*\]/i.test(r[generateIdx] ?? '')),
        [table.rows, generateIdx],
    );

    const rowLabel = useCallback((rowIdx: number): string => {
        const row = table.rows[rowIdx];
        const labelIdx = generateIdx + 1 < row.length ? generateIdx + 1 : row.findIndex((_, i) => i !== generateIdx);
        const raw = labelIdx >= 0 ? (row[labelIdx] ?? '').trim() : '';
        const cleaned = raw.replace(/[*`]/g, '').trim();
        return cleaned || `row ${rowIdx + 1}`;
    }, [table.rows, generateIdx]);

    const toggleRow = useCallback((rowIdx: number) => {
        const next = !(getToggle(`${sectionTitle}::${table.lineStart}::${rowIdx}`)?.generate ?? originalStates[rowIdx]);
        const key = `${sectionTitle}::${table.lineStart}::${rowIdx}`;
        if (next === originalStates[rowIdx]) {
            setToggle(key, null);
            return;
        }
        setToggle(key, { sectionTitle, rowLabel: rowLabel(rowIdx), generate: next });
    }, [getToggle, setToggle, sectionTitle, table.lineStart, originalStates, rowLabel]);

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
                    {table.rows.map((row, ri) => {
                        const key = `${sectionTitle}::${table.lineStart}::${ri}`;
                        const checked = getToggle(key)?.generate ?? originalStates[ri];
                        return (
                            <tr key={ri}>
                                {row.map((cell, ci) => {
                                    if (ci === generateIdx) {
                                        return (
                                            <td key={ci} className='dataTableCheckboxCell'>
                                                <Checkbox
                                                    checked={checked}
                                                    onChange={() => toggleRow(ri)}
                                                />
                                            </td>
                                        );
                                    }
                                    return <td key={ci} dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />;
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

const CodeBlock = ({ language, code }: { language: string; code: string }): JSX.Element => (
    <div className='codeBlock'>
        {language && <span className='codeBlockLang'>{language}</span>}
        <pre><code>{code}</code></pre>
    </div>
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

const SubsectionBlock = ({ title, content, sectionTitle }: { title: string; content: LocalPlanContent[]; sectionTitle: string }): JSX.Element => {
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
                        <ContentBlock key={i} item={item} sectionTitle={sectionTitle} />
                    ))}
                </div>
            )}
        </div>
    );
};

function formatInline(text: string): string {
    return escapeHtml(text.trim())
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
        // Auto-link bare URLs (e.g. install columns in the Prerequisites table)
        // — skipped when the URL already follows the `"` of an existing href.
        .replace(/(^|[^"'>])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
        // Restore a small whitelist of presentational HTML tags that the agent
        // emits inside table cells (collapsible endpoint lists, line breaks).
        .replace(/&lt;(\/?(?:details|summary|br))(\s[^&]*?)?\s*\/?&gt;/gi, '<$1$2>');
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

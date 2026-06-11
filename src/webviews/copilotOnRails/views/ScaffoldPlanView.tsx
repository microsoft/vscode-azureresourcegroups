/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, CounterBadge, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner, Textarea, Tooltip } from '@fluentui/react-components';
import { CheckmarkRegular, CommentEditRegular, DismissRegular, DocumentRegular, SendRegular, WarningRegular } from '@fluentui/react-icons';
import { WebviewContext } from '@microsoft/vscode-azext-webview/webview';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { StageProgress } from './components/StageProgress';
import { UiPreviewCard } from './components/UiPreviewCard';
import './styles/scaffoldPlanView.scss';
import { type PlanContent, type PlanData, type PlanSection, type PreviewPage, type TreeNode } from './utils/parseScaffoldPlanMarkdown';

const editableOptions: Record<string, string[]> = {
    'Runtime': ['JavaScript', 'TypeScript', 'Python', 'C# (.NET)'],
    'Backend': ['Azure Functions v4 (Node.js v4 model)', 'Express.js', 'Fastify', 'Flask', 'FastAPI', 'Spring Boot', 'ASP.NET Core'],
    'Frontend': ['React + Vite', 'Next.js', 'Vue + Vite', 'Angular', 'Svelte', 'None'],
    'Package Manager': ['npm', 'yarn', 'pnpm'],
    'Test Runner': ['vitest', 'jest', 'mocha', 'pytest', 'JUnit'],
};

type CellKey = `${number}:${number}:${number}:${number}`;
const cellKey = (s: number, c: number, r: number, col: number): CellKey => `${s}:${c}:${r}:${col}`;

type FeedbackItem =
    | { id: string; kind: 'dropdown'; cell: CellKey; sectionIdx: number; contentIdx: number; rowIdx: number; colIdx: number; field: string; from: string; to: string }
    | { id: string; kind: 'designToken'; target: string; field: string; from: string; to: string }
    | { id: string; kind: 'freeform'; text: string };

let feedbackIdCounter = 0;
const nextId = (): string => `fb-${++feedbackIdCounter}`;

function buildFeedbackPrompt(items: FeedbackItem[], freeform: string, uiNote: string): string {
    const changes = items
        .filter((i): i is Extract<FeedbackItem, { kind: 'dropdown' }> => i.kind === 'dropdown')
        .map(i => `- Change ${i.field} from ${i.from} to ${i.to}`);
    const designChanges = items
        .filter((i): i is Extract<FeedbackItem, { kind: 'designToken' }> => i.kind === 'designToken')
        .map(i => `- Change ${i.field} from ${i.from} to ${i.to}`);
    const notes = items
        .filter((i): i is Extract<FeedbackItem, { kind: 'freeform' }> => i.kind === 'freeform')
        .map(i => `- ${i.text.trim()}`)
        .filter(t => t.length > 2);

    const lines: string[] = [
        'Please revise the project plan based on my feedback and update project-plan.md.',
        'Keep existing sections unchanged unless a change below implies otherwise. Wait for my approval after updating the file.',
        '',
    ];
    if (changes.length > 0) {
        lines.push('Changes:', ...changes, '');
    }
    if (designChanges.length > 0) {
        lines.push(
            'Design changes (update Section 5 "Design System & UI" in project-plan.md):',
            ...designChanges,
            '',
        );
    }
    if (notes.length > 0) {
        lines.push('Additional notes:', ...notes, '');
    }
    if (freeform.trim().length > 0) {
        lines.push('Additional notes:', `- ${freeform.trim()}`, '');
    }
    if (uiNote.trim().length > 0) {
        lines.push(
            'UI changes (apply to Section 5 "Design System & UI" — pages, layout regions, or visual treatments):',
            `- ${uiNote.trim()}`,
            '',
        );
    }
    return lines.join('\n').trimEnd();
}

export const ScaffoldPlanView = (): JSX.Element => {
    const [plan, setPlan] = useState<PlanData | null>(null);
    // HTML/CSS preview pages pushed from the controller via `setPreviewPages`.
    // Lives outside `plan` because it's driven by a file-system watcher on
    // `.azure/.preview-temp/`, not by the plan markdown.
    const [previewPages, setPreviewPages] = useState<PreviewPage[]>([]);
    const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
    const [freeformDraft, setFreeformDraft] = useState('');
    const [uiNote, setUiNote] = useState('');
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [isAwaitingRevision, setIsAwaitingRevision] = useState(false);
    const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
    const originalCellValues = useRef<Map<CellKey, string>>(new Map());
    // Same idea for design tokens (palette swatches + typography), keyed by
    // synthetic target like `palette:Primary` or `typography`.
    const originalDesignValues = useRef<Map<string, string>>(new Map());
    const { vscodeApi } = useContext(WebviewContext);

    const hasEdits = useMemo(
        () => feedbackItems.length > 0 || freeformDraft.trim().length > 0 || uiNote.trim().length > 0,
        [feedbackItems, freeformDraft, uiNote],
    );

    const isAlreadyApproved = useMemo(() => {
        const s = plan?.status?.trim().toLowerCase();
        return !!s && s !== 'planning' && s !== 'unknown';
    }, [plan?.status]);

    const editedCells = useMemo(() => {
        const set = new Set<CellKey>();
        for (const item of feedbackItems) {
            if (item.kind === 'dropdown') {
                set.add(item.cell);
            }
        }
        return set;
    }, [feedbackItems]);
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message?.command === 'setPlanData') {
                setPlan(message.data as PlanData);
                // New plan data from the controller — either the initial load or a
                // post-revision refresh. Either way, clear pending feedback state.
                setFeedbackItems([]);
                setFreeformDraft('');
                setUiNote('');
                originalCellValues.current.clear();
                originalDesignValues.current.clear();
            } else if (message?.command === 'setPreviewPages') {
                setPreviewPages(Array.isArray(message.pages) ? message.pages as PreviewPage[] : []);
            } else if (message?.command === 'revisionInProgress') {
                setIsAwaitingRevision(true);
                setDrawerOpen(false);
            } else if (message?.command === 'revisionComplete') {
                setIsAwaitingRevision(false);
            }
        };
        window.addEventListener('message', handler);
        vscodeApi.postMessage({ command: 'ready' });
        return () => window.removeEventListener('message', handler);
    }, []);

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

    const mutateCell = useCallback((sectionIdx: number, contentIdx: number, rowIdx: number, colIdx: number, value: string) => {
        setPlan(prev => {
            if (!prev) {
                return prev;
            }
            const updated = structuredClone(prev);
            const content = updated.sections[sectionIdx]?.content[contentIdx];
            if (content?.type === 'table') {
                content.rows[rowIdx][colIdx] = value;
            }
            return updated;
        });
    }, []);

    const mutatePaletteEntry = useCallback((token: string, newHex: string) => {
        setPlan(prev => {
            if (!prev) {
                return prev;
            }
            const updated = structuredClone(prev);
            for (const section of updated.sections) {
                for (const content of section.content) {
                    if (content.type === 'colorPalette') {
                        const entry = content.entries.find(e => e.token === token);
                        if (entry) {
                            entry.hex = newHex;
                        }
                    }
                }
            }
            return updated;
        });
    }, []);

    const mutateTypography = useCallback((value: string) => {
        setPlan(prev => {
            if (!prev) {
                return prev;
            }
            const updated = structuredClone(prev);
            for (const section of updated.sections) {
                for (const content of section.content) {
                    if (content.type === 'keyValue' && content.key === 'Typography') {
                        content.value = value;
                    }
                }
            }
            return updated;
        });
    }, []);
    const handleTableCellChange = useCallback((sectionIdx: number, contentIdx: number, rowIdx: number, colIdx: number, value: string) => {
        if (!plan) {
            return;
        }
        const content = plan.sections[sectionIdx]?.content[contentIdx];
        if (!content || content.type !== 'table') {
            return;
        }

        const key = cellKey(sectionIdx, contentIdx, rowIdx, colIdx);
        const currentCellValue = content.rows[rowIdx][colIdx];
        const field = content.rows[rowIdx][0];
        const original = originalCellValues.current.get(key) ?? currentCellValue;
        if (!originalCellValues.current.has(key)) {
            originalCellValues.current.set(key, currentCellValue);
        }

        mutateCell(sectionIdx, contentIdx, rowIdx, colIdx, value);

        setFeedbackItems(prev => {
            const existingIdx = prev.findIndex(i => i.kind === 'dropdown' && i.cell === key);
            // Back to original → drop the feedback item (and forget the original).
            if (value === original) {
                originalCellValues.current.delete(key);
                if (existingIdx >= 0) {
                    const next = prev.slice();
                    next.splice(existingIdx, 1);
                    return next;
                }
                return prev;
            }
            if (existingIdx >= 0) {
                const next = prev.slice();
                const existing = next[existingIdx];
                if (existing.kind === 'dropdown') {
                    next[existingIdx] = { ...existing, to: value };
                }
                return next;
            }
            return [
                ...prev,
                {
                    id: nextId(),
                    kind: 'dropdown',
                    cell: key,
                    sectionIdx, contentIdx, rowIdx, colIdx,
                    field,
                    from: original,
                    to: value,
                },
            ];
        });
    }, [plan, mutateCell]);

    const handleRemoveFeedback = useCallback((id: string) => {
        setFeedbackItems(prev => {
            const item = prev.find(i => i.id === id);
            if (item?.kind === 'dropdown') {
                mutateCell(item.sectionIdx, item.contentIdx, item.rowIdx, item.colIdx, item.from);
                originalCellValues.current.delete(item.cell);
            } else if (item?.kind === 'designToken') {
                if (item.target === 'typography') {
                    mutateTypography(item.from);
                } else if (item.target.startsWith('palette:')) {
                    mutatePaletteEntry(item.target.slice('palette:'.length), item.from);
                }
                originalDesignValues.current.delete(item.target);
            }
            return prev.filter(i => i.id !== id);
        });
    }, [mutateCell, mutatePaletteEntry, mutateTypography]);

    const handleAddNote = useCallback(() => {
        const text = freeformDraft.trim();
        if (!text) {
            return;
        }
        setFeedbackItems(prev => [...prev, { id: nextId(), kind: 'freeform', text }]);
        setFreeformDraft('');
    }, [freeformDraft]);

    const syncDesignTokenFeedback = useCallback((target: string, field: string, original: string, value: string) => {
        setFeedbackItems(prev => {
            const existingIdx = prev.findIndex(i => i.kind === 'designToken' && i.target === target);
            // Back to original → drop the feedback item (and forget the original).
            if (value === original) {
                originalDesignValues.current.delete(target);
                if (existingIdx >= 0) {
                    const next = prev.slice();
                    next.splice(existingIdx, 1);
                    return next;
                }
                return prev;
            }
            if (existingIdx >= 0) {
                const next = prev.slice();
                const existing = next[existingIdx];
                if (existing.kind === 'designToken') {
                    next[existingIdx] = { ...existing, to: value };
                }
                return next;
            }
            return [
                ...prev,
                {
                    id: nextId(),
                    kind: 'designToken',
                    target,
                    field,
                    from: original,
                    to: value,
                },
            ];
        });
    }, []);

    const handlePaletteChange = useCallback((token: string, originalHex: string, newHex: string) => {
        const target = `palette:${token}`;
        if (!originalDesignValues.current.has(target)) {
            originalDesignValues.current.set(target, originalHex);
        }
        const original = originalDesignValues.current.get(target) ?? originalHex;
        mutatePaletteEntry(token, newHex);
        syncDesignTokenFeedback(target, `Color: ${token}`, original, newHex);
    }, [mutatePaletteEntry, syncDesignTokenFeedback]);

    const handleTypographyChange = useCallback((originalValue: string, newValue: string) => {
        const target = 'typography';
        if (!originalDesignValues.current.has(target)) {
            originalDesignValues.current.set(target, originalValue);
        }
        const original = originalDesignValues.current.get(target) ?? originalValue;
        mutateTypography(newValue);
        syncDesignTokenFeedback(target, 'Typography', original, newValue);
    }, [mutateTypography, syncDesignTokenFeedback]);

    const handleDiscardAll = useCallback(() => {
        // Revert any cells touched by dropdown feedback items, plus any palette /
        // typography edits captured by designToken items.
        setFeedbackItems(prev => {
            for (const item of prev) {
                if (item.kind === 'dropdown') {
                    mutateCell(item.sectionIdx, item.contentIdx, item.rowIdx, item.colIdx, item.from);
                } else if (item.kind === 'designToken') {
                    if (item.target === 'typography') {
                        mutateTypography(item.from);
                    } else if (item.target.startsWith('palette:')) {
                        mutatePaletteEntry(item.target.slice('palette:'.length), item.from);
                    }
                }
            }
            return [];
        });
        originalCellValues.current.clear();
        originalDesignValues.current.clear();
        setFreeformDraft('');
        setUiNote('');
    }, [mutateCell, mutatePaletteEntry, mutateTypography]);

    const handleSubmitFeedback = useCallback(() => {
        if (!plan || !hasEdits) {
            return;
        }
        const draftTrimmed = freeformDraft.trim();
        const items = draftTrimmed.length > 0
            ? [...feedbackItems, { id: nextId(), kind: 'freeform' as const, text: draftTrimmed }]
            : feedbackItems;
        const prompt = buildFeedbackPrompt(items, '', uiNote);
        vscodeApi.postMessage({ command: 'submitPlanFeedback', prompt, data: plan });
        setIsAwaitingRevision(true);
        setDrawerOpen(false);
        setConfirmSubmitOpen(false);
    }, [plan, hasEdits, feedbackItems, freeformDraft, uiNote, vscodeApi]);

    if (!plan) {
        return <div className='scaffoldPlanView'><p>Loading plan...</p></div>;
    }

    if (plan.parseError) {
        return (
            <div className='scaffoldPlanView'>
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

    const sections = plan.sections ?? [];
    const overviewSection = sections.find(s => s.number === 1);
    const detailSections = sections.filter(s => s.number === 2 || s.number === 3);
    const structureSection = sections.find(s => s.title.toLowerCase().includes('project structure'));
    const designSection = sections.find(s => s.title.toLowerCase().includes('design system'));
    const draftCount = (freeformDraft.trim() ? 1 : 0) + (uiNote.trim() ? 1 : 0);

    return (
        <div className={`scaffoldPlanView ${drawerOpen ? 'drawerOpen' : ''} ${isAwaitingRevision ? 'revising' : ''}`}>
            <StageProgress currentStage={0} />
            <div className='planMain'>
                <div className='planHeader'>
                    <div className='headerTop'>
                        <div>
                            <h1>Project Plan</h1>
                            <div className='metadataBadges'>
                                {plan.status && plan.status !== 'Unknown' && <span className='badge'>{plan.status}</span>}
                                {plan.mode && plan.mode !== 'Unknown' && <span className='badge subtle'>{plan.mode}</span>}
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
                                                    count={feedbackItems.length + draftCount}
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

                {overviewSection && <OverviewCard section={overviewSection} created={plan.created && plan.created !== 'Unknown' ? plan.created : undefined} />}

                <div className='sectionsRow'>
                    {detailSections.map((section) => {
                        const sectionIdx = sections.indexOf(section);
                        return (
                            <SectionCard
                                key={section.number}
                                section={section}
                                sectionIdx={sectionIdx}
                                disabled={isAwaitingRevision}
                                editedCells={editedCells}
                                onTableCellChange={handleTableCellChange}
                            />
                        );
                    })}
                </div>

                {designSection && (
                    <UiPreviewCard
                        section={designSection}
                        uiNote={uiNote}
                        disabled={isAwaitingRevision}
                        previewPages={previewPages}
                        onPaletteChange={handlePaletteChange}
                        onTypographyChange={handleTypographyChange}
                        onUiNoteChange={setUiNote}
                    />
                )}

                {structureSection && <ProjectStructureCard section={structureSection} />}
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
                editCount={feedbackItems.length + draftCount}
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
                        {items.map(item => (
                            <li key={item.id} className={`feedbackItem ${item.kind}`}>
                                {(item.kind === 'dropdown' || item.kind === 'designToken') ? (
                                    <span className='feedbackChipText'>
                                        <strong>{item.field}:</strong> {item.from}
                                        <span className='arrow'> → </span>
                                        {item.to}
                                    </span>
                                ) : (
                                    <span className='feedbackFreeformText'>{item.text}</span>
                                )}
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
                        placeholder='Add a note for Copilot (e.g. "Prefer a monorepo layout")'
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

const OverviewCard = ({ section, created }: { section: PlanSection; created?: string }): JSX.Element => {
    const goal = section.content?.find(c => c.type === 'keyValue' && c.key === 'Goal') as { type: 'keyValue'; key: string; value: string } | undefined;
    const appType = section.content?.find(c => c.type === 'keyValue' && c.key === 'App Type') as { type: 'keyValue'; key: string; value: string } | undefined;
    const mode = section.content?.find(c => c.type === 'keyValue' && c.key === 'Mode') as { type: 'keyValue'; key: string; value: string } | undefined;
    const tables = section.content?.filter(c => c.type === 'table') ?? [];

    return (
        <div className='sectionCard overviewWrapper'>
            <div className='overviewTitle'>
                <h2>Overview</h2>
                {created && <span className='created'>Created: {created}</span>}
            </div>
            {goal && <p className='goalText'>{goal.value}</p>}
            <div className='overviewMeta'>
                {appType && (
                    <div className='metaItem'>
                        <span className='metaLabel'>App Type</span>
                        <span className='metaValue'>{appType.value}</span>
                    </div>
                )}
                {mode && (
                    <div className='metaItem'>
                        <span className='metaLabel'>Mode</span>
                        <span className='metaValue'>{mode.value}</span>
                    </div>
                )}
            </div>
            {tables.length > 0 && tables.map((item, i) => {
                if (item.type !== 'table') { return null; }
                return (
                    <div key={i} className='overviewTableWrapper'>
                        <table className='planTable'>
                            <thead>
                                <tr>{item.headers.map((h, hi) => <th key={hi}>{h}</th>)}</tr>
                            </thead>
                            <tbody>
                                {item.rows.map((row, ri) => (
                                    <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
            })}
        </div>
    );
};

interface SectionCardProps {
    section: PlanSection;
    sectionIdx: number;
    disabled?: boolean;
    editedCells?: Set<CellKey>;
    onTableCellChange: (sectionIdx: number, contentIdx: number, rowIdx: number, colIdx: number, value: string) => void;
}

const SectionCard = ({ section, sectionIdx, disabled, editedCells, onTableCellChange }: SectionCardProps): JSX.Element => (
    <div className='sectionCard'>
        <h2>{section.title}</h2>
        <div className='sectionContent'>
            {(section.content ?? []).map((item, contentIdx) => (
                <ContentBlock
                    key={contentIdx}
                    item={item}
                    sectionIdx={sectionIdx}
                    contentIdx={contentIdx}
                    disabled={disabled}
                    editedCells={editedCells}
                    onTableCellChange={onTableCellChange}
                />
            ))}
        </div>
    </div>
);

const ProjectStructureCard = ({ section }: { section: PlanSection }): JSX.Element => {
    const treeContent = section.content?.find(c => c.type === 'tree');

    if (!treeContent || treeContent.type !== 'tree') {
        return <div className='sectionCard'><h2>{section.title}</h2><p className='paragraph'>No structure found.</p></div>;
    }

    return (
        <div className='sectionCard'>
            <h2>{section.title}</h2>
            <div className='treeView'>
                <TreeNodeItem node={{ name: treeContent.root, isFolder: true, children: treeContent.nodes }} depth={0} defaultOpen={true} />
            </div>
        </div>
    );
};

const TreeNodeItem = ({ node, depth, defaultOpen }: { node: TreeNode; depth: number; defaultOpen?: boolean }): JSX.Element => {
    const [open, setOpen] = useState(defaultOpen ?? depth < 1);
    const hasChildren = node.children.length > 0;

    return (
        <div className='treeNode'>
            <div
                className={`treeRow ${hasChildren ? 'clickable' : ''}`}
                style={{ paddingLeft: `${depth * 16}px` }}
                onClick={() => hasChildren && setOpen(!open)}
            >
                {hasChildren ? (
                    <span className={`treeChevron ${open ? 'open' : ''}`}>▶</span>
                ) : (
                    <span className='treeChevronSpacer' />
                )}
                <span className={`treeIcon codicon ${node.isFolder ? 'codicon-folder' : 'codicon-file'}`} />
                <span className='treeName'>{node.name}</span>
                {node.comment && <span className='treeComment'>{node.comment}</span>}
            </div>
            {open && hasChildren && (
                <div className='treeChildren'>
                    {node.children.map((child, i) => (
                        <TreeNodeItem key={i} node={child} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
};

interface ContentBlockProps {
    item: PlanContent;
    sectionIdx: number;
    contentIdx: number;
    disabled?: boolean;
    editedCells?: Set<CellKey>;
    onTableCellChange: (sectionIdx: number, contentIdx: number, rowIdx: number, colIdx: number, value: string) => void;
}

const ContentBlock = ({ item, sectionIdx, contentIdx, disabled, editedCells, onTableCellChange }: ContentBlockProps): JSX.Element => {
    switch (item.type) {
        case 'keyValue':
            return (
                <div className='keyValue'>
                    <span className='key'>{item.key}</span>
                    <span className='value'>{item.value}</span>
                </div>
            );
        case 'table':
            return (
                <table className='planTable'>
                    <thead>
                        <tr>
                            {item.headers.map((h, i) => <th key={i}>{h}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {item.rows.map((row, ri) => (
                            <tr key={ri}>
                                {row.map((cell, ci) => {
                                    const componentName = row[0];
                                    const options = ci > 0 ? editableOptions[componentName] : undefined;
                                    const isEdited = options ? editedCells?.has(cellKey(sectionIdx, contentIdx, ri, ci)) : false;
                                    return (
                                        <td key={ci} className={isEdited ? 'editedCell' : undefined}>
                                            {options ? (
                                                <select
                                                    className={`cellDropdown ${isEdited ? 'edited' : ''}`}
                                                    value={cell}
                                                    disabled={disabled}
                                                    onChange={(e) => onTableCellChange(sectionIdx, contentIdx, ri, ci, e.target.value)}
                                                >
                                                    {!options.includes(cell) && <option value={cell}>{cell}</option>}
                                                    {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                </select>
                                            ) : cell}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            );
        case 'blockquote':
            return <div className='blockquote'>{item.text}</div>;
        case 'paragraph':
            return <p className='paragraph'>{item.text}</p>;
        case 'tree':
            return <div />;
        case 'colorPalette':
        case 'pages':
            // Rendered by UiPreviewCard; ContentBlock is only used for sections 2/3.
            return <div />;
    }
};

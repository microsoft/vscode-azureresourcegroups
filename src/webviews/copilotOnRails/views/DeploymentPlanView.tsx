/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, CounterBadge, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner, Textarea, Tooltip } from '@fluentui/react-components';
import { CheckmarkRegular, CommentEditRegular, DismissRegular, DocumentRegular, SendRegular, WarningRegular } from '@fluentui/react-icons';
import { useConfiguration, WebviewContext } from '@microsoft/vscode-azext-webview/webview';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { StageProgress } from './components/StageProgress';
import './styles/deploymentPlanView.scss';
import { type DeploymentPlanData, type DeploymentPlanTable } from './utils/deploymentPlanTypes';
import { type DeploymentPlanViewConfiguration, type DeploymentPlanViewStrings } from './utils/viewConfigTypes';

export type { DeploymentPlanData, DeploymentPlanTable };

function format(template: string, ...args: string[]): string {
    return template.replace(/\{(\d+)\}/g, (match, idx) => {
        const i = Number(idx);
        return i < args.length ? args[i] : match;
    });
}

type SkuKey = `sku:${number}`;
type SettingKey = 'location';

type FeedbackItem =
    | { id: string; kind: 'dropdown'; cell: SkuKey; rowIdx: number; field: string; from: string; to: string }
    | { id: string; kind: 'setting'; key: SettingKey; field: string; from: string; to: string }
    | { id: string; kind: 'freeform'; text: string };

let feedbackIdCounter = 0;
const nextId = (): string => `fb-${++feedbackIdCounter}`;

function buildFeedbackPrompt(items: FeedbackItem[]): string {
    const skuChanges = items
        .filter((i): i is Extract<FeedbackItem, { kind: 'dropdown' }> => i.kind === 'dropdown')
        .map(i => `- Change SKU for ${i.field} from ${i.from} to ${i.to}`);
    const settingChanges = items
        .filter((i): i is Extract<FeedbackItem, { kind: 'setting' }> => i.kind === 'setting')
        .map(i => `- Change ${i.field} from ${i.from} to ${i.to}`);
    const changes = [...settingChanges, ...skuChanges];
    const notes = items
        .filter((i): i is Extract<FeedbackItem, { kind: 'freeform' }> => i.kind === 'freeform')
        .map(i => `- ${i.text.trim()}`)
        .filter(t => t.length > 2);

    const lines: string[] = [
        'Please revise the deployment plan based on my feedback and update the prepare-plan.json',
        'Keep existing sections unchanged unless a change below implies otherwise. Wait for my approval after updating the file.',
        '',
    ];
    if (changes.length > 0) {
        lines.push('Changes:', ...changes, '');
    }
    if (notes.length > 0) {
        lines.push('Additional notes:', ...notes, '');
    }
    return lines.join('\n').trimEnd();
}

export const DeploymentPlanView = (): JSX.Element => {
    const { strings } = useConfiguration<DeploymentPlanViewConfiguration>();
    const [plan, setPlan] = useState<DeploymentPlanData | null>(null);
    const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
    const [freeformDraft, setFreeformDraft] = useState('');
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [isAwaitingRevision, setIsAwaitingRevision] = useState(false);
    const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
    // Tracks the ORIGINAL SKU value when first edited, keyed by row index.
    // Used to revert cells when a dropdown feedback item is discarded or the
    // user selects the same value again.
    const originalSkuValues = useRef<Map<SkuKey, string>>(new Map());
    const originalSettings = useRef<Map<SettingKey, string>>(new Map());
    const { vscodeApi } = useContext(WebviewContext);

    const hasEdits = useMemo(
        () => feedbackItems.length > 0 || freeformDraft.trim().length > 0,
        [feedbackItems, freeformDraft],
    );

    const missingRequiredSelection = useMemo(
        () => !plan?.locationCode?.trim(),
        [plan?.locationCode],
    );

    const editedRows = useMemo(() => {
        const set = new Set<number>();
        for (const item of feedbackItems) {
            if (item.kind === 'dropdown') {
                set.add(item.rowIdx);
            }
        }
        return set;
    }, [feedbackItems]);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message?.command === 'setDeploymentPlanData') {
                setPlan(message.data as DeploymentPlanData);
                // New plan data from the controller — either the initial load or a
                // post-revision refresh. Either way, clear pending feedback state.
                setFeedbackItems([]);
                setFreeformDraft('');
                originalSkuValues.current.clear();
                originalSettings.current.clear();
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
        if (!plan || missingRequiredSelection) {
            return;
        }
        if (hasEdits) {
            setConfirmSubmitOpen(true);
            return;
        }
        vscodeApi.postMessage({ command: 'approve', data: plan });
    }, [vscodeApi, plan, hasEdits, missingRequiredSelection]);

    const handleLocationChange = useCallback((value: string) => {
        if (!plan) { return; }
        const key: SettingKey = 'location';
        const locations = plan.availableLocations ?? [];
        const selected = locations.find(l => l.code === value);
        const displayValue = selected ? `${selected.name} (${selected.code})` : value;
        const originalDisplay = formatLocation(plan.location, plan.locationCode);
        const original = originalSettings.current.get(key) ?? originalDisplay;
        if (!originalSettings.current.has(key)) {
            originalSettings.current.set(key, originalDisplay);
        }

        setPlan(prev => {
            if (!prev) { return prev; }
            return {
                ...prev,
                location: selected?.name ?? value,
                locationCode: value,
            };
        });
        vscodeApi.postMessage({ command: 'locationChanged', data: value });

        setFeedbackItems(prev => {
            const existingIdx = prev.findIndex(i => i.kind === 'setting' && i.key === key);
            if (displayValue === original) {
                originalSettings.current.delete(key);
                if (existingIdx >= 0) {
                    const next = prev.slice();
                    next.splice(existingIdx, 1);
                    return next;
                }
                return prev;
            }
            const item: FeedbackItem = { id: existingIdx >= 0 ? prev[existingIdx].id : nextId(), kind: 'setting', key, field: 'Location', from: original, to: displayValue };
            if (existingIdx >= 0) {
                const next = prev.slice();
                next[existingIdx] = item;
                return next;
            }
            return [...prev, item];
        });
    }, [vscodeApi, plan]);

    const mutateSku = useCallback((rowIdx: number, value: string) => {
        setPlan(prev => {
            if (!prev) { return prev; }
            const updated = structuredClone(prev);
            const skuColIdx = updated.resources.headers.length - 1;
            updated.resources.rows[rowIdx][skuColIdx] = value;
            return updated;
        });
    }, []);

    const handleResourceSkuChange = useCallback((rowIdx: number, value: string) => {
        if (!plan) {
            return;
        }
        const skuColIdx = plan.resources.headers.length - 1;
        const currentValue = plan.resources.rows[rowIdx][skuColIdx];
        const field = plan.resources.rows[rowIdx][0];
        const key: SkuKey = `sku:${rowIdx}`;
        const original = originalSkuValues.current.get(key) ?? currentValue;
        if (!originalSkuValues.current.has(key)) {
            originalSkuValues.current.set(key, currentValue);
        }

        mutateSku(rowIdx, value);

        setFeedbackItems(prev => {
            const existingIdx = prev.findIndex(i => i.kind === 'dropdown' && i.cell === key);
            // Back to original → drop the feedback item (and forget the original).
            if (value === original) {
                originalSkuValues.current.delete(key);
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
                    rowIdx,
                    field,
                    from: original,
                    to: value,
                },
            ];
        });
    }, [plan, mutateSku]);

    const handleRemoveFeedback = useCallback((id: string) => {
        setFeedbackItems(prev => {
            const item = prev.find(i => i.id === id);
            if (item?.kind === 'dropdown') {
                mutateSku(item.rowIdx, item.from);
                originalSkuValues.current.delete(item.cell);
            } else if (item?.kind === 'setting') {
                // Revert the setting to its original value
                // Parse "Name (code)" back to parts
                const original = item.from;
                const match = original.match(/^(.+?)\s*\(([^)]+)\)$/);
                setPlan(p => p ? { ...p, location: match?.[1] ?? original, locationCode: match?.[2] ?? original } : p);
                originalSettings.current.delete(item.key);
            }
            return prev.filter(i => i.id !== id);
        });
    }, [mutateSku]);

    const handleAddNote = useCallback(() => {
        const text = freeformDraft.trim();
        if (!text) {
            return;
        }
        setFeedbackItems(prev => [...prev, { id: nextId(), kind: 'freeform', text }]);
        setFreeformDraft('');
    }, [freeformDraft]);

    const handleDiscardAll = useCallback(() => {
        // Revert any cells touched by dropdown or setting feedback items.
        setFeedbackItems(prev => {
            for (const item of prev) {
                if (item.kind === 'dropdown') {
                    mutateSku(item.rowIdx, item.from);
                } else if (item.kind === 'setting') {
                    const original = item.from;
                    const match = original.match(/^(.+?)\s*\(([^)]+)\)$/);
                    setPlan(p => p ? { ...p, location: match?.[1] ?? original, locationCode: match?.[2] ?? original } : p);
                }
            }
            return [];
        });
        originalSkuValues.current.clear();
        originalSettings.current.clear();
        setFreeformDraft('');
    }, [mutateSku]);

    const handleSubmitFeedback = useCallback(() => {
        if (!plan || !hasEdits) {
            return;
        }
        const draftTrimmed = freeformDraft.trim();
        const items = draftTrimmed.length > 0
            ? [...feedbackItems, { id: nextId(), kind: 'freeform' as const, text: draftTrimmed }]
            : feedbackItems;
        const prompt = buildFeedbackPrompt(items);
        vscodeApi.postMessage({ command: 'submitPlanFeedback', prompt, data: plan });
        setIsAwaitingRevision(true);
        setDrawerOpen(false);
        setConfirmSubmitOpen(false);
    }, [plan, hasEdits, feedbackItems, freeformDraft, vscodeApi]);

    if (!plan) {
        return <div className='deploymentPlanView'><p>{strings.loading}</p></div>;
    }

    if (plan.parseError) {
        return (
            <div className='deploymentPlanView'>
                <div className='parseFailureWarning' role='alert'>
                    <div className='parseFailureIcon'><WarningRegular /></div>
                    <div className='parseFailureBody'>
                        <h2>{strings.parseFailureTitle}</h2>
                        <p>{plan.parseError.message || strings.parseFailureFallbackMessage}</p>
                        {plan.parseError.fileLabel && (
                            <p className='parseFailureFile'><strong>{strings.parseFailureFileLabel}:</strong> {plan.parseError.fileLabel}</p>
                        )}
                        <Button
                            appearance='primary'
                            icon={<DocumentRegular />}
                            onClick={() => vscodeApi.postMessage({ command: 'openSourceFile' })}
                        >
                            {strings.openPlanFileButton}
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`deploymentPlanView ${drawerOpen ? 'drawerOpen' : ''} ${isAwaitingRevision ? 'revising' : ''}`}>
            <div className='planMain'>
                <div className='stickyTop'>
                    <StageProgress currentStage={2} />
                    <div className='planHeader'>
                        <div className='headerTop'>
                            <div>
                                <h1>{strings.title}</h1>
                            </div>
                            <div className='headerActions'>
                                <Tooltip content={strings.feedbackButtonTooltip} relationship='label'>
                                    <Button
                                        appearance='subtle'
                                        aria-label={strings.feedbackButtonAriaLabel}
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
                                <Tooltip
                                    content={missingRequiredSelection ? strings.approveButtonMissingSelectionTooltip : strings.approveButtonTooltip}
                                    relationship='label'
                                >
                                    <Button
                                        appearance='primary'
                                        icon={<CheckmarkRegular />}
                                        disabled={isAwaitingRevision || missingRequiredSelection}
                                        onClick={handleApprove}
                                    >
                                        {strings.approveButton}
                                    </Button>
                                </Tooltip>
                            </div>
                        </div>
                    </div>
                </div>

                {isAwaitingRevision && (
                    <div className='revisionBanner' role='status' aria-live='polite'>
                        <Spinner size='tiny' />
                        <span>{strings.revisingBanner}</span>
                    </div>
                )}

                <div className='infoCards'>
                    <div className='infoCard'>
                        <span className='infoLabel'>{strings.locationLabel}<span className='requiredMarker' aria-hidden='true'> *</span></span>
                        {plan.availableLocations && plan.availableLocations.length > 0 ? (
                            <select
                                className='cellDropdown'
                                value={plan.locationCode}
                                disabled={isAwaitingRevision}
                                onChange={(e) => handleLocationChange(e.target.value)}
                            >
                                {!plan.locationCode && (
                                    <option value='' disabled>{strings.selectLocationPlaceholder}</option>
                                )}
                                {plan.locationCode && !plan.availableLocations.some(l => l.code === plan.locationCode) && (
                                    <option value={plan.locationCode}>{formatLocation(plan.location, plan.locationCode)}</option>
                                )}
                                {plan.availableLocations.map(loc => (
                                    <option key={loc.code} value={loc.code}>{loc.name} ({loc.code})</option>
                                ))}
                            </select>
                        ) : (
                            <>
                                <span className='infoValue'>{formatLocation(plan.location, plan.locationCode)}</span>
                                {plan.locationsUnavailable && (
                                    <span className='infoHint'>
                                        {plan.locationsUnavailable === 'signedOut' ? strings.locationsSignedOutHint : strings.locationsFailedHint}
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                    {plan.deploymentVariables?.environmentName && (
                        <div className='infoCard'>
                            <span className='infoLabel'>{strings.environmentNameLabel}</span>
                            <span className='infoValue'>{plan.deploymentVariables.environmentName}</span>
                        </div>
                    )}
                    {plan.costEstimate && (
                        <div className='infoCard'>
                            <span className='infoLabel'>{strings.estimatedCostLabel}</span>
                            <span className='infoValue'>{formatMonthlyCost(plan.costEstimate.monthlyUsd, plan.costEstimate.currency)}</span>
                        </div>
                    )}
                </div>

                {plan.resources.rows.length > 0 && (
                    <details className='sectionCard' open>
                        <summary><h2>{strings.azureResourcesHeading}</h2></summary>
                        <ResourcesTable
                            table={plan.resources}
                            disabled={isAwaitingRevision}
                            editedRows={editedRows}
                            onSkuChange={handleResourceSkuChange}
                        />
                    </details>
                )}

                {plan.costEstimate && plan.costEstimate.breakdown.length > 0 && (
                    <details className='sectionCard'>
                        <summary><h2>{strings.costEstimateHeading}</h2></summary>
                        <table className='planTable'>
                            <thead>
                                <tr>
                                    <th>{strings.costServiceHeader}</th>
                                    <th>{strings.costSkuHeader}</th>
                                    <th>{strings.costMonthlyHeader}</th>
                                    <th>{strings.costNotesHeader}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {plan.costEstimate.breakdown.map((item, i) => (
                                    <tr key={i}>
                                        <td>{item.service}</td>
                                        <td>{item.sku}</td>
                                        <td>{formatMonthlyCost(item.monthlyUsd, plan.costEstimate?.currency)}</td>
                                        <td>{item.note}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td colSpan={2}><strong>{strings.costEstimateTotalLabel}</strong></td>
                                    <td colSpan={2}><strong>{formatMonthlyCost(plan.costEstimate.monthlyUsd, plan.costEstimate.currency)}</strong></td>
                                </tr>
                            </tfoot>
                        </table>
                        {plan.costEstimate.disclaimer && <p className='sectionNote'>{plan.costEstimate.disclaimer}</p>}
                    </details>
                )}

                {plan.postDeployRecommendations && plan.postDeployRecommendations.length > 0 && (
                    <details className='sectionCard'>
                        <summary><h2>{strings.recommendationsHeading}</h2></summary>
                        <ul className='recommendationList'>
                            {plan.postDeployRecommendations.map((rec, i) => (
                                <li key={i}>
                                    <div className='recommendationTitle'>
                                        <strong>{rec.title}</strong>
                                        {rec.effort && <span className={`badge effort ${rec.effort}`}>{strings.recommendationEffortLabel}: {rec.effort}</span>}
                                    </div>
                                    <div className='recommendationReason'>{rec.reason}</div>
                                    {rec.services && rec.services.length > 0 && (
                                        <div className='recommendationServices'>{rec.services.join(', ')}</div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </details>
                )}

            </div>

            {drawerOpen && !isAwaitingRevision && (
                <FeedbackDrawer
                    strings={strings}
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
                strings={strings}
                open={confirmSubmitOpen}
                editCount={feedbackItems.length + (freeformDraft.trim() ? 1 : 0)}
                onCancel={() => setConfirmSubmitOpen(false)}
                onSubmit={handleSubmitFeedback}
            />
        </div>
    );
};

interface FeedbackDrawerProps {
    strings: DeploymentPlanViewStrings;
    items: FeedbackItem[];
    freeformDraft: string;
    onFreeformChange: (value: string) => void;
    onAddNote: () => void;
    onRemoveItem: (id: string) => void;
    onSubmit: () => void;
    onDiscardAll: () => void;
    onClose: () => void;
}

const FeedbackDrawer = ({ strings, items, freeformDraft, onFreeformChange, onAddNote, onRemoveItem, onSubmit, onDiscardAll, onClose }: FeedbackDrawerProps): JSX.Element => {
    const hasAny = items.length > 0 || freeformDraft.trim().length > 0;
    return (
        <aside className='feedbackDrawer' aria-label={strings.feedbackDrawerAriaLabel}>
            <div className='drawerHeader'>
                <h2>{strings.requestChangesHeading}</h2>
                <Button
                    appearance='subtle'
                    icon={<DismissRegular />}
                    aria-label={strings.closeFeedbackAriaLabel}
                    onClick={onClose}
                />
            </div>
            <p className='drawerInfo'>{strings.feedbackDrawerInfoTooltip}</p>

            <div className='drawerBody'>
                {items.length > 0 && (
                    <ul className='feedbackList'>
                        {items.map(item => (
                            <li key={item.id} className={`feedbackItem ${item.kind}`}>
                                {item.kind === 'dropdown' || item.kind === 'setting' ? (
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
                                    aria-label={strings.removeFeedbackItemAriaLabel}
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
                        placeholder={strings.freeformPlaceholder}
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
                            {strings.addNoteButton}
                        </Button>
                    </div>
                </div>
            </div>

            <div className='drawerFooter'>
                <Button
                    className='discardButton'
                    appearance='outline'
                    disabled={!hasAny}
                    onClick={onDiscardAll}
                >
                    {strings.discardAllButton}
                </Button>
                <Button
                    appearance='primary'
                    icon={<SendRegular />}
                    disabled={!hasAny}
                    onClick={onSubmit}
                >
                    {strings.submitFeedbackButton}
                </Button>
            </div>
        </aside>
    );
};

interface SubmitEditsDialogProps {
    strings: DeploymentPlanViewStrings;
    open: boolean;
    editCount: number;
    onCancel: () => void;
    onSubmit: () => void;
}

const SubmitEditsDialog = ({ strings, open, editCount, onCancel, onSubmit }: SubmitEditsDialogProps): JSX.Element => {
    let message: string;
    if (editCount === 1) {
        message = format(strings.pendingEditsSingularMessage, String(editCount));
    } else if (editCount > 1) {
        message = format(strings.pendingEditsPluralMessage, String(editCount));
    } else {
        message = strings.editsMadeFallbackMessage;
    }
    return (
        <Dialog open={open} onOpenChange={(_, data) => { if (!data.open) { onCancel(); } }}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{strings.submitEditsDialogTitle}</DialogTitle>
                    <DialogContent>
                        {message}
                    </DialogContent>
                    <DialogActions>
                        <Button appearance='secondary' onClick={onCancel}>{strings.cancelButton}</Button>
                        <Button appearance='primary' icon={<SendRegular />} onClick={onSubmit}>{strings.submitEditsButton}</Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

/** Formats a location as `Display Name (code)`, or just the code when the display name is unknown. */
function formatLocation(name: string, code: string): string {
    return name ? `${name} (${code})` : code;
}

/** Formats a monthly cost figure, e.g. `$23.00/mo`. */
function formatMonthlyCost(monthlyUsd: number, currency?: string): string {
    const symbol = !currency || currency === 'USD' ? '$' : `${currency} `;
    return `${symbol}${monthlyUsd.toFixed(2)}/mo`;
}

// Keys are the resource labels rendered in the first column of the resources table — the
// friendly names the prepare-plan.json parser derives from `services[].name`.
const skuOptions: Record<string, string[]> = {
    'Static Web Apps': ['Free', 'Standard'],
    'Functions App': ['Consumption (Y1)', 'FlexConsumption (FC1)', 'Premium (EP1)', 'Premium (EP2)', 'Premium (EP3)'],
    'Storage Account': ['Standard_LRS', 'Standard_GRS', 'Standard_ZRS'],
    'Cosmos DB account': ['Serverless, NoSQL', 'Provisioned (400 RU/s), NoSQL', 'Provisioned (1000 RU/s), NoSQL'],
    'Key Vault': ['standard', 'premium'],
    'Log Analytics Workspace': ['PerGB2018', 'CapacityReservation', 'Free'],
    'App Service': ['F1', 'B1', 'B2', 'S1', 'P0v3', 'P1v3'],
    'App Service Plan': ['F1', 'B1', 'B2', 'S1', 'P0v3', 'P1v3'],
    'Container App': ['Consumption', 'Dedicated'],
    'PostgreSQL Flexible Server': ['Standard_B1ms', 'Standard_B2s', 'Standard_D2ds_v4'],
    'MySQL Flexible Server': ['Standard_B1ms', 'Standard_B2s', 'Standard_D2ds_v4'],
    'Azure OpenAI': ['S0'],
    'Azure Cache for Redis': ['Basic C0', 'Basic C1', 'Standard C1'],
};

interface ResourcesTableProps {
    table: DeploymentPlanTable;
    disabled?: boolean;
    editedRows?: Set<number>;
    onSkuChange: (rowIdx: number, value: string) => void;
}

const ResourcesTable = ({ table, disabled, editedRows, onSkuChange }: ResourcesTableProps): JSX.Element => {
    const skuColIdx = table.headers.length - 1;

    return (
        <table className='planTable resourcesTable'>
            <thead>
                <tr>{table.headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
            </thead>
            <tbody>
                {table.rows.map((row, ri) => {
                    const resourceName = row[0];
                    const options = skuOptions[resourceName];
                    const isEdited = options ? editedRows?.has(ri) : false;
                    return (
                        <tr key={ri}>
                            {row.map((cell, ci) => (
                                <td key={ci} className={ci === skuColIdx && isEdited ? 'editedCell' : undefined}>
                                    {ci === skuColIdx && options ? (
                                        <select
                                            className={`cellDropdown ${isEdited ? 'edited' : ''}`}
                                            value={cell}
                                            disabled={disabled}
                                            onChange={(e) => onSkuChange(ri, e.target.value)}
                                        >
                                            {!options.includes(cell) && <option value={cell}>{cell}</option>}
                                            {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                        </select>
                                    ) : cell}
                                </td>
                            ))}
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
};

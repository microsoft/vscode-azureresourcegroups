/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Spinner, Textarea, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseRegular, CheckmarkRegular, CommentEditRegular, DismissRegular, OpenRegular, SendRegular, WarningRegular } from '@fluentui/react-icons';
import { WebviewContext } from '@microsoft/vscode-azext-webview/webview';
import { useCallback, useContext, useEffect, useState, type JSX } from 'react';
import { StageProgress } from './components/StageProgress';
import './styles/frontendPreviewView.scss';

type PreviewState =
    | { status: 'starting' }
    | { status: 'ready'; url: string; folderLabel: string }
    | { status: 'error'; error: string };

function buildFeedbackPrompt(notes: string): string {
    return [
        'Please revise the scaffolded frontend based on my feedback below.',
        'Update the components/pages in the frontend project (keep using the mock data) so the running preview reflects these changes, then let me re-review.',
        '',
        'Feedback:',
        notes.trim(),
    ].join('\n');
}

export const FrontendPreviewView = (): JSX.Element => {
    const { vscodeApi } = useContext(WebviewContext);
    const [preview, setPreview] = useState<PreviewState>({ status: 'starting' });
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const [feedbackSent, setFeedbackSent] = useState(false);
    const [approved, setApproved] = useState(false);

    useEffect(() => {
        const handler = (event: MessageEvent): void => {
            const message = event.data;
            if (message?.command === 'setPreviewState') {
                setPreview(message.state as PreviewState);
            } else if (message?.command === 'setApproved') {
                setApproved(true);
            } else if (message?.command === 'feedbackSubmitted') {
                setFeedbackSent(true);
                setDrawerOpen(false);
                setDraft('');
            }
        };
        window.addEventListener('message', handler);
        vscodeApi.postMessage({ command: 'ready' });
        return () => window.removeEventListener('message', handler);
    }, []);

    const handleApprove = useCallback(() => {
        setApproved(true);
        vscodeApi.postMessage({ command: 'approveUi' });
    }, [vscodeApi]);

    const handleSubmitFeedback = useCallback(() => {
        if (draft.trim().length === 0) {
            return;
        }
        vscodeApi.postMessage({ command: 'submitUiFeedback', prompt: buildFeedbackPrompt(draft) });
    }, [draft, vscodeApi]);

    const isReady = preview.status === 'ready';

    return (
        <div className={`frontendPreviewView ${drawerOpen ? 'drawerOpen' : ''}`}>
            <StageProgress currentStage={0} />
            <div className='previewMain'>
                <div className='previewHeader'>
                    <div className='headerTop'>
                        <div>
                            <h1>Frontend Preview</h1>
                            <div className='metadataBadges'>
                                <span className='badge'>Mock data</span>
                                {isReady && <span className='badge subtle'>{preview.folderLabel}</span>}
                            </div>
                        </div>
                        <div className='headerActions'>
                            {isReady && (
                                <>
                                    <Tooltip content='Open the preview in your browser' relationship='label'>
                                        <Button
                                            appearance='subtle'
                                            aria-label='Open in browser'
                                            icon={<OpenRegular />}
                                            onClick={() => vscodeApi.postMessage({ command: 'openExternal' })}
                                        />
                                    </Tooltip>
                                    <Tooltip content='Restart the preview server' relationship='label'>
                                        <Button
                                            appearance='subtle'
                                            aria-label='Reload preview'
                                            icon={<ArrowClockwiseRegular />}
                                            onClick={() => vscodeApi.postMessage({ command: 'retry' })}
                                        />
                                    </Tooltip>
                                </>
                            )}
                            <Tooltip content='Request changes to the UI before approving' relationship='label'>
                                <Button
                                    appearance='subtle'
                                    aria-label='Feedback'
                                    icon={<CommentEditRegular />}
                                    onClick={() => setDrawerOpen(v => !v)}
                                />
                            </Tooltip>
                            <Tooltip content='Approve the UI and continue to integration' relationship='label'>
                                <Button
                                    appearance='primary'
                                    icon={<CheckmarkRegular />}
                                    disabled={!isReady || approved}
                                    onClick={handleApprove}
                                >
                                    {approved ? 'Approved' : 'Approve UI'}
                                </Button>
                            </Tooltip>
                        </div>
                    </div>
                </div>

                {feedbackSent && (
                    <div className='feedbackBanner' role='status' aria-live='polite'>
                        <Spinner size='tiny' />
                        <span>Sent to Copilot. Your changes will hot-reload in the preview below — re-review when ready.</span>
                    </div>
                )}

                <div className='previewSurface'>
                    {preview.status === 'starting' && (
                        <div className='previewPlaceholder' role='status' aria-live='polite'>
                            <Spinner size='large' label='Starting the frontend preview server…' />
                            <p className='previewHint'>This builds and serves the scaffolded frontend with mock data.</p>
                        </div>
                    )}

                    {preview.status === 'error' && (
                        <div className='previewPlaceholder previewError' role='alert'>
                            <div className='previewErrorIcon'><WarningRegular /></div>
                            <h2>Couldn't start the preview</h2>
                            <pre className='previewErrorMessage'>{preview.error}</pre>
                            <Button
                                appearance='primary'
                                icon={<ArrowClockwiseRegular />}
                                onClick={() => vscodeApi.postMessage({ command: 'retry' })}
                            >
                                Try again
                            </Button>
                        </div>
                    )}

                    {isReady && (
                        <div className='previewFrame'>
                            <div className='previewChrome'>
                                <span className='previewChromeDot' />
                                <span className='previewChromeDot' />
                                <span className='previewChromeDot' />
                                <span className='previewUrlPill'>{preview.url}</span>
                            </div>
                            <iframe
                                className='previewIframe'
                                title='Frontend preview'
                                src={preview.url}
                                sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-modals'
                            />
                        </div>
                    )}
                </div>
            </div>

            {drawerOpen && (
                <aside className='feedbackDrawer' aria-label='UI feedback'>
                    <div className='drawerHeader'>
                        <h2>Request changes</h2>
                        <Button
                            appearance='subtle'
                            icon={<DismissRegular />}
                            aria-label='Close feedback'
                            onClick={() => setDrawerOpen(false)}
                        />
                    </div>
                    <p className='drawerInfo'>Your feedback is sent to Copilot as a prompt. It will revise the frontend (still using mock data) and the preview will hot-reload for re-review.</p>
                    <Textarea
                        className='drawerTextarea'
                        value={draft}
                        onChange={(_e, data) => setDraft(data.value)}
                        placeholder='e.g. Make the header sticky, use a card grid for the dashboard, and add an empty state to the list view.'
                        resize='vertical'
                    />
                    <div className='drawerActions'>
                        <Button appearance='subtle' onClick={() => { setDraft(''); setDrawerOpen(false); }}>Cancel</Button>
                        <Button
                            appearance='primary'
                            icon={<SendRegular />}
                            disabled={draft.trim().length === 0}
                            onClick={handleSubmitFeedback}
                        >
                            Send feedback
                        </Button>
                    </div>
                </aside>
            )}
        </div>
    );
};

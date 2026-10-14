/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Spinner, Tooltip } from '@fluentui/react-components';
import { ChatRegular, DismissRegular, OpenRegular } from '@fluentui/react-icons';
import { WebviewContext } from '@microsoft/vscode-azext-webview/webview';
import { useContext, useEffect, useRef, useState, type JSX } from 'react';
import { userFeedbackFormEmbedUrl } from '../../shared/userFeedbackForm';
import '../styles/userFeedback.scss';

export const UserFeedback = (): JSX.Element => {
    const { vscodeApi } = useContext(WebviewContext);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const triggerButtonRef = useRef<HTMLButtonElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        closeButtonRef.current?.focus();
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            triggerButtonRef.current?.focus();
        };
    }, [open]);

    const close = (): void => {
        setOpen(false);
    };

    return (
        <>
            <Tooltip content='Share feedback about Create with Copilot' relationship='label'>
                <Button
                    ref={triggerButtonRef}
                    className='userFeedbackButton'
                    appearance='secondary'
                    aria-label='Share product feedback'
                    icon={<ChatRegular />}
                    onClick={() => {
                        setLoading(true);
                        setOpen(true);
                    }}
                >
                    Feedback
                </Button>
            </Tooltip>

            {open && (
                <div className='userFeedbackOverlay' onMouseDown={(event) => { if (event.target === event.currentTarget) { close(); } }}>
                    <section className='userFeedbackDialog' role='dialog' aria-modal='true' aria-labelledby='userFeedbackTitle'>
                        <div className='userFeedbackHeader'>
                            <div>
                                <h2 id='userFeedbackTitle'>Share feedback</h2>
                            </div>
                            <div className='userFeedbackHeaderActions'>
                                <Tooltip content='Open the feedback form in your browser' relationship='label'>
                                    <Button
                                        appearance='subtle'
                                        icon={<OpenRegular />}
                                        aria-label='Open feedback form in browser'
                                        onClick={() => vscodeApi.postMessage({ command: 'openUserFeedbackForm' })}
                                    />
                                </Tooltip>
                                <Button
                                    ref={closeButtonRef}
                                    appearance='subtle'
                                    icon={<DismissRegular />}
                                    aria-label='Close product feedback'
                                    onClick={close}
                                />
                            </div>
                        </div>
                        <div className='userFeedbackFrameContainer'>
                            {loading && (
                                <div className='userFeedbackLoading' role='status'>
                                    <Spinner label='Loading Microsoft Forms…' />
                                </div>
                            )}
                            <iframe
                                className='userFeedbackFrame'
                                src={userFeedbackFormEmbedUrl}
                                title='Create with Copilot feedback form'
                                allow='fullscreen'
                                referrerPolicy='no-referrer'
                                onLoad={() => setLoading(false)}
                            />
                        </div>
                        <div className='userFeedbackFooter'>
                            <span>Having trouble using this form? Open it in your browser.</span>
                            <Button
                                appearance='secondary'
                                icon={<OpenRegular />}
                                onClick={() => vscodeApi.postMessage({ command: 'openUserFeedbackForm' })}
                            >
                                Open in browser
                            </Button>
                        </div>
                    </section>
                </div>
            )}
        </>
    );
};

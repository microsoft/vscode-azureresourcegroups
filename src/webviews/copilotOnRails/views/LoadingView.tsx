/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Link, Spinner } from '@fluentui/react-components';
import { CheckmarkCircleFilled, ErrorCircleFilled, QuestionCircleFilled } from '@fluentui/react-icons';
import { WebviewContext, useConfiguration } from '@microsoft/vscode-azext-webview/webview';
import { useContext, useEffect, useState, type JSX } from 'react';
import { StageProgress } from './components/StageProgress';
import './styles/loadingView.scss';
import { type LoadingStep, type LoadingViewConfiguration } from './utils/viewConfigTypes';

/** Delay before showing the "Need help?" */
const NEED_HELP_DELAY_MS = 30_000;

const StepMarker = ({ status }: { status: LoadingStep['status'] }): JSX.Element => {
    switch (status) {
        case 'done':
            return <CheckmarkCircleFilled className='stepMarkerIcon done' />;
        case 'failed':
            return <ErrorCircleFilled className='stepMarkerIcon failed' />;
        case 'active':
            return <Spinner size='extra-tiny' />;
        default:
            return <span className='stepMarkerDot' aria-hidden='true' />;
    }
};

export const LoadingView = (): JSX.Element => {
    const initialConfig = useConfiguration<LoadingViewConfiguration>();
    const [config, setConfig] = useState<LoadingViewConfiguration>(initialConfig);
    const [showNeedHelp, setShowNeedHelp] = useState(false);
    const { vscodeApi } = useContext(WebviewContext);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message?.command === 'updateLoadingState' && message.data) {
                setConfig(message.data as LoadingViewConfiguration);
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    useEffect(() => {
        if (!config.showNeedHelp) {
            setShowNeedHelp(false);
            return;
        }
        const timer = setTimeout(() => setShowNeedHelp(true), NEED_HELP_DELAY_MS);
        return () => clearTimeout(timer);
    }, [config.showNeedHelp]);

    const handleNeedHelp = () => {
        vscodeApi.postMessage({ command: 'needHelp' });
    };

    const handleReportIssue = () => {
        vscodeApi.postMessage({ command: 'reportIssue' });
    };

    const steps = config.steps ?? [];

    return (
        <div className='loadingView' role='status' aria-live='polite' aria-busy={config.awaitingInput ? undefined : true}>
            <StageProgress currentStage={config.stage} />
            <div className='loadingCard'>
                {config.awaitingInput ? (
                    <div className='awaitingInputHeader'>
                        <QuestionCircleFilled className='awaitingInputIcon' />
                        <p className='awaitingInputTitle'>{config.title}</p>
                    </div>
                ) : (
                    <Spinner size='huge' label={config.title} labelPosition='below' />
                )}
                {config.message && (
                    <p className='loadingMessage'>{config.message}</p>
                )}
                {steps.length > 0 && (
                    <ol className='loadingSteps'>
                        {steps.map((step) => (
                            <li key={step.id} className={`loadingStep ${step.status}`} aria-current={step.status === 'active' ? 'step' : undefined}>
                                <span className='stepMarker'>
                                    <StepMarker status={step.status} />
                                </span>
                                <span className='stepText'>
                                    <span className='stepLabel'>
                                        {step.label}
                                        {step.summary && <span className='stepSummary'>{step.summary}</span>}
                                    </span>
                                    {step.children && step.children.length > 0 && (
                                        <ul className='loadingSubSteps'>
                                            {step.children.map((child) => (
                                                <li key={child.id} className={`loadingSubStep ${child.status}`}>
                                                    <span className='stepMarker'>
                                                        <StepMarker status={child.status} />
                                                    </span>
                                                    <span className='stepLabel'>{child.label}</span>
                                                    {child.note && <span className='stepNote' title={child.note}>{child.note}</span>}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ol>
                )}
                {showNeedHelp && (
                    <Link className='needHelpLink' onClick={handleNeedHelp}>
                        Something went wrong? Click here to resume.
                    </Link>
                )}
            </div>
            <div className='loadingFooter'>
                <Button
                    className='reportIssueButton'
                    appearance='secondary'
                    onClick={handleReportIssue}
                >
                    Report an Issue
                </Button>
            </div>
        </div>
    );
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, Spinner } from '@fluentui/react-components';
import { WebviewContext, useConfiguration } from '@microsoft/vscode-azext-webview/webview';
import { useContext, useEffect, useState, type JSX } from 'react';
import { StageProgress } from './components/StageProgress';
import './styles/loadingView.scss';
import { type LoadingViewConfiguration } from './utils/viewConfigTypes';

/** Delay before showing the "Need help?" */
const NEED_HELP_DELAY_MS = 30_000;

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

    return (
        <div className='loadingView' role='status' aria-live='polite' aria-busy='true'>
            <StageProgress currentStage={config.stage} />
            <div className='loadingCard'>
                <Spinner size='huge' label={config.title} labelPosition='below' />
                {config.message && (
                    <p className='loadingMessage'>{config.message}</p>
                )}
                {showNeedHelp && (
                    <Link className='needHelpLink' onClick={handleNeedHelp}>
                        Something went wrong? Click here to resume.
                    </Link>
                )}
            </div>
        </div>
    );
};

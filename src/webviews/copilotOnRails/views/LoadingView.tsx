/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Spinner } from '@fluentui/react-components';
import { useConfiguration } from '@microsoft/vscode-azext-webview/webview';
import { useEffect, useState, type JSX } from 'react';
import { StageProgress } from './components/StageProgress';
import './styles/loadingView.scss';
import { type LoadingViewConfiguration } from './utils/viewConfigTypes';

export const LoadingView = (): JSX.Element => {
    const initialConfig = useConfiguration<LoadingViewConfiguration>();
    const [config, setConfig] = useState<LoadingViewConfiguration>(initialConfig);

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

    return (
        <div className='loadingView' role='status' aria-live='polite' aria-busy='true'>
            <StageProgress currentStage={config.stage} />
            <div className='loadingCard'>
                <Spinner size='huge' label={config.title} labelPosition='below' />
                {config.message && (
                    <p className='loadingMessage'>{config.message}</p>
                )}
            </div>
        </div>
    );
};

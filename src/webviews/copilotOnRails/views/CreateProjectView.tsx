/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Textarea } from '@fluentui/react-components';
import { ClipboardTaskListLtrRegular, RocketRegular } from '@fluentui/react-icons';
import { useConfiguration, WebviewContext } from '@microsoft/vscode-azext-webview/webview';
import * as React from 'react';
import { useContext, useState, type JSX } from 'react';
import './styles/createProjectView.scss';
import { type CreateProjectViewControllerType } from './utils/viewConfigTypes';
import { CreateProjectViewCommands } from './webviewConstants';

export const CreateProjectView = (): JSX.Element => {
    const [prompt, setPrompt] = useState('');
    const { vscodeApi } = useContext(WebviewContext);
    const config = useConfiguration<CreateProjectViewControllerType>();

    const planClicked = () => {
        if (!prompt.trim()) {
            return;
        }
        vscodeApi.postMessage({
            command: CreateProjectViewCommands.Plan,
            prompt: prompt.trim(),
        });
    };

    const buildClicked = () => {
        if (!prompt.trim()) {
            return;
        }
        vscodeApi.postMessage({
            command: CreateProjectViewCommands.Build,
            prompt: prompt.trim(),
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            buildClicked();
        }
    };

    return (
        <div className='createProjectView'>
            <div className='content'>
                <div className='headerSection'>
                    <div className='headerIcon'>
                        <div className='codicon codicon-copilot'></div>
                    </div>
                    <h1>{config.heading}</h1>
                    <p className='subtitle'>
                        {config.subtitle}
                    </p>
                </div>

                <div className='promptCard'>
                    <Textarea
                        className='promptInput'
                        placeholder={config.promptPlaceholder}
                        value={prompt}
                        onChange={(_e, data) => setPrompt(data.value)}
                        onKeyDown={handleKeyDown}
                        rows={6}
                        resize='vertical'
                    />
                    <div className='promptActions'>
                        <span className='hint'>{config.hint}</span>
                        <div className='buttonGroup'>
                            <Button
                                appearance='secondary'
                                onClick={planClicked}
                                disabled={!prompt.trim()}
                                icon={<ClipboardTaskListLtrRegular />}
                            >
                                {config.planButtonLabel}
                            </Button>
                            <Button
                                appearance='primary'
                                onClick={buildClicked}
                                disabled={!prompt.trim()}
                                icon={<RocketRegular />}
                            >
                                {config.buildButtonLabel}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

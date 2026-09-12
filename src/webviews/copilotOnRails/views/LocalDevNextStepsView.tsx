/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useConfiguration, WebviewContext } from '@microsoft/vscode-azext-webview/webview';
import { useContext, type JSX } from 'react';
import { StageProgress } from './components/StageProgress';
import './styles/nextStepsView.scss';
import { type LocalDevNextStepsViewConfiguration } from './utils/viewConfigTypes';

type ActionId = 'iterate' | 'apiTests' | 'deploy';

type ActionCardProps = {
    id: ActionId;
    icon: string;
    title: string;
    description: string;
    onSelect: (id: ActionId) => void;
};

const ActionCard = ({ id, icon, title, description, onSelect }: ActionCardProps): JSX.Element => (
    <button className='nextStepCard' type='button' onClick={() => onSelect(id)}>
        <div className='nextStepCardIcon'>
            <span className={`codicon codicon-${icon}`}></span>
        </div>
        <div className='nextStepCardBody'>
            <h2>{title}</h2>
            <p>{description}</p>
        </div>
        <div className='nextStepCardChevron'>
            <span className='codicon codicon-chevron-right'></span>
        </div>
    </button>
);

export const LocalDevNextStepsView = (): JSX.Element => {
    const config = useConfiguration<LocalDevNextStepsViewConfiguration>();
    const { vscodeApi } = useContext(WebviewContext);

    const handleSelect = (action: ActionId) => {
        vscodeApi.postMessage({ command: 'nextStepSelected', action });
    };

    return (
        <div className='nextStepsView'>
            <StageProgress currentStage={1} />
            <div className='nextStepsContent'>
                <header className='nextStepsHeader'>
                    <h1>Your local development environment is ready. What would you like to do next?</h1>
                </header>

                <div className='nextStepsCards'>
                    <ActionCard
                        id='iterate'
                        icon='debug-alt'
                        title='Keep iterating — start debugging and improve my code'
                        description='Press F5 to launch your app, set breakpoints, and ask Copilot to help you refine features or fix bugs.'
                        onSelect={handleSelect}
                    />

                    {config.hasApiTests && (
                        <ActionCard
                            id='apiTests'
                            icon='beaker'
                            title='Run API tests to verify my endpoints'
                            description='Execute the generated API test collection against your running app and surface any failures.'
                            onSelect={handleSelect}
                        />
                    )}

                    <ActionCard
                        id='deploy'
                        icon='cloud-upload'
                        title='Deploy to Azure'
                        description='Prepare deployment artifacts (infrastructure, azure.yaml, Dockerfiles) and ship the project to Azure.'
                        onSelect={handleSelect}
                    />
                </div>
            </div>
        </div>
    );
};

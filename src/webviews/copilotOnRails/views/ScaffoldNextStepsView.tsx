/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewContext } from '@microsoft/vscode-azext-webview/webview';
import { useContext, type JSX } from 'react';
import { StageProgress } from './components/StageProgress';
import './styles/nextStepsView.scss';

type ActionId = 'setupLocal' | 'verifyCode' | 'deploy';

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

export const ScaffoldNextStepsView = (): JSX.Element => {
    const { vscodeApi } = useContext(WebviewContext);

    const handleSelect = (action: ActionId) => {
        vscodeApi.postMessage({ command: 'scaffoldNextStepSelected', action });
    };

    return (
        <div className='nextStepsView'>
            <StageProgress currentStage={0} />
            <div className='nextStepsContent'>
                <header className='nextStepsHeader'>
                    <h1>Your project has been scaffolded. What would you like to do next?</h1>
                </header>

                <div className='nextStepsCards'>
                    <ActionCard
                        id='setupLocal'
                        icon='terminal'
                        title='Set up local development'
                        description='Configure your VS Code debugging environment, emulators, and launch configurations for local testing.'
                        onSelect={handleSelect}
                    />

                    <ActionCard
                        id='verifyCode'
                        icon='check-all'
                        title='Verify code'
                        description='Run build checks, linters, and unit tests to ensure your project is ready for development.'
                        onSelect={handleSelect}
                    />

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

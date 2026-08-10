/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Textarea } from '@fluentui/react-components';
import { ClipboardTaskListLtrRegular } from '@fluentui/react-icons';
import { useConfiguration, WebviewContext } from '@microsoft/vscode-azext-webview/webview';
import * as React from 'react';
import { useContext, useLayoutEffect, useRef, useState, type JSX } from 'react';
import './styles/createProjectView.scss';
import { type CreateProjectViewControllerType } from './utils/viewConfigTypes';

export const CreateProjectView = (): JSX.Element => {
    const [prompt, setPrompt] = useState('');
    const { vscodeApi } = useContext(WebviewContext);
    const config = useConfiguration<CreateProjectViewControllerType>();
    const [selectedModel, setSelectedModel] = useState(config.modelOptions[0] ?? '');

    const recentPrompts = config.recentPrompts ?? [];
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // -1 means editing the live draft rather than navigating history.
    const historyIndexRef = useRef(-1);
    const draftRef = useRef('');
    const caretToEndRef = useRef(false);

    useLayoutEffect(() => {
        if (caretToEndRef.current) {
            caretToEndRef.current = false;
            const el = textareaRef.current;
            if (el) {
                const end = el.value.length;
                el.setSelectionRange(end, end);
            }
        }
    }, [prompt]);

    const displayName = (model: string) => model.replace(/\s*\(copilot\)\s*$/i, '');

    const planClicked = () => {
        if (!prompt.trim()) {
            return;
        }
        vscodeApi.postMessage({
            command: 'plan',
            prompt: prompt.trim(),
            model: selectedModel,
        });
    };

    const navigateToOlder = (): boolean => {
        if (historyIndexRef.current >= recentPrompts.length - 1) {
            return false;
        }
        if (historyIndexRef.current === -1) {
            draftRef.current = prompt;
        }
        const newIndex = historyIndexRef.current + 1;
        historyIndexRef.current = newIndex;
        caretToEndRef.current = true;
        setPrompt(recentPrompts[newIndex]);
        return true;
    };

    const navigateToNewer = (): boolean => {
        if (historyIndexRef.current < 0) {
            return false;
        }
        const newIndex = historyIndexRef.current - 1;
        historyIndexRef.current = newIndex;
        caretToEndRef.current = true;
        setPrompt(newIndex < 0 ? draftRef.current : recentPrompts[newIndex]);
        return true;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            planClicked();
            return;
        }

        if (recentPrompts.length === 0) {
            return;
        }

        const el = e.currentTarget;
        if (e.key === 'ArrowUp') {
            // Only navigate history at the caret's start, so multi-line caret movement is unaffected.
            if (el.selectionStart === 0 && el.selectionEnd === 0 && navigateToOlder()) {
                e.preventDefault();
            }
        } else if (e.key === 'ArrowDown') {
            // Only step to a newer entry while navigating and at the caret's end.
            if (historyIndexRef.current >= 0 && el.selectionStart === el.value.length && navigateToNewer()) {
                e.preventDefault();
            }
        }
    };

    // A user edit starts a fresh draft. Fluent's onChange only fires on genuine input,
    // not programmatic value changes, so this never runs during navigation.
    const handleChange = (value: string) => {
        historyIndexRef.current = -1;
        setPrompt(value);
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
                        ref={textareaRef}
                        className='promptInput'
                        placeholder={config.promptPlaceholder}
                        value={prompt}
                        onChange={(_e, data) => handleChange(data.value)}
                        onKeyDown={handleKeyDown}
                        rows={6}
                        resize='vertical'
                    />
                    <div className='promptActions'>
                        <div className='actionsLeft'>
                            <select
                                className='modelDropdown'
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                            >
                                {config.modelOptions.map((model) => (
                                    <option key={model} value={model}>{displayName(model)}</option>
                                ))}
                            </select>
                            <span className='hint'>{config.hint}</span>
                        </div>
                        <div className='buttonGroup'>
                            <Button
                                appearance='primary'
                                onClick={planClicked}
                                disabled={!prompt.trim()}
                                icon={<ClipboardTaskListLtrRegular />}
                            >
                                {config.planButtonLabel}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

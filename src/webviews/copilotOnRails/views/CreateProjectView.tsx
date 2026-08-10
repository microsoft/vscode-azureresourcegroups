/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Textarea } from "@fluentui/react-components";
import { ClipboardTaskListLtrRegular } from "@fluentui/react-icons";
import {
    useConfiguration,
    WebviewContext,
} from "@microsoft/vscode-azext-webview/webview";
import * as React from "react";
import { useContext, useLayoutEffect, useRef, useState, type JSX } from "react";
import "./styles/createProjectView.scss";
import { type CreateProjectViewControllerType } from "./utils/viewConfigTypes";

export const CreateProjectView = (): JSX.Element => {
    const [prompt, setPrompt] = useState("");
    const { vscodeApi } = useContext(WebviewContext);
    const config = useConfiguration<CreateProjectViewControllerType>();
    const [selectedModel, setSelectedModel] = useState(
        config.modelOptions[0] ?? "",
    );

    const recentPrompts = config.recentPrompts ?? [];
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // -1 means editing the live draft rather than navigating history.
    const historyIndexRef = useRef(-1);
    const draftRef = useRef("");
    // After navigating history, park the caret on the edge matching the travel direction
    // (front when going to older, end when going to newer) so continued presses in the same
    // direction stay on the first/last line and keep cycling without an extra keystroke.
    // This behavior mirrors VS Code's Copilot Chat.
    const caretTargetRef = useRef<"start" | "end" | null>(null);

    useLayoutEffect(() => {
        if (caretTargetRef.current) {
            const target = caretTargetRef.current;
            caretTargetRef.current = null;
            const el = textareaRef.current;
            if (el) {
                const pos = target === "start" ? 0 : el.value.length;
                el.setSelectionRange(pos, pos);
            }
        }
    }, [prompt]);

    const displayName = (model: string) =>
        model.replace(/\s*\(copilot\)\s*$/i, "");

    const planClicked = () => {
        if (!prompt.trim()) {
            return;
        }
        vscodeApi.postMessage({
            command: "plan",
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
        // Older entries land at the front so the next ArrowUp is still on the first line.
        caretTargetRef.current = "start";
        setPrompt(recentPrompts[newIndex]);
        return true;
    };

    const navigateToNewer = (): boolean => {
        if (historyIndexRef.current < 0) {
            return false;
        }
        const newIndex = historyIndexRef.current - 1;
        historyIndexRef.current = newIndex;
        // Newer entries land at the end so the next ArrowDown is still on the last line.
        caretTargetRef.current = "end";
        setPrompt(newIndex < 0 ? draftRef.current : recentPrompts[newIndex]);
        return true;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            planClicked();
            return;
        }

        if (recentPrompts.length === 0) {
            return;
        }

        const el = e.currentTarget;
        const hasSelection = el.selectionStart !== el.selectionEnd;
        if (e.key === "ArrowUp") {
            // Only navigate history from the first line, so multi-line caret movement is unaffected.
            const onFirstLine = !el.value
                .slice(0, el.selectionStart)
                .includes("\n");
            if (!hasSelection && onFirstLine && navigateToOlder()) {
                e.preventDefault();
            }
        } else if (e.key === "ArrowDown") {
            // Only step to a newer entry while navigating and from the last line.
            const onLastLine = !el.value.slice(el.selectionEnd).includes("\n");
            if (
                !hasSelection &&
                historyIndexRef.current >= 0 &&
                onLastLine &&
                navigateToNewer()
            ) {
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
        <div className="createProjectView">
            <div className="content">
                <div className="headerSection">
                    <div className="headerIcon">
                        <div className="codicon codicon-copilot"></div>
                    </div>
                    <h1>{config.heading}</h1>
                    <p className="subtitle">{config.subtitle}</p>
                </div>

                <div className="promptCard">
                    <Textarea
                        ref={textareaRef}
                        className="promptInput"
                        placeholder={config.promptPlaceholder}
                        value={prompt}
                        onChange={(_e, data) => handleChange(data.value)}
                        onKeyDown={handleKeyDown}
                        rows={6}
                        resize="vertical"
                    />
                    <div className="promptActions">
                        <div className="actionsLeft">
                            <select
                                className="modelDropdown"
                                value={selectedModel}
                                onChange={(e) =>
                                    setSelectedModel(e.target.value)
                                }
                            >
                                {config.modelOptions.map((model) => (
                                    <option key={model} value={model}>
                                        {displayName(model)}
                                    </option>
                                ))}
                            </select>
                            <span className="hint">{config.hint}</span>
                        </div>
                        <div className="buttonGroup">
                            <Button
                                appearance="primary"
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

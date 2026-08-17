const vscode = require('vscode');
const fs = require('fs');

const resultPrefix = 'COR_VSCODE_PARITY_RESULT=';

exports.run = async function run() {
    const configurationName = requiredEnv('COR_PARITY_CONFIGURATION');
    const sourceGlob = requiredEnv('COR_PARITY_SOURCE_GLOB');
    const lineIncludes = requiredEnv('COR_PARITY_LINE_INCLUDES');
    const triggerUrl = requiredEnv('COR_PARITY_TRIGGER_URL');
    const timeoutMs = Number(process.env.COR_PARITY_TIMEOUT_MS || 120000);
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        throw new Error('VS Code parity requires an open generated-project workspace.');
    }

    const files = await vscode.workspace.findFiles(sourceGlob, '**/{node_modules,dist,out}/**', 2);
    if (files.length !== 1) {
        throw new Error(`Expected one breakpoint source for ${sourceGlob}; found ${files.length}.`);
    }
    const document = await vscode.workspace.openTextDocument(files[0]);
    const line = [...Array(document.lineCount).keys()]
        .find(index => document.lineAt(index).text.includes(lineIncludes));
    if (line === undefined) {
        throw new Error(`Breakpoint source does not contain "${lineIncludes}".`);
    }
    const column = document.lineAt(line).text.indexOf(lineIncludes);

    const breakpoint = new vscode.SourceBreakpoint(
        new vscode.Location(files[0], new vscode.Position(line, column)),
        true,
    );
    vscode.debug.addBreakpoints([breakpoint]);

    const sessions = [];
    const dapMessages = [];
    const taskEvents = [];
    const triggerEvidence = { attempts: 0, statuses: [], lastError: undefined };
    let started = false;
    let stoppedEvent;
    let resolveStopped;
    const stopped = new Promise(resolve => {
        resolveStopped = resolve;
    });
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {
        createDebugAdapterTracker(session) {
            sessions.push({ id: session.id, name: session.name, type: session.type });
            return {
                onWillReceiveMessage(message) {
                    if (message?.type === 'request' && ['attach', 'launch', 'setBreakpoints', 'configurationDone'].includes(message.command)) {
                        dapMessages.push({ direction: 'request', command: message.command });
                    }
                },
                onDidSendMessage(message) {
                    if (message?.type === 'event' && message.event === 'stopped') {
                        stoppedEvent = message.body;
                        resolveStopped();
                    }
                    if (
                        (message?.type === 'event' && ['initialized', 'breakpoint', 'output', 'terminated'].includes(message.event))
                        || (message?.type === 'response' && ['attach', 'launch', 'setBreakpoints', 'configurationDone'].includes(message.command))
                    ) {
                        dapMessages.push({
                            direction: 'response',
                            type: message.type,
                            command: message.command,
                            event: message.event,
                            success: message.success,
                            body: message.event === 'output'
                                ? { category: message.body?.category, output: String(message.body?.output || '').slice(0, 500) }
                                : message.body,
                        });
                    }
                },
            };
        },
    });
    const taskListeners = [
        vscode.tasks.onDidStartTask(event => taskEvents.push(taskEvent('started', event.execution))),
        vscode.tasks.onDidStartTaskProcess(event => taskEvents.push({ ...taskEvent('process-started', event.execution), processId: event.processId })),
        vscode.tasks.onDidEndTaskProcess(event => taskEvents.push({ ...taskEvent('process-ended', event.execution), exitCode: event.exitCode })),
        vscode.tasks.onDidEndTask(event => taskEvents.push(taskEvent('ended', event.execution))),
    ];

    try {
        started = await Promise.race([
            vscode.debug.startDebugging(folder, configurationName),
            delay(timeoutMs).then(() => {
                throw new Error(`Timed out starting debug configuration after ${timeoutMs}ms.`);
            }),
        ]);
        if (!started) {
            throw new Error(`VS Code rejected debug configuration "${configurationName}".`);
        }
        const trigger = triggerUntilStopped(triggerUrl, stopped, timeoutMs, triggerEvidence);
        await Promise.race([
            stopped,
            delay(timeoutMs).then(() => {
                throw new Error(`Timed out waiting for a breakpoint after ${timeoutMs}ms.`);
            }),
        ]);
        const activeSession = vscode.debug.activeDebugSession;
        if (!activeSession || !stoppedEvent?.threadId) {
            throw new Error('The debugger stopped without an active session and thread id.');
        }
        await activeSession.customRequest('continue', { threadId: stoppedEvent.threadId });
        await trigger;
        emitResult({
            outcome: 'passed',
            configurationName,
            source: vscode.workspace.asRelativePath(files[0]),
            line: line + 1,
            column: column + 1,
            sessions,
            stoppedReason: stoppedEvent?.reason,
            hitBreakpointIds: stoppedEvent?.hitBreakpointIds || [],
        });
    } catch (error) {
        emitResult({
            outcome: 'failed',
            error: error instanceof Error ? error.message : String(error),
            configurationName,
            source: vscode.workspace.asRelativePath(files[0]),
            line: line + 1,
            column: column + 1,
            started,
            sessions,
            stoppedReason: stoppedEvent?.reason,
            hitBreakpointIds: stoppedEvent?.hitBreakpointIds || [],
            dapMessages: dapMessages.slice(-50),
            taskEvents: taskEvents.slice(-50),
            triggerEvidence,
            activeDebugSession: vscode.debug.activeDebugSession
                ? {
                    id: vscode.debug.activeDebugSession.id,
                    name: vscode.debug.activeDebugSession.name,
                    type: vscode.debug.activeDebugSession.type,
                }
                : undefined,
            terminals: vscode.window.terminals.map(terminal => terminal.name),
        });
        throw error;
    } finally {
        tracker.dispose();
        taskListeners.forEach(listener => listener.dispose());
        vscode.debug.removeBreakpoints([breakpoint]);
        await vscode.debug.stopDebugging();
        vscode.tasks.taskExecutions.forEach(execution => execution.terminate());
    }
};

async function triggerUntilStopped(url, stopped, timeoutMs, evidence) {
    const deadline = Date.now() + timeoutMs;
    let completed = false;
    stopped.then(() => {
        completed = true;
    });
    while (!completed && Date.now() < deadline) {
        try {
            evidence.attempts += 1;
            const response = await fetch(url);
            evidence.statuses.push(response.status);
            if (evidence.statuses.length > 20) {
                evidence.statuses.shift();
            }
        } catch (error) {
            // The preLaunch task may still be starting.
            evidence.lastError = error instanceof Error ? error.message : String(error);
        }
        if (!completed) {
            await delay(1000);
        }
    }
}

function emitResult(result) {
    const value = JSON.stringify(result);
    fs.writeFileSync(requiredEnv('COR_PARITY_RESULT_PATH'), value);
    console.log(resultPrefix + value);
}

function taskEvent(state, execution) {
    return {
        state,
        name: execution.task.name,
        source: execution.task.source,
        type: execution.task.definition?.type,
    };
}

function requiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is required.`);
    }
    return value;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

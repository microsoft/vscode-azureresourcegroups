/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LoopbackListener, LoopbackOptions } from './loopbackTypes';

interface LoopbackPrototypeLifecycleOptions extends LoopbackOptions {
    isEligible: () => boolean;
    onChanged: () => void;
    onStarted: () => void;
    onInfo: (message: string) => void;
    onFailure: () => void;
}

export class LoopbackPrototypeLifecycle {
    private activeListener: LoopbackListener | undefined;
    private disposed = false;
    private stopped = false;
    private generation = 0;
    private starting: Promise<void> | undefined;

    public constructor(private readonly options: LoopbackPrototypeLifecycleOptions) { }

    public get listener(): LoopbackListener | undefined {
        return this.activeListener;
    }

    public async start(): Promise<void> {
        if (this.starting) {
            await this.starting;
            return this.start();
        }
        if (this.disposed || this.stopped || !this.options.isEligible() || this.activeListener) {
            return;
        }

        const startGeneration = this.generation;
        this.starting = this.startListener(startGeneration);
        try {
            await this.starting;
        } finally {
            this.starting = undefined;
        }
    }

    public async restart(): Promise<void> {
        await this.stop();
        await this.start();
    }

    public async enable(): Promise<void> {
        this.stopped = false;
        await this.start();
    }

    public async disable(): Promise<void> {
        this.stopped = true;
        await this.stop();
    }

    public async stop(): Promise<void> {
        this.generation++;
        const listener = this.activeListener;
        this.activeListener = undefined;
        await listener?.dispose();
    }

    public async dispose(): Promise<void> {
        this.disposed = true;
        await this.stop();
    }

    private async startListener(startGeneration: number): Promise<void> {
        const { startLoopbackServer } = await import('./loopbackServer.js');
        if (!this.canPublish(startGeneration)) {
            return;
        }

        const listener = await startLoopbackServer({
            id: this.options.id,
            version: this.options.version,
            registerTools: this.options.registerTools,
            onError: this.options.onError,
            onDispose: () => this.listenerDisposed(listener),
        });
        if (!this.canPublish(startGeneration)) {
            await listener.dispose();
            return;
        }

        this.activeListener = listener;
        this.options.onChanged();
        this.options.onStarted();
    }

    private canPublish(startGeneration: number): boolean {
        return !this.disposed
            && !this.stopped
            && this.options.isEligible()
            && startGeneration === this.generation;
    }

    private listenerDisposed(listener: LoopbackListener): void {
        const expired = this.activeListener === listener;
        if (expired) {
            this.activeListener = undefined;
        }
        if (!this.disposed) {
            this.options.onChanged();
            this.options.onInfo('Prototype credential revoked and listener stopped');
        }
        if (expired) {
            const renewalGeneration = this.generation;
            void Promise.resolve().then(async () => {
                await listener.dispose();
                if (renewalGeneration === this.generation) {
                    await this.start();
                }
            }).catch(this.options.onFailure);
        }
    }
}

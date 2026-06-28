/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Source: https://github.com/microsoft/vscode-containers/blob/main/src/utils/lazy.ts
export class Lazy<T> {
    private _isValueCreated: boolean = false;
    private _value: T | undefined;

    public constructor(private readonly valueFactory: () => T, private _valueLifetime?: number) {
    }

    public get isValueCreated(): boolean {
        return this._isValueCreated;
    }

    public cacheForever(): void {
        this._valueLifetime = undefined;
    }

    public clear(): void {
        this._isValueCreated = false;
    }

    public get value(): T {
        if (this._isValueCreated) {
            return this._value as T;
        }

        this._value = this.valueFactory();
        this._isValueCreated = true;

        if (this._valueLifetime) {
            const reset = setTimeout(() => {
                // If caller cleared the valueLifeTime, then continue to use the cached value.
                if (this._valueLifetime) {
                    this._isValueCreated = false;
                    this._value = undefined;
                }
                clearTimeout(reset);
            }, this._valueLifetime);
        }

        return this._value;
    }
}

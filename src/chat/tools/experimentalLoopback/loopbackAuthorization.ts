/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes, timingSafeEqual } from 'node:crypto';

export class LoopbackAuthorization {
    private readonly credential = Buffer.from(`Nonce ${randomBytes(32).toString('base64url')}`);
    private revoked = false;

    public get header(): string {
        return this.credential.toString();
    }

    public get isAuthorized(): boolean {
        return !this.revoked;
    }

    public matches(value: string | undefined): boolean {
        const supplied = Buffer.from(value ?? '');
        return this.isAuthorized
            && supplied.length === this.credential.length
            && timingSafeEqual(supplied, this.credential);
    }

    public revoke(): void {
        this.revoked = true;
        this.credential.fill(0);
    }
}

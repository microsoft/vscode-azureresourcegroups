/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from "crypto";
import { maskValue } from "../utils/maskValue";
import { AzExtCredentialManager } from "./AzExtCredentialManager";

export class AzExtSignatureCredentialManager implements AzExtCredentialManager<string> {
    private readonly _algorithm: string = 'RSA-SHA256';
    private readonly _signatureFormat: crypto.BinaryToTextEncoding = 'base64';

    private _publicKey: string;
    private _privateKey: string;

    constructor() {
        const { publicKey, privateKey } = this.generateExtensionPublicAndPrivateKeys();
        this._publicKey = publicKey;
        this._privateKey = privateKey;
    }

    createCredential(payload: string): string {
        return this.createSignature(this._privateKey, payload);
    }

    verifyCredential(signature: string, payload: string): { verified: boolean, payload: string | undefined } {
        const verified: boolean = this.verifySignature(this._publicKey, payload, signature);
        return { verified, payload: verified ? payload : undefined };
    }

    maskCredentials(data: string): string {
        for (const mask of [this._publicKey, this._privateKey]) {
            data = maskValue(data, mask);
        }
        return data;
    }

    private generateExtensionPublicAndPrivateKeys(): crypto.KeyPairSyncResult<string, string> {
        return crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
    }

    private createSignature(privateKey: string, data: string): string {
        const sign = crypto.createSign(this._algorithm)
            .update(data)
            .end();
        return sign.sign(privateKey, this._signatureFormat);
    }

    private verifySignature(publicKey: string, data: string, signature: string): boolean {
        const verify = crypto.createVerify(this._algorithm)
            .update(data)
            .end();
        return verify.verify(publicKey, signature, this._signatureFormat);
    }
}

/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtCredentialManager } from "../../../api/src/auth/credentialManager/AzExtCredentialManager";
import { maskValue } from "../../../api/src/utils/maskValue";

/**
 * A mock credential manager with the same implementation as `AzExtUUIDCredentialManager`,
 * but with a public getter to inspect the UUIDs during test.
 */
export class MockUUIDCredentialManager implements AzExtCredentialManager {
    #uuidMap: Map<string, string> = new Map();

    get uuidMap() {
        return this.#uuidMap;
    }

    createCredential(extensionId: string): string {
        const uuid: string = crypto.randomUUID();
        this.#uuidMap.set(extensionId, uuid);
        return uuid;
    }

    verifyCredential(credential: string, extensionId: string): boolean {
        if (!credential || !extensionId) {
            return false;
        }
        return credential === this.#uuidMap.get(extensionId);
    }

    maskCredentials(data: string): string {
        for (const uuid of this.#uuidMap.values()) {
            data = maskValue(data, uuid);
        }
        return data;
    }
}

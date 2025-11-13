/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from "crypto";
import { maskValue } from "../../utils/maskValue";
import { AzExtCredentialManager } from "./AzExtCredentialManager";

/**
 * A simple, light-weight credential manager that issues and tracks randomly generated UUIDs for extension verification.
 */
export class AzExtUUIDCredentialManager implements AzExtCredentialManager {
    #uuidMap: Map<string, string> = new Map();

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

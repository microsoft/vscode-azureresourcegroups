/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtUUIDCredentialManager } from "../../../extension.bundle";

export class MockUUIDCredentialManager extends AzExtUUIDCredentialManager {
    // This value is normally protected, so we should add a getter so we have a way to monitor the values during tests
    get uuidMap() {
        return this._uuidMap;
    }
}

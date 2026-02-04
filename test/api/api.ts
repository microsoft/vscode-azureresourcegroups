/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureResourcesHostApiInternal } from "../../src/hostapi.v2.internal";
import { getCachedTestApi } from "../utils/testApiAccess";

export const api = (): AzureResourcesHostApiInternal => {
    // Get the cached test API (must be initialized in test setup)
    const testApi = getCachedTestApi();
    return testApi.getApi().resources;
};

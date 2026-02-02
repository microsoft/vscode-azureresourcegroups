import { AzureResourcesHostApiInternal } from "../../src/hostapi.v2.internal";
import { getCachedTestApi } from "../utils/testApiAccess";

export const api = (): AzureResourcesHostApiInternal => {
    // Get the cached test API (must be initialized in test setup)
    const testApi = getCachedTestApi();
    return testApi.getApi().resources;
};

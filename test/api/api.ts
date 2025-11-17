import { ext } from "../../src/extensionVariables";
import { AzureResourcesHostApiInternal } from "../../src/hostapi.v2.internal";

export const api = (): AzureResourcesHostApiInternal => ext.v2.api.resources;

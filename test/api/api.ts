import { ext } from "../../extension.bundle";
import { AzureResourcesHostApiInternal } from "../../hostapi.v2.internal";

export const api = (): AzureResourcesHostApiInternal => ext.v2.api.resources;

import { AzureResourcesHostApiInternal, ext } from "../../extension.bundle";

export const api = (): AzureResourcesHostApiInternal => ext.v2.api.resources;

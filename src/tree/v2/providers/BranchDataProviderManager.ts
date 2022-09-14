import { ApplicationResource, BranchDataProvider, ResourceModelBase } from "../../../api/v2/v2AzureResourcesApi";
import { ResourceBranchDataProviderManagerBase } from '../ResourceBranchDataProviderManagerBase';

export class BranchDataProviderManager extends ResourceBranchDataProviderManagerBase<BranchDataProvider<ApplicationResource, ResourceModelBase>>{
    constructor(
        defaultProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>,
        extensionActivator: (type: string) => void
    ) {
        super(
            defaultProvider,
            extensionActivator);
    }
}

export type BranchDataProviderFactory = (resource: ApplicationResource) => BranchDataProvider<ApplicationResource, ResourceModelBase>;


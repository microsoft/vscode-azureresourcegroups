import { BranchDataProvider, ResourceModelBase, WorkspaceResource } from '../../../api/v2/v2AzureResourcesApi';
import { ResourceBranchDataProviderManagerBase } from '../ResourceBranchDataProviderManagerBase';

export class WorkspaceResourceBranchDataProviderManager extends ResourceBranchDataProviderManagerBase<BranchDataProvider<WorkspaceResource, ResourceModelBase>> {
    constructor(
        defaultProvider: BranchDataProvider<WorkspaceResource, ResourceModelBase>,
        extensionActivator: (type: string) => void
    ) {
        super(
            defaultProvider,
            extensionActivator);
    }
}

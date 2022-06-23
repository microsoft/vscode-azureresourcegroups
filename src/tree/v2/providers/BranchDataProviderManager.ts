import { ApplicationResource, BranchDataProvider, ResourceModelBase } from "../../../api/v2/v2AzureResourcesApi";

export class BranchDataProviderManager {
    private readonly applicationResourceBranchDataProviders: { [key: string]: BranchDataProvider<ApplicationResource, ResourceModelBase> } = {};

    constructor(private readonly defaultBranchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>) {
    }

    addApplicationResourceBranchDataProvider(type: string, applicationResourceBranchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>): void {
        this.applicationResourceBranchDataProviders[type] = applicationResourceBranchDataProvider;
    }

    getApplicationResourceBranchDataProvider(resource: ApplicationResource): BranchDataProvider<ApplicationResource, ResourceModelBase> {
        return this.applicationResourceBranchDataProviders[resource.type] ?? this.defaultBranchDataProvider;
    }

    removeApplicationResourceBranchDataProvider(type: string): void {
        delete this.applicationResourceBranchDataProviders[type];
    }
}

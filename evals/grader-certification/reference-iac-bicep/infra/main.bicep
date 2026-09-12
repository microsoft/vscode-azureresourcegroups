// The golden case for the `iac-compiles` gate: infrastructure that compiles cleanly under
// `az bicep build`, with every resource type and API version one the pinned compiler can
// actually resolve.
//
// Kept deliberately small. This fixture exists to pin the *validator's* decisions, not to be
// a realistic deployment, and every resource added here is another API version that can age
// out from under certification and turn a green gate red for a reason unrelated to the gate.
targetScope = 'resourceGroup'

@description('Prefix applied to every resource name so a run cannot collide with another.')
param environmentName string

@description('Location for all resources; defaults to the resource group location.')
param location string = resourceGroup().location

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${environmentName}-environment'
  location: location
  properties: {}
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${environmentName}-identity'
  location: location
}

output AZURE_CONTAINER_APPS_ENVIRONMENT_ID string = managedEnvironment.id
output AZURE_CLIENT_ID string = identity.properties.clientId

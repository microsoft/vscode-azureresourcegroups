targetScope = 'resourceGroup'

param environmentName string
param location string = resourceGroup().location

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${environmentName}-environment'
  location: location
  properties: {}
}

output AZURE_CONTAINER_APPS_ENVIRONMENT_ID string = environment.id

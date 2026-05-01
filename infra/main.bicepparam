using 'main.bicep'

param environmentName = 'staging'
param location = 'australiaeast'
param tenantId = 'f9000183-4662-4fb4-b185-74db57f62a20'
param adminObjectId = '591220c5-1196-4fe9-b36e-be7d8c22b7c2'
param tags = {
  product: 'easyazure'
  environment: 'staging'
  managedBy: 'bicep'
  costCenter: 'platform'
}

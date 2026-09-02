[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

foreach ($command in @('az', 'azd', 'node', 'npm')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command '$command' was not found. See README.md deployment prerequisites."
    }
}

& az account show --output none 2>$null
if ($LASTEXITCODE -ne 0) {
    & az login
    if ($LASTEXITCODE -ne 0) { throw 'Azure CLI sign-in failed.' }
}

& azd auth login --check-status --no-prompt *> $null
if ($LASTEXITCODE -ne 0) {
    & azd auth login
    if ($LASTEXITCODE -ne 0) { throw 'Azure Developer CLI sign-in failed.' }
}

& azd env get-value AZURE_ENV_NAME *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Create an EasyAzure deployment environment.' -ForegroundColor Cyan
    & azd env new
    if ($LASTEXITCODE -ne 0) { throw 'Azure Developer CLI environment setup failed.' }
}

Write-Host 'Creating or updating the Microsoft Entra application...' -ForegroundColor Cyan
& node ./scripts/deployment/entra.mjs
if ($LASTEXITCODE -ne 0) { throw 'Microsoft Entra application setup failed.' }

Write-Host 'Previewing Azure infrastructure changes...' -ForegroundColor Cyan
& azd provision --preview
if ($LASTEXITCODE -ne 0) { throw 'Azure infrastructure preview failed. No deployment was started.' }

Write-Host 'Provisioning and deploying EasyAzure...' -ForegroundColor Cyan
& azd up
if ($LASTEXITCODE -ne 0) { throw 'EasyAzure deployment failed.' }

Write-Host 'EasyAzure deployment completed.' -ForegroundColor Green
& azd env get-values
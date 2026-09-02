#!/usr/bin/env sh
set -eu

for command in az azd node npm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command '$command' was not found. See README.md deployment prerequisites." >&2
    exit 1
  fi
done

if ! az account show --output none >/dev/null 2>&1; then
  az login
fi

if ! azd auth login --check-status --no-prompt >/dev/null 2>&1; then
  azd auth login
fi

if ! azd env get-value AZURE_ENV_NAME >/dev/null 2>&1; then
  echo 'Create an EasyAzure deployment environment.'
  azd env new
fi

echo 'Creating or updating the Microsoft Entra application...'
node ./scripts/deployment/entra.mjs

echo 'Previewing Azure infrastructure changes...'
azd provision --preview

echo 'Provisioning and deploying EasyAzure...'
azd up

echo 'EasyAzure deployment completed.'
azd env get-values
#!/usr/bin/env bash
# Chooses the Azure OpenAI deployment used for design import.
#
# Usage: select-design-import-model.sh <openai-resource-id> [explicit-deployment-name]
# Prints two lines: the deployment name (empty = fall back to the default
# deployment) and "true"/"false"/"" for whether it is a reasoning model.
set -euo pipefail

resource_id="${1:-}"
explicit="${2:-}"

if [ -n "$explicit" ]; then
  printf '%s\n\n' "$explicit"
  exit 0
fi
if [ -z "$resource_id" ]; then
  printf '\n\n'
  exit 0
fi

resource_group=$(cut -d/ -f5 <<<"$resource_id")
account=${resource_id##*/}
deployments=$(az cognitiveservices account deployment list \
  --resource-group "$resource_group" --name "$account" \
  --query "[?properties.provisioningState=='Succeeded'].[name, properties.model.name]" \
  --output tsv 2>/dev/null || true)

# Strongest vision + structured-output models first.
for model in gpt-5.1 gpt-5 gpt-4.1 gpt-5-mini gpt-4o; do
  name=$(awk -v m="$model" -F'\t' '$2 == m { print $1; exit }' <<<"$deployments")
  if [ -n "$name" ]; then
    case "$model" in
      gpt-5*) reasoning=true ;;
      *) reasoning=false ;;
    esac
    printf '%s\n%s\n' "$name" "$reasoning"
    exit 0
  fi
done

printf '\n\n'

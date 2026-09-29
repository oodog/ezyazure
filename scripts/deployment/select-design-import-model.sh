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

# Rank vision + structured-output capable models: full GPT-5.x, then GPT-4.1,
# then GPT-5.x mini, then GPT-4o. Newer minor versions win within a tier.
best=$(awk -F'\t' '
  function minor(model) { return match(model, /^gpt-5\.[0-9]+/) ? substr(model, 7, RLENGTH - 6) + 0 : 0 }
  {
    model = tolower($2); score = 0
    if (model ~ /^gpt-5(\.[0-9]+)?$/) score = 4000 + minor(model)
    else if (model == "gpt-4.1") score = 3000
    else if (model ~ /^gpt-5(\.[0-9]+)?-mini$/) score = 2000 + minor(model)
    else if (model == "gpt-4o") score = 1000
    if (score > top) { top = score; name = $1; reasoning = (model ~ /^gpt-5/) ? "true" : "false" }
  }
  END { if (top > 0) printf "%s\n%s\n", name, reasoning }
' <<<"$deployments")

if [ -n "$best" ]; then
  printf '%s\n' "$best"
else
  printf '\n\n'
fi

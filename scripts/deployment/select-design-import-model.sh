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

# Rank vision + structured-output capable models: newer generations first,
# and within a generation the full tier (astra > sol > terra/plain) ahead of
# the budget tier (mini/luna). Nano, chat and other variants are ignored.
best=$(awk -F'\t' '
  {
    model = tolower($2); score = 0; generation = 0
    if (model == "gpt-4o") score = 450
    else if (match(model, /^gpt-[0-9]+(\.[0-9]+)?/)) {
      generation = substr(model, 5, RLENGTH - 4) + 0
      tier = substr(model, RLENGTH + 1)
      if (tier == "-astra") score = generation * 100 + 53
      else if (tier == "-sol") score = generation * 100 + 52
      else if (tier == "" || tier == "-terra") score = generation * 100 + 51
      else if (tier == "-mini" || tier == "-luna") score = generation * 100 + 10
    }
    if (score > top) { top = score; name = $1; reasoning = (generation >= 5) ? "true" : "false" }
  }
  END { if (top > 0) printf "%s\n%s\n", name, reasoning }
' <<<"$deployments")

if [ -n "$best" ]; then
  printf '%s\n' "$best"
else
  printf '\n\n'
fi

import { useEffect, useMemo, useState } from 'react'
import {
  discoveryService,
  type RenameCandidate,
  type ReplicationPlan,
  type ReplicationPreview,
} from '@/services/discoveryService'

interface Props {
  sourceSubscriptionIds: string[]
  subscriptions: { id: string; displayName: string }[]
  onClose: () => void
}

/**
 * Modal that walks the user through replicating a discovered environment into a new
 * subscription. Resources whose names are globally unique (Storage, Key Vault, App
 * Service, etc.) are surfaced with editable rename fields that default to a generated
 * suggestion. The user must confirm every rename before the deployment plan is built.
 *
 * Resource-naming reference:
 *   https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules
 */
export default function ReplicateDialog({
  sourceSubscriptionIds,
  subscriptions,
  onClose,
}: Props) {
  const [step, setStep] = useState<'target' | 'review' | 'plan'>('target')
  const [targetSub, setTargetSub] = useState<string>('')
  const [targetRg, setTargetRg] = useState<string>('rg-replica')
  const [targetLocation, setTargetLocation] = useState<string>('australiaeast')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ReplicationPreview | null>(null)
  const [renames, setRenames] = useState<Record<string, string>>({})
  const [plan, setPlan] = useState<ReplicationPlan | null>(null)

  // Restrict the target picker to subscriptions the user isn't already replicating *from*.
  const targetOptions = useMemo(
    () => subscriptions.filter((s) => !sourceSubscriptionIds.includes(s.id)),
    [subscriptions, sourceSubscriptionIds],
  )

  useEffect(() => {
    if (!targetSub && targetOptions.length > 0) setTargetSub(targetOptions[0].id)
  }, [targetOptions, targetSub])

  const runPreview = async () => {
    setBusy(true)
    setError(null)
    try {
      const p = await discoveryService.replicatePreview({
        sourceSubscriptionIds,
        targetSubscriptionId: targetSub,
        targetResourceGroup: targetRg,
        targetLocation,
      })
      setPreview(p)
      // Seed rename map with the engine's suggestions.
      const seed: Record<string, string> = {}
      p.renameRequired.forEach((r) => {
        seed[r.sourceResourceId] = r.suggestedName
      })
      setRenames(seed)
      setStep('review')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Preview failed.')
    } finally {
      setBusy(false)
    }
  }

  const runPlan = async () => {
    if (!preview) return
    // Validate every rename is non-empty before sending.
    const missing = preview.renameRequired.filter(
      (r) => !renames[r.sourceResourceId] || renames[r.sourceResourceId].trim() === '',
    )
    if (missing.length > 0) {
      setError(`Provide new names for: ${missing.map((m) => m.originalName).join(', ')}`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const p = await discoveryService.replicatePlan({
        sourceSubscriptionIds,
        targetSubscriptionId: targetSub,
        targetResourceGroup: targetRg,
        targetLocation,
        renames,
      })
      setPlan(p)
      setStep('plan')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Plan generation failed.')
    } finally {
      setBusy(false)
    }
  }

  const copyBicep = () => {
    if (!plan) return
    navigator.clipboard.writeText(plan.bicep).catch(() => {})
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              Replicate environment to a new subscription
            </h2>
            <p className="text-xs text-gray-500">
              Source: {sourceSubscriptionIds.length} subscription
              {sourceSubscriptionIds.length === 1 ? '' : 's'}. Globally-unique names will require your confirmation.{' '}
              <a
                href="https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules"
                target="_blank"
                rel="noopener noreferrer"
                className="text-azure-600 hover:underline"
              >
                Microsoft naming rules ↗
              </a>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              {error}
            </div>
          )}

          {step === 'target' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Target subscription
                </label>
                <select
                  value={targetSub}
                  onChange={(e) => setTargetSub(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  {targetOptions.length === 0 ? (
                    <option value="">No other subscriptions visible</option>
                  ) : (
                    targetOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.displayName}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Target resource group
                  </label>
                  <input
                    value={targetRg}
                    onChange={(e) => setTargetRg(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="rg-replica"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Target region
                  </label>
                  <input
                    value={targetLocation}
                    onChange={(e) => setTargetLocation(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="australiaeast"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Click <strong>Preview</strong> to see which resources need to be renamed.
              </p>
            </div>
          )}

          {step === 'review' && preview && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <p className="text-gray-500">Total resources</p>
                  <p className="text-lg font-bold text-gray-900">{preview.resourceCount}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-amber-700">Need new name</p>
                  <p className="text-lg font-bold text-amber-900">{preview.renameRequired.length}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <p className="text-gray-500">Skipped</p>
                  <p className="text-lg font-bold text-gray-900">{preview.skipped.length}</p>
                </div>
              </div>

              {preview.renameRequired.length === 0 ? (
                <p className="text-sm text-emerald-600 font-semibold">
                  No globally-unique names to confirm — proceeding will keep original names.
                </p>
              ) : (
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-2">
                    Confirm new names for globally-unique resources
                  </p>
                  <ul className="space-y-2">
                    {preview.renameRequired.map((r: RenameCandidate) => (
                      <li
                        key={r.sourceResourceId}
                        className="border border-gray-200 rounded-lg p-3 bg-white"
                      >
                        <div className="flex items-baseline justify-between flex-wrap gap-2">
                          <code className="text-[11px] text-gray-500">{r.resourceType}</code>
                          {r.docReference && (
                            <a
                              href={r.docReference}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-azure-600 hover:underline"
                            >
                              Microsoft Learn ↗
                            </a>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-1.5">
                          <div>
                            <label className="block text-[11px] text-gray-500">Original</label>
                            <p className="text-sm text-gray-800 font-medium truncate">{r.originalName}</p>
                          </div>
                          <div>
                            <label className="block text-[11px] text-gray-500">New name</label>
                            <input
                              value={renames[r.sourceResourceId] ?? ''}
                              onChange={(e) =>
                                setRenames((prev) => ({
                                  ...prev,
                                  [r.sourceResourceId]: e.target.value,
                                }))
                              }
                              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                            />
                          </div>
                        </div>
                        {r.reason && (
                          <p className="text-[11px] text-gray-500 mt-1">{r.reason}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.skipped.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-500">
                    {preview.skipped.length} resource(s) will be skipped
                  </summary>
                  <ul className="mt-2 ml-4 list-disc text-gray-600 space-y-0.5">
                    {preview.skipped.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {step === 'plan' && plan && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">
                  Deployment plan · {plan.resources.length} resource(s)
                </p>
                <button
                  onClick={copyBicep}
                  className="text-xs text-azure-600 hover:underline"
                >
                  Copy Bicep
                </button>
              </div>
              {plan.warnings.length > 0 && (
                <ul className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-0.5">
                  {plan.warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              )}
              <pre className="bg-gray-900 text-gray-100 text-[11px] leading-snug p-3 rounded-lg overflow-x-auto max-h-72">
                {plan.bicep}
              </pre>
              <p className="text-[11px] text-gray-500">
                Review the Bicep, then deploy it from this dialog (coming soon) or via the Azure CLI:
                {' '}
                <code className="bg-gray-100 px-1 py-0.5 rounded">
                  az deployment group create --resource-group {targetRg} --template-file plan.bicep
                </code>
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            {step === 'review' && (
              <button
                onClick={() => setStep('target')}
                className="text-sm text-gray-700 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-white"
              >
                ← Back
              </button>
            )}
            {step === 'plan' && (
              <button
                onClick={() => setStep('review')}
                className="text-sm text-gray-700 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-white"
              >
                ← Back
              </button>
            )}
            {step === 'target' && (
              <button
                onClick={runPreview}
                disabled={busy || !targetSub || !targetRg.trim() || !targetLocation.trim()}
                className="bg-azure-500 hover:bg-azure-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg"
              >
                {busy ? 'Previewing…' : 'Preview →'}
              </button>
            )}
            {step === 'review' && (
              <button
                onClick={runPlan}
                disabled={busy}
                className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg"
              >
                {busy ? 'Generating…' : 'Generate plan →'}
              </button>
            )}
            {step === 'plan' && (
              <button
                onClick={onClose}
                className="bg-azure-500 hover:bg-azure-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

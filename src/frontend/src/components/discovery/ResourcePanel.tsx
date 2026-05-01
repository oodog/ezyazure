import type { AzureResource } from '@/types/azure'

interface Props {
  resource: AzureResource
  onClose: () => void
}

export default function ResourcePanel({ resource, onClose }: Props) {
  return (
    <aside className="w-80 bg-white border border-gray-200 rounded-xl p-5 shrink-0 overflow-y-auto">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="font-semibold text-gray-900 text-sm">{resource.name}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{resource.type}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 ml-2">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-gray-400 text-xs uppercase tracking-wide">Resource Group</dt>
          <dd className="text-gray-700 mt-0.5">{resource.resourceGroup}</dd>
        </div>
        <div>
          <dt className="text-gray-400 text-xs uppercase tracking-wide">Subscription</dt>
          <dd className="text-gray-700 mt-0.5 font-mono text-xs">{resource.subscriptionId}</dd>
        </div>
        <div>
          <dt className="text-gray-400 text-xs uppercase tracking-wide">Location</dt>
          <dd className="text-gray-700 mt-0.5">{resource.location}</dd>
        </div>
        {Object.keys(resource.tags ?? {}).length > 0 && (
          <div>
            <dt className="text-gray-400 text-xs uppercase tracking-wide mb-1">Tags</dt>
            <dd className="flex flex-wrap gap-1">
              {Object.entries(resource.tags!).map(([k, v]) => (
                <span key={k} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                  {k}: {v}
                </span>
              ))}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-gray-400 text-xs uppercase tracking-wide mb-1">Properties</dt>
          <dd>
            <pre className="text-xs bg-gray-50 rounded p-2 overflow-auto max-h-48">
              {JSON.stringify(resource.properties, null, 2)}
            </pre>
          </dd>
        </div>
      </dl>
    </aside>
  )
}

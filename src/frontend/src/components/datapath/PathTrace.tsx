import type { DataPathResult, PathHop } from '@/types/datapath'

interface Props {
  result: DataPathResult
}

const statusColors = {
  Allowed: 'bg-green-100 text-green-700 border-green-200',
  Blocked: 'bg-red-100 text-red-700 border-red-200',
  Unknown: 'bg-yellow-100 text-yellow-700 border-yellow-200',
}

export default function PathTrace({ result }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold text-gray-900">Path result</h2>
        <span className={`text-xs font-bold px-3 py-1 rounded-full border ${statusColors[result.status]}`}>
          {result.status}
        </span>
      </div>

      {result.blockingRule && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          <span className="font-semibold">Blocked by: </span>{result.blockingRule}
        </div>
      )}

      <ol className="relative border-l-2 border-gray-200 space-y-0">
        {result.hops.map((hop: PathHop, i: number) => (
          <li key={i} className="ml-5 pb-5 last:pb-0">
            <span className="absolute -left-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-azure-500 ring-2 ring-white text-white text-xs">
              {i + 1}
            </span>
            <div className="ml-2">
              <p className="text-sm font-medium text-gray-900">{hop.resourceName}</p>
              <p className="text-xs text-gray-500 font-mono">{hop.resourceId}</p>
              {hop.detail && <p className="text-xs text-gray-600 mt-0.5">{hop.detail}</p>}
              {hop.matchedRule && (
                <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded mt-1 inline-block">
                  Rule: {hop.matchedRule}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>

      {result.riskNotes?.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Risk notes</h3>
          <ul className="space-y-1">
            {result.riskNotes.map((note, i) => (
              <li key={i} className="text-sm text-yellow-700 bg-yellow-50 rounded px-3 py-1">{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

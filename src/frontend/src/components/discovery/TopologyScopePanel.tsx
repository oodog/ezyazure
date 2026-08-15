import type {
  DiscoveryTechnology,
  DiscoveryTopologyView,
} from '@/utils/discoveryTechnology'

interface TechnologyOption {
  key: DiscoveryTechnology
  label: string
  count: number
}

interface TopologyScopePanelProps {
  view: DiscoveryTopologyView
  onViewChange: (view: DiscoveryTopologyView) => void
  technologies: TechnologyOption[]
  selectedTechnologies: ReadonlySet<DiscoveryTechnology>
  onToggleTechnology: (technology: DiscoveryTechnology) => void
  onClearTechnologies: () => void
  visibleCount: number
  totalCount: number
  routingLoading: boolean
  onAnalyzeRouting: () => void
  onOpenDataPath: () => void
}

const views: Array<{
  key: DiscoveryTopologyView
  label: string
  detail: string
}> = [
  {
    key: 'network',
    label: 'Network path',
    detail: 'VNets, routing, security, gateways, Private Link',
  },
  {
    key: 'network-compute',
    label: 'Network + compute',
    detail: 'Adds VM, scale-set, and attached service workloads',
  },
  {
    key: 'full',
    label: 'Full inventory',
    detail: 'All discovered Azure resources',
  },
]

export default function TopologyScopePanel({
  view,
  onViewChange,
  technologies,
  selectedTechnologies,
  onToggleTechnology,
  onClearTechnologies,
  visibleCount,
  totalCount,
  routingLoading,
  onAnalyzeRouting,
  onOpenDataPath,
}: TopologyScopePanelProps) {
  return (
    <aside className="w-64 xl:w-72 2xl:w-80 shrink-0 bg-white border border-gray-200 rounded-lg flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Topology scope</h2>
            <p className="text-[11px] text-gray-500">Operational network view</p>
          </div>
          <span className="text-xs tabular-nums text-gray-500">
            {visibleCount}/{totalCount}
          </span>
        </div>
      </div>

      <div className="p-3 border-b border-gray-100" role="radiogroup" aria-label="Topology view">
        <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          View
        </p>
        <div className="space-y-1">
          {views.map((option) => (
            <label
              key={option.key}
              className={`flex gap-2.5 px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
                view === option.key
                  ? 'border-teal-300 bg-teal-50'
                  : 'border-transparent hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="topology-view"
                value={option.key}
                checked={view === option.key}
                onChange={() => onViewChange(option.key)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-gray-800">{option.label}</span>
                <span className="block text-[11px] leading-4 text-gray-500">{option.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {view === 'full' && (
        <div className="p-3 border-b border-gray-100 min-h-0">
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Technology
            </p>
            <button
              type="button"
              onClick={onClearTechnologies}
              className="text-[11px] text-azure-600 hover:underline"
            >
              Show all
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto space-y-0.5">
            {technologies.map((technology) => (
              <li key={technology.key}>
                <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedTechnologies.has(technology.key)}
                    onChange={() => onToggleTechnology(technology.key)}
                  />
                  <span className="flex-1 text-xs text-gray-700">{technology.label}</span>
                  <span className="text-[11px] tabular-nums text-gray-400">{technology.count}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="p-3 mt-auto">
        <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Network tools
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onOpenDataPath}
            disabled={totalCount === 0}
            className="px-2.5 py-2 rounded-md bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-medium"
          >
            Trace path
          </button>
          <button
            type="button"
            onClick={onAnalyzeRouting}
            disabled={totalCount === 0 || routingLoading}
            className="px-2.5 py-2 rounded-md bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-medium"
          >
            {routingLoading ? 'Analyzing…' : 'Routing risks'}
          </button>
        </div>
      </div>
    </aside>
  )
}
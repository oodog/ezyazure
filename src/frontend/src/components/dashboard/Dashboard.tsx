import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { discoveryService } from '@/services/discoveryService'
import type { DashboardStats } from '@/types/azure'

interface StatCard { label: string; value: number | string; accent: string; icon: string }

function StatCard({ label, value, accent, icon }: StatCard) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4 hover:shadow-md transition-shadow">
      <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: accent + '18' }}>
        <svg className="w-5 h-5" style={{ color: accent }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-400 mt-0.5 font-medium">{label}</p>
      </div>
    </div>
  )
}

interface QuickAction { label: string; description: string; href: string; accent: string; icon: string }

function QuickActionBtn({ label, description, href, accent, icon }: QuickAction) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(href)}
      className="group flex flex-col items-start gap-1.5 px-5 py-4 bg-white rounded-xl border border-gray-200 hover:border-transparent hover:shadow-lg hover:-translate-y-0.5 transition-all duration-150 text-left w-full"
      style={undefined}
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-1" style={{ backgroundColor: accent + '18' }}>
        <svg className="w-5 h-5 transition-transform group-hover:scale-110" style={{ color: accent }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>
      <p className="text-sm font-semibold text-gray-800">{label}</p>
      <p className="text-xs text-gray-400 leading-snug">{description}</p>
    </button>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(false)

  useEffect(() => {
    discoveryService.getDashboardStats()
      .then(setStats)
      .catch(() => setApiError(true))
      .finally(() => setLoading(false))
  }, [])

  const statCards: StatCard[] = [
    { label: 'Subscriptions', value: stats?.subscriptionCount ?? 0, accent: '#3b82f6', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z' },
    { label: 'VNets', value: stats?.vnetCount ?? 0, accent: '#6366f1', icon: 'M5 3a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2H5z' },
    { label: 'Resources', value: stats?.resourceCount ?? 0, accent: '#8b5cf6', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
    { label: 'Compliance score', value: stats?.complianceScore != null ? `${stats.complianceScore}%` : 'N/A', accent: '#10b981', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
    { label: 'Drift warnings', value: stats?.driftWarnings ?? 0, accent: '#f59e0b', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
    { label: 'Deployments (30d)', value: stats?.recentDeployments ?? 0, accent: '#64748b', icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12' },
  ]

  const quickActions: QuickAction[] = [
    {
      label: 'Discover resources',
      description: 'Scan your subscriptions and map out all Azure resources',
      href: '/discovery',
      accent: '#3b82f6',
      icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
    },
    {
      label: 'Design environment',
      description: 'Drag and drop Azure blocks to build your architecture',
      href: '/designer',
      accent: '#8b5cf6',
      icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zm12 0a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
    },
    {
      label: 'Analyze data path',
      description: 'Trace network flows and evaluate NSG + routing rules',
      href: '/datapath',
      accent: '#10b981',
      icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
    },
    {
      label: 'Generate Bicep IaC',
      description: 'Export your design as production-ready Bicep infrastructure code',
      href: '/iac',
      accent: '#f97316',
      icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
    },
  ]

  return (
    <div className="space-y-6">
      {/* API error banner */}
      {apiError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          API unavailable — showing cached or empty data. Check that the backend Container App is running.
        </div>
      )}
      {/* Hero */}
      <div className="bg-gradient-to-br from-azure-600 to-azure-500 rounded-2xl px-8 py-6 text-white flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Welcome to EasyAzure</h1>
          <p className="text-azure-100 mt-1 text-sm max-w-lg">
            Discover, design, analyse, and deploy Azure environments — all in one place.
          </p>
        </div>
        <div className="hidden md:flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2">
          <span className="text-sm text-white font-medium opacity-80">Azure-native</span>
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Quick actions</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {quickActions.map((qa) => <QuickActionBtn key={qa.href} {...qa} />)}
        </div>
      </div>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Environment at a glance</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {statCards.map((card) => <StatCard key={card.label} {...card} />)}
          </div>
        </div>
      )}

      {/* Bottom panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Recent deployments
          </h2>
          {stats?.recentDeploymentList?.length ? (
            <ul className="space-y-2">
              {stats.recentDeploymentList.map((d) => (
                <li key={d.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 font-medium">{d.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${d.status === 'Succeeded' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {d.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center py-6 text-center">
              <svg className="w-8 h-8 text-gray-200 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <p className="text-sm text-gray-400">No deployments yet</p>
              <p className="text-xs text-gray-300 mt-0.5">Design an environment and generate Bicep to get started</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Drift warnings
          </h2>
          {stats?.driftList?.length ? (
            <ul className="space-y-2">
              {stats.driftList.map((d) => (
                <li key={d.resourceId} className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">
                  {d.message}
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center py-6 text-center">
              <svg className="w-8 h-8 text-green-200 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-gray-400">All clear!</p>
              <p className="text-xs text-gray-300 mt-0.5">No drift detected between your design and deployed resources</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { Component, ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthenticatedTemplate, UnauthenticatedTemplate } from '@azure/msal-react'
import AppLayout from '@/components/layout/AppLayout'
import Dashboard from '@/components/dashboard/Dashboard'
import DiscoveryView from '@/components/discovery/DiscoveryView'
import DesignerCanvas from '@/components/designer/DesignerCanvas'
import DataPathAnalyzer from '@/components/datapath/DataPathAnalyzer'
import BestPracticeReview from '@/components/bestpractice/BestPracticeReview'
import IaCGenerator from '@/components/iac/IaCGenerator'
import LoginPage from '@/components/auth/LoginPage'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
          <div className="bg-white rounded-2xl border border-red-200 shadow-md p-8 max-w-md w-full">
            <h1 className="text-lg font-bold text-red-700 mb-2">Something went wrong</h1>
            <p className="text-sm text-gray-500 font-mono break-all">{String(this.state.error)}</p>
            <button onClick={() => window.location.reload()} className="mt-5 text-sm bg-azure-500 text-white px-4 py-2 rounded-lg hover:bg-azure-600">
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthenticatedTemplate>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/discovery" element={<DiscoveryView />} />
            <Route path="/discovery/:subscriptionId" element={<DiscoveryView />} />
            <Route path="/datapath" element={<DataPathAnalyzer />} />
            <Route path="/designer" element={<DesignerCanvas />} />
            <Route path="/designer/:environmentId" element={<DesignerCanvas />} />
            <Route path="/best-practice" element={<BestPracticeReview />} />
            <Route path="/iac" element={<IaCGenerator />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AppLayout>
      </AuthenticatedTemplate>
      <UnauthenticatedTemplate>
        <Routes>
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </UnauthenticatedTemplate>
    </ErrorBoundary>
  )
}

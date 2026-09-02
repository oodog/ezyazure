import { useState } from 'react'

interface BicepModalProps {
  bicep: string
  onClose: () => void
  additionsOnly?: boolean
  createdResources?: number
  existingReferences?: number
  requiredDeploymentScope?: { subscriptionId: string; resourceGroup: string }
}

export default function BicepModal({
  bicep,
  onClose,
  additionsOnly = false,
  createdResources = 0,
  existingReferences = 0,
  requiredDeploymentScope,
}: BicepModalProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(bicep)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const blob = new Blob([bicep], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'main.bicep'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-[800px] max-w-[90vw] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-azure-50 flex items-center justify-center">
              <svg className="w-4 h-4 text-azure-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">{additionsOnly ? 'Additions-only Bicep' : 'Generated Bicep'}</h2>
              <p className="text-[10px] text-gray-400">
                {additionsOnly
                  ? `${createdResources} new resource(s); ${existingReferences} discovered reference(s). Run what-if before deployment.`
                  : <>main.bicep — review and deploy with <code className="bg-gray-100 px-1 rounded">az deployment group create</code></>}
              </p>
              {additionsOnly && requiredDeploymentScope && (
                <p className="mt-0.5 text-[10px] text-blue-700">
                  Target: {requiredDeploymentScope.subscriptionId} / {requiredDeploymentScope.resourceGroup}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg border border-gray-200 transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-azure-500 hover:bg-azure-600 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </button>
            <button onClick={onClose}
              className="text-gray-400 hover:text-gray-700 p-1 rounded-lg hover:bg-gray-100 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Code */}
        <div className="flex-1 overflow-auto">
          <pre className="p-5 text-xs leading-relaxed font-mono text-gray-800 whitespace-pre">
            {bicep}
          </pre>
        </div>
      </div>
    </div>
  )
}

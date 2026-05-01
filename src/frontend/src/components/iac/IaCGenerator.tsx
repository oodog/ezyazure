import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { iacService } from '@/services/iacService'

export default function IaCGenerator() {
  const [environmentId, setEnvironmentId] = useState('')
  const [bicepCode, setBicepCode] = useState('')
  const [whatIfResult, setWhatIfResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [deploying, setDeploying] = useState(false)

  const generate = async () => {
    setLoading(true)
    try {
      const result = await iacService.generateBicep(environmentId)
      setBicepCode(result.bicep)
    } finally {
      setLoading(false)
    }
  }

  const runWhatIf = async () => {
    setLoading(true)
    try {
      const result = await iacService.runWhatIf(environmentId, bicepCode)
      setWhatIfResult(JSON.stringify(result, null, 2))
    } finally {
      setLoading(false)
    }
  }

  const deploy = async () => {
    setDeploying(true)
    try {
      await iacService.deploy(environmentId, bicepCode)
      alert('Deployment submitted via Deployment Stack.')
    } finally {
      setDeploying(false)
    }
  }

  return (
    <div className="flex flex-col h-full space-y-4 max-w-6xl">
      <h1 className="text-2xl font-bold text-gray-900">IaC Generator</h1>
      <p className="text-sm text-gray-500">
        Generates Bicep from your designer canvas using Azure Verified Modules. Run what-if before deploying via Deployment Stacks.
      </p>

      <div className="flex gap-3 items-center">
        <input
          type="text"
          value={environmentId}
          onChange={(e) => setEnvironmentId(e.target.value)}
          placeholder="Environment ID or designer canvas ID"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
        />
        <button onClick={generate} disabled={!environmentId || loading}
          className="bg-azure-500 hover:bg-azure-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          Generate Bicep
        </button>
        <button onClick={runWhatIf} disabled={!bicepCode || loading}
          className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          What-if
        </button>
        <button onClick={deploy} disabled={!bicepCode || !whatIfResult || deploying}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          {deploying ? 'Deploying...' : 'Deploy'}
        </button>
      </div>

      <div className="flex flex-1 gap-4 min-h-0">
        <div className="flex-1 rounded-xl border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
            <span className="text-xs font-medium text-gray-500">Generated Bicep</span>
          </div>
          <Editor
            height="100%"
            language="bicep"
            value={bicepCode}
            onChange={(v) => setBicepCode(v ?? '')}
            theme="vs"
            options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
          />
        </div>

        {whatIfResult && (
          <div className="w-96 rounded-xl border border-gray-200 overflow-hidden shrink-0">
            <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
              <span className="text-xs font-medium text-gray-500">What-if result</span>
            </div>
            <pre className="p-4 text-xs font-mono overflow-auto h-full">{whatIfResult}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

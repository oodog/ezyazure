import { useEffect, useState } from 'react'
import type { Edge } from 'reactflow'
import { FieldInput } from './PropertyEditor'
import { getConnectionSchema, type ConnectionSchema } from './relationships'
import type { FieldDef } from './blockSchemas'

interface Props {
  edge: Edge
  sourceType: string
  targetType: string
  onChange: (edgeId: string, properties: Record<string, unknown>) => void
  onDelete: (edgeId: string) => void
  onClose: () => void
}

export default function EdgePropertyEditor({
  edge, sourceType, targetType, onChange, onDelete, onClose,
}: Props) {
  const schema: ConnectionSchema | undefined = getConnectionSchema(sourceType, targetType)
  const initial = ((edge.data as { properties?: Record<string, unknown> } | undefined)?.properties) ?? {}
  const [props, setProps] = useState<Record<string, unknown>>(initial)

  // Sync when a different edge is selected
  useEffect(() => {
    setProps(((edge.data as { properties?: Record<string, unknown> } | undefined)?.properties) ?? {})
  }, [edge.id])

  // Apply schema defaults on first selection
  useEffect(() => {
    if (!schema) return
    const next = { ...props }
    let changed = false
    for (const f of schema.fields) {
      if (f.default !== undefined && next[f.key] === undefined) {
        next[f.key] = f.default
        changed = true
      }
    }
    if (changed) {
      setProps(next)
      onChange(edge.id, next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edge.id])

  const update = (key: string, value: unknown) => {
    const next = { ...props, [key]: value }
    setProps(next)
    onChange(edge.id, next)
  }

  const title = schema?.title ?? `${sourceType} → ${targetType}`
  const label = (edge.label as string | undefined) ?? ''

  // Group fields
  const groups: Record<string, FieldDef[]> = {}
  if (schema) {
    for (const f of schema.fields) {
      const g = f.group ?? 'Properties'
      if (!groups[g]) groups[g] = []
      groups[g].push(f)
    }
  }
  const orderedGroups = schema?.groups ?? Object.keys(groups)

  return (
    <aside className="w-80 bg-white border border-gray-200 rounded-xl shrink-0 flex flex-col overflow-hidden shadow-sm">
      <div className="flex items-start justify-between px-4 py-3 border-b border-gray-100 bg-azure-50/40">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-azure-600">Connection</p>
          <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
          <p className="text-[11px] text-gray-500 truncate">
            {sourceType} <span className="text-gray-300">→</span> {targetType}
            {label && <span className="text-gray-400"> · {label}</span>}
          </p>
        </div>
        <button onClick={onClose}
          className="flex-shrink-0 text-gray-400 hover:text-gray-700 p-1 rounded-lg hover:bg-white/80 transition-colors">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {schema?.description && (
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
          <p className="text-xs text-gray-500">{schema.description}</p>
          {schema.reference && (
            <a href={schema.reference} target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-azure-500 hover:underline mt-1 inline-block">
              Microsoft Learn ↗
            </a>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {!schema && (
          <p className="text-xs text-gray-400 italic">
            This connection has no configurable properties — it is a pure association.
          </p>
        )}

        {schema && orderedGroups.map((group) => (
          <div key={group}>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">{group}</p>
            <div className="space-y-3">
              {(groups[group] ?? []).map((field) => (
                <label key={field.key} className="block">
                  <span className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                    {field.label}
                    {field.required && <span className="text-red-500">*</span>}
                  </span>
                  <FieldInput field={field} value={props[field.key]}
                    onChange={(v) => update(field.key, v)} />
                  {field.help && (
                    <span className="block mt-1 text-[11px] text-gray-400 leading-relaxed">{field.help}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
        <button onClick={() => onDelete(edge.id)}
          className="text-[11px] text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded">
          Delete connection
        </button>
        <p className="text-[10px] text-gray-400">Changes apply automatically</p>
      </div>
    </aside>
  )
}

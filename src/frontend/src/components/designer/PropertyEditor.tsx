import { useEffect, useState } from 'react'
import { getBlockMeta, categoryStyles, blockIcons } from './blockMetadata'
import { getBlockSchema, type FieldDef } from './blockSchemas'
import type { DesignBlock } from '@/types/designer'

interface Props {
  nodeId: string
  block: DesignBlock
  onChange: (nodeId: string, patch: { label?: string; properties?: Record<string, unknown> }) => void
  onClose: () => void
}

export function FieldInput({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const commonClass =
    'mt-1.5 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-azure-500 focus:ring-1 focus:ring-azure-500 outline-none transition'

  switch (field.type) {
    case 'text':
      return (
        <input type="text" className={commonClass} value={(value as string) ?? ''}
          placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      )
    case 'textarea':
      return (
        <textarea rows={4} className={commonClass + ' font-mono text-xs'} value={(value as string) ?? ''}
          placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      )
    case 'number':
      return (
        <input type="number" className={commonClass} value={(value as number | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
      )
    case 'select':
      return (
        <select className={commonClass + ' bg-white'} value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}>
          <option value="">— select —</option>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    case 'multiselect': {
      const arr = (value as string[] | undefined) ?? []
      return (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {field.options?.map((o) => {
            const active = arr.includes(o.value)
            return (
              <button type="button" key={o.value}
                onClick={() => onChange(active ? arr.filter((v) => v !== o.value) : [...arr, o.value])}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  active
                    ? 'bg-azure-500 border-azure-500 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-azure-300'
                }`}>
                {o.label}
              </button>
            )
          })}
        </div>
      )
    }
    case 'checkbox':
      return (
        <label className="mt-1.5 inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-azure-500 focus:ring-azure-500" />
          <span className="text-sm text-gray-700">{value ? 'Enabled' : 'Disabled'}</span>
        </label>
      )
    case 'cidrList':
    case 'tags': {
      const arr = (value as string[] | undefined) ?? []
      return (
        <input type="text" className={commonClass} defaultValue={arr.join(', ')}
          placeholder={field.placeholder ?? (field.type === 'cidrList' ? '10.0.0.0/16, 10.1.0.0/16' : 'env=prod, owner=team')}
          onBlur={(e) => {
            const parts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
            onChange(parts)
          }} />
      )
    }
  }
}

export default function PropertyEditor({ nodeId, block, onChange, onClose }: Props) {
  const meta = getBlockMeta(block.blockType)
  const styles = categoryStyles[meta.category]
  const iconPath = blockIcons[block.blockType] ?? blockIcons['Resource Group']
  const schema = getBlockSchema(block.blockType)

  const [label, setLabel] = useState(block.label)
  const [props, setProps] = useState<Record<string, unknown>>(block.properties ?? {})

  // Sync local state when a different block is selected
  useEffect(() => {
    setLabel(block.label)
    setProps(block.properties ?? {})
  }, [nodeId, block.label, block.properties])

  // Apply schema defaults the first time this block is selected
  useEffect(() => {
    if (!schema) return
    const next = { ...(block.properties ?? {}) }
    let changed = false
    for (const f of schema.fields) {
      if (f.default !== undefined && next[f.key] === undefined) {
        next[f.key] = f.default
        changed = true
      }
    }
    if (changed) {
      setProps(next)
      onChange(nodeId, { properties: next })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  const updateField = (key: string, value: unknown) => {
    const next = { ...props, [key]: value }
    setProps(next)
    onChange(nodeId, { properties: next })
  }

  const updateLabel = (v: string) => {
    setLabel(v)
    onChange(nodeId, { label: v })
  }

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
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-gray-100"
        style={{ backgroundColor: styles.accent + '0f' }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: styles.accent + '20' }}>
            <svg className="w-5 h-5" style={{ color: styles.accent }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{label}</p>
            <p className="text-xs font-medium" style={{ color: styles.accent }}>{meta.category}</p>
          </div>
        </div>
        <button onClick={onClose}
          className="flex-shrink-0 text-gray-400 hover:text-gray-700 p-1 rounded-lg hover:bg-white/80 transition-colors">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {meta.description && (
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
          <p className="text-xs text-gray-500">{meta.description}</p>
        </div>
      )}

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Display name</span>
          <input type="text" value={label} onChange={(e) => updateLabel(e.target.value)}
            className="mt-1.5 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-azure-500 focus:ring-1 focus:ring-azure-500 outline-none transition" />
        </label>

        {!schema && (
          <p className="text-xs text-gray-400 italic">No additional settings defined for this block type yet.</p>
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
                    onChange={(v) => updateField(field.key, v)} />
                  {field.help && (
                    <span className="block mt-1 text-[11px] text-gray-400 leading-relaxed">{field.help}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50">
        <p className="text-[10px] text-gray-400 text-center">Changes apply automatically</p>
      </div>
    </aside>
  )
}

import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { getBlockMeta, categoryStyles, blockIcons } from './blockMetadata'
import type { DesignBlock } from '@/types/designer'

function AzureResourceNode({ data, selected }: NodeProps<DesignBlock>) {
  const meta = getBlockMeta(data.blockType)
  const styles = categoryStyles[meta.category]
  const iconPath = blockIcons[data.blockType] ?? blockIcons['Resource Group']

  return (
    <div
      className={`
        relative bg-white rounded-xl shadow-md border-2 transition-all duration-150 w-44
        ${selected ? `border-[${styles.accent}] shadow-lg ring-2 ring-offset-1` : 'border-gray-200 hover:border-gray-300 hover:shadow-lg'}
      `}
      style={selected ? { borderColor: styles.accent } : {}}
    >
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
        style={{ backgroundColor: styles.accent }}
      />

      {/* Target handle — left */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-white !bg-gray-400 !rounded-full transition-colors hover:!bg-blue-500"
        style={{ left: -6 }}
      />

      {/* Content */}
      <div className="pl-3 pr-3 pt-2.5 pb-2.5">
        <div className="flex items-start gap-2">
          {/* Icon circle */}
          <div
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5"
            style={{ backgroundColor: styles.accent + '20' }}
          >
            <svg
              className="w-4 h-4"
              style={{ color: styles.accent }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.75}
            >
              {/* AKS uses two paths */}
              {(data.blockType === 'AKS' || data.blockType === 'AKS baseline') ? (
                <>
                  <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </>
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
              )}
            </svg>
          </div>

          {/* Text */}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-800 leading-tight truncate">{data.label}</p>
            <p
              className="text-[10px] font-medium mt-0.5 truncate"
              style={{ color: styles.accent }}
            >
              {meta.category}
            </p>
          </div>
        </div>

        {/* Pattern badge */}
        {meta.category === 'Patterns' && (
          <div
            className="mt-1.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full inline-block"
            style={{ backgroundColor: styles.accent + '20', color: styles.accent }}
          >
            Pattern
          </div>
        )}
      </div>

      {/* Source handle — right */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !border-2 !border-white !bg-gray-400 !rounded-full transition-colors hover:!bg-blue-500"
        style={{ right: -6 }}
      />

      {/* Top + Bottom handles for vertical connections */}
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="!w-3 !h-3 !border-2 !border-white !bg-gray-400 !rounded-full opacity-0 hover:opacity-100 transition-opacity"
        style={{ top: -6 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!w-3 !h-3 !border-2 !border-white !bg-gray-400 !rounded-full opacity-0 hover:opacity-100 transition-opacity"
        style={{ bottom: -6 }}
      />
    </div>
  )
}

export default memo(AzureResourceNode)

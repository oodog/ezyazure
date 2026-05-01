import { memo } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from 'reactflow'
import { getBlockMeta, categoryStyles, blockIcons } from './blockMetadata'
import { containerSize } from './relationships'
import type { DesignBlock } from '@/types/designer'

// Container node — renders with a header bar and an empty body area where
// children (with parentId pointing to this node) are positioned by ReactFlow.
function AzureContainerNode({ data, selected }: NodeProps<DesignBlock>) {
  const meta = getBlockMeta(data.blockType)
  const styles = categoryStyles[meta.category]
  const iconPath = blockIcons[data.blockType] ?? blockIcons['Resource Group']
  const minSize = containerSize(data.blockType)

  return (
    <div
      className={`relative w-full h-full rounded-xl border-2 transition-all duration-150 ${
        selected ? 'shadow-lg' : 'border-dashed'
      }`}
      style={{
        borderColor: selected ? styles.accent : styles.accent + '99',
        backgroundColor: styles.accent + '0a',
      }}
    >
      {/* Resize handles — visible only when selected */}
      <NodeResizer
        isVisible={selected}
        minWidth={minSize.width}
        minHeight={minSize.height}
        lineStyle={{ borderColor: styles.accent, borderWidth: 1 }}
        handleStyle={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: '#ffffff',
          border: `2px solid ${styles.accent}`,
        }}
      />

      {/* Inbound handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-white !bg-gray-400"
        style={{ left: -6, top: 18 }}
      />

      {/* Header bar */}
      <div
        className="absolute top-0 left-0 right-0 h-7 rounded-t-xl px-2.5 flex items-center gap-2"
        style={{ backgroundColor: styles.accent }}
      >
        <svg className="w-3.5 h-3.5 text-white flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
        <span className="text-[11px] font-bold text-white uppercase tracking-wide truncate">{data.label}</span>
        <span className="ml-auto text-[10px] font-medium text-white/80">{meta.category}</span>
      </div>

      {/* Outbound handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !border-2 !border-white !bg-gray-400"
        style={{ right: -6, top: 18 }}
      />
    </div>
  )
}

export default memo(AzureContainerNode)


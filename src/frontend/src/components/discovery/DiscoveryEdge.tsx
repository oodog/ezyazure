import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from 'reactflow'

export default function DiscoveryEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
  labelStyle,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })
  const color = typeof labelStyle?.fill === 'string' ? labelStyle.fill : '#475569'
  const opacity = typeof labelStyle?.opacity === 'number' ? labelStyle.opacity : 1
  const labelOffsetY = typeof data?.labelOffsetY === 'number' ? data.labelOffsetY : 0

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label != null && label !== '' && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute max-w-44 -translate-x-1/2 -translate-y-1/2 whitespace-normal break-words rounded border border-gray-200 bg-white/95 px-1.5 py-1 text-center text-[10px] font-semibold leading-3 shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + labelOffsetY}px)`,
              color,
              opacity,
            }}
            title={String(label)}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}